const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { chromium } = require('playwright');
const readline = require('readline');
const express = require('express');
const https = require('https');

// Proxy and Playwright configurations
const chromePath = path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const proxyConfig = {
    host: '127.0.0.1',
    port: 8082
};

// Create Axios instance for proxy support
const axiosInstance = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
        post: {
            'Content-Type': 'application/json',
        },
    },
    httpsAgent,
    proxy: proxyConfig,
    timeout: 10000,
});

const app = express();
const port = 3040;
let refreshCounter = 0;
let browser, page; // Playwright browser and page
let initialPrices = {};
let coinData = [];

// Ensure the public directory and log file exist
const ensureFileExists = () => {
    const publicDir = path.resolve(__dirname, 'public');
    const htmlFilePath = path.resolve(publicDir, 'coin_signal_log.html');

    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
        console.log('Created public directory.');
    }

    if (!fs.existsSync(htmlFilePath)) {
        fs.writeFileSync(htmlFilePath, '<html><head><title>Coin Signal Log</title></head><body><h1>Welcome to Coin Signal Tracker</h1></body></html>');
        console.log('Created initial coin_signal_log.html file.');
    }

    return htmlFilePath;
};

// Function to calculate the decimal precision of a number
function getDecimalPlaces(price) {
    const priceString = price.toString();
    if (priceString.includes('.')) {
        return Math.min(priceString.split('.')[1].length, 10); // Limit to 10 decimal places
    }
    if (price < 1 && price > 0) {
        return 10; // Set maximum precision for very small numbers
    }
    return 2; // Default for prices ≥ 1
}

// Use readline to capture user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Prompt the user for coins and avoid duplicate BTC entries
rl.question("Enter coins separated by commas (e.g., ETH,XRP,DOGE): ", (input) => {
    const coinsInput = input.split(",").map(coin => coin.trim().toUpperCase());
    const coins = coinsInput.includes("BTC") ? [...new Set(coinsInput)] : ["BTC", ...new Set(coinsInput)];
    console.log("Tracking the following coins:", coins);

    rl.close(); // Close the readline interface

    // Start tracking with the provided coins
    main(coins);
});
// Fetch assets and update coin data
async function fetchAssets(coins) {
    console.log('Fetching assets from the API...');
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000');
        const assets = response.data.data.data;
        console.log(`Assets data fetched successfully. Found ${assets.length} entries.`);

        coinData = coins.map(coin => {
            const asset = assets.find(a => a.asset === coin);
            if (!asset) {
                console.warn(`No data found for ${coin}`);
                return null;
            }

            const price_usd = Number(asset.price_usd || 0);
            const volume_usd = Number(asset.volume_usd || 0);
            const circulation_usd = Number(asset.circulation_usd || 0);
            const circulation_usd_rank = Number(asset.circulation_usd_rank || 0);

            // Check and set the start price for each coin
            if (!initialPrices[coin] && price_usd > 0) {
                initialPrices[coin] = price_usd; // Set the first valid non-zero price as the start price
            }

            // Calculate Volume Increase (%)
            const volumeIncreasePercent = initialPrices[coin]
                ? ((volume_usd - initialPrices[coin]) / initialPrices[coin]) * 100
                : 0;

            const priceChangeFromStart = initialPrices[coin]
                ? ((price_usd - initialPrices[coin]) / initialPrices[coin]) * 100
                : 0;

            const priceChange24h = ((price_usd - Number(asset.klines[0][1])) / Number(asset.klines[0][1])) * 100;

            const klines = asset.klines.map(kline => Number(kline[1]));
            const minPrice = Math.min(...klines);
            const maxPrice = Math.max(...klines);

            // Standard Fibonacci levels
            const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786].map(level =>
                minPrice + level * (maxPrice - minPrice)
            );

            // Deep Fibonacci retracement levels
            const last30Prices = klines.slice(-30);
            const dumpLow = Math.min(...last30Prices);
            const dumpIndex = last30Prices.indexOf(dumpLow);
            const maxAfterDump = Math.max(...last30Prices.slice(dumpIndex));
            const deepFibLevels = [0.236, 0.382, 0.5, 0.618, 0.786].map(level =>
                dumpLow + level * (maxAfterDump - dumpLow)
            );

            // Merge Fib and deep dump levels
            const combinedLevels = fibLevels.map((fib, index) => ({
                fib,
                dump: deepFibLevels[index]
            }));

            return {
                coin,
                price_usd,
                volume_usd,
                circulation_usd_rank,
                circulation_usd,
                priceChangeFromStart,
                priceChange24h,
                volumeIncreasePercent,
                combinedLevels
            };
        }).filter(data => data);

        // Save initial prices during the first refresh
        if (refreshCounter === 0) {
            console.log('Saving initial prices for coins...');
            coinData.forEach(data => initialPrices[data.coin] = data.price_usd);
        }
    } catch (error) {
        console.error('Error fetching assets:', error.message);
    }
}

// Format market cap to smaller units (e.g., B, M, K)
function formatMarketCap(value) {
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K';
    return value.toFixed(2);
}

const volumeColumnVisible = false; // Set to true to display "Vol Inc (%)", false to hide it

function updateHtmlLog() {
    refreshCounter++;
    console.log(`Updating HTML log... Refresh Count: ${refreshCounter}`);
    const htmlFilePath = ensureFileExists();

    // Sort first by 24-hour change
    coinData.sort((a, b) => b.priceChange24h - a.priceChange24h);

    // Then refine by change-from-start
    coinData.sort((a, b) => b.priceChangeFromStart - a.priceChangeFromStart);


    let htmlContent = `<html>
<head>
    <title>Refresh Count: ${refreshCounter}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th {
            font-size: 14px;
            background-color: #f4f4f4;
            text-align: left;
            padding: 5px;
            border: 1px solid #ddd;
        }
        td {
            padding: 8px;
            border: 1px solid #ddd;
        }
        tr:nth-child(odd) {
            background-color: #f9f9f9;
        }
        tr:nth-child(even) {
            background-color: #ffffff;
        }
    </style>
</head>
<body>
    <table>
        <tr>
            <th>Coin</th>
            <th>Price</th>
            <th>24h Chg (%)</th>
            <th>Fib Levels + Dumps</th>`;

    if (volumeColumnVisible) {
        htmlContent += `<th>Vol Inc (%)</th>`;
    }

    htmlContent += `
            <th>Cap</th>
            <th>Rank</th>
            <th>Start Chg</th>
        </tr>`;

    for (const data of coinData) {
        const { coin, price_usd, circulation_usd, circulation_usd_rank, priceChangeFromStart, priceChange24h, volumeIncreasePercent, combinedLevels } = data;

        const formattedPrice = Number(price_usd).toFixed(getDecimalPlaces(price_usd));
        const formattedVolumeIncrease = Number(volumeIncreasePercent).toFixed(2);
        const formattedMarketCap = formatMarketCap(circulation_usd);
        const formattedChangeStart = Number(priceChangeFromStart).toFixed(2);
        const formattedChange24h = Number(priceChange24h).toFixed(2);

        // Combine Fibonacci and deep dump levels
        const precision = getDecimalPlaces(price_usd);
        const formattedCombinedLevels = combinedLevels
            .map(({ fib, dump }) => [fib, dump])
            .flat()
            .sort((a, b) => a - b)
            .map(level => {
                const levelColor = price_usd > level ? 'green' : 'red';
                return `<span style="color:${levelColor}">${level.toFixed(precision)}</span>`;
            })
            .join(', ');

        const colorStart = priceChangeFromStart > 0 ? 'green' : 'red';
        const color24h = priceChange24h > 0 ? 'green' : 'red';

        htmlContent += `<tr>`;
        htmlContent += `<td>${coin}</td>`;
        htmlContent += `<td>${formattedPrice}</td>`;
        htmlContent += `<td style="color:${color24h}">${formattedChange24h}%</td>`;
        htmlContent += `<td>${formattedCombinedLevels}</td>`;

        if (volumeColumnVisible) {
            htmlContent += `<td>${formattedVolumeIncrease}%</td>`;
        }

        htmlContent += `<td>${formattedMarketCap}</td>`;
        htmlContent += `<td>${circulation_usd_rank}</td>`;
        htmlContent += `<td style="color:${colorStart}">${formattedChangeStart}</td>`;
        htmlContent += `</tr>`;
    }

    htmlContent += `</table></body></html>`;
    fs.writeFileSync(htmlFilePath, htmlContent);
    console.log('HTML log updated successfully.');
}


// Refresh data sequentially
async function refreshDataSequentially(coins) {
    console.log('Refreshing data sequentially...');
    try {
        await fetchAssets(coins);
        updateHtmlLog();

        if (!browser) {
            browser = await chromium.launch({ executablePath: chromePath, headless: false });
            page = await browser.newPage();
            console.log('Opening browser to display updated log...');
            await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
        } else {
            console.log('Reloading browser page...');
            await page.reload({ waitUntil: 'load' });
        }

        console.log('Data refresh complete.');
    } catch (error) {
        console.error('Error during data refresh:', error.message);
    }
}

// Main function
async function main(coins) {
    const htmlFilePath = ensureFileExists(); // Ensure the directory and file exist

    // Serve the HTML log file
    app.get('/', (req, res) => {
        res.sendFile(htmlFilePath); // Serve the HTML file
    });

    app.listen(port, async () => {
        console.log(`Server running at http://localhost:${port}`);
        browser = await chromium.launch({
            headless: false,
            executablePath: chromePath
        });
        page = await browser.newPage();
        await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });

        // Trigger initial refresh immediately
        await refreshDataSequentially(coins);
        setInterval(() => refreshDataSequentially(coins), 60000); // Refresh every 1 minute
    });
}
