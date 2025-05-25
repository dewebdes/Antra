const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')();

let browser;
let page;
let refreshCount = 0;
let assetList = [];
let results = [];

// Set up Axios instance with proxy
const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Fetch the full list of asset prices before looping
async function fetchAllAssets() {
    console.log("Fetching full asset list...");
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        assetList = response.data.data.data; // Store asset data globally
        console.log("Asset list retrieved successfully.");
    } catch (error) {
        console.error("Error fetching asset list:", error.message);
        assetList = [];
    }
}

// Get the latest price of a specific coin from the asset list
function getFinalPrice(coin) {
    const assetData = assetList.find((item) => item.asset === coin);
    if (!assetData) {
        console.error(`Coin ${coin} not found in asset list.`);
        return 0;
    }
    return Number(assetData.price_usd); // Ensure accurate floating-point value
}

// Fetch system time from CoinEx API
async function getSystemTime() {
    try {
        console.log("Fetching system time...");
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return Number(response.data.data.current_timestamp);
    } catch (error) {
        console.error("Error fetching system time:", error.message);
        return null;
    }
}

// Fetch K-line data for market analysis
async function fetchKlines(coin, interval) {
    console.log(`Fetching system time for ${coin}...`);
    let sysTime = await getSystemTime();
    if (!sysTime) {
        console.error("Failed to fetch system time. Skipping K-line request.");
        return null;
    }

    let startTime = sysTime - (7 * 24 * 60 * 60); // Adjust for full 7-day range

    console.log(`Fetching K-line data for ${coin} from ${startTime} to ${sysTime}...`);
    try {
        const response = await axiosInstance.get(
            `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`
        );

        if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
            console.error(`Invalid K-line response for ${coin}`);
            return null;
        }

        console.log(`Successfully retrieved K-line data for ${coin}`);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-lines for ${coin}:`, error.message);
        return null;
    }
}

// Algorithmic calculation of entry and exit points using ATR
function calculatePoints(klines) {
    if (!klines) {
        console.error("No K-line data received. Skipping calculations...");
        return { entry: 0, exit: 0, reversalPercentage: 0, profit: 0 };
    }

    const atrPeriod = 14;
    const closePrices = klines.map(kline => Number(kline[4]));
    const highPrices = klines.map(kline => Number(kline[2]));
    const lowPrices = klines.map(kline => Number(kline[3]));

    const trueRanges = highPrices.map((high, i) => {
        const low = lowPrices[i];
        const prevClose = closePrices[i - 1] || closePrices[0];
        return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    });

    const atr = trueRanges.slice(-atrPeriod).reduce((sum, tr) => sum + tr, 0) / atrPeriod;
    const lastClose = closePrices[closePrices.length - 1];

    const entry = Number(lastClose - atr * 2);
    const exit = Number(lastClose + atr * 2);
    const reversalPercentage = Number(((exit - entry) / entry) * 100);
    const profit = Number(((exit - lastClose) / lastClose) * 100); // Adjusted profit calculation

    return { entry, exit, reversalPercentage, profit };
}

// Update HTML log **without duplicating coins and sorting by reversal percentage**
async function updateHtml(results) {
    console.log(`Updating HTML log (Refresh count: ${refreshCount})...`);

    // Sort results by reversal percentage (strongest signals first)
    results.sort((a, b) => b.reversalPercentage - a.reversalPercentage);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Real-Time Crypto Analysis</title>
            <style>
                body { font-family: Arial; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 8px; border: 1px solid black; text-align: center; }
                .high-confidence { background-color: lightgreen; }
                .medium-confidence { background-color: yellow; }
                .low-confidence { background-color: lightcoral; }
            </style>
        </head>
        <body>
            <h2>Crypto Reversal Analysis</h2>
            <p>Refresh Count: ${refreshCount}</p>
            <table>
                <tr><th>Coin</th><th>Current Price</th><th>Entry Price</th><th>Exit Price</th><th>Reversal %</th><th>Profit %</th><th>Confidence</th></tr>
                ${results.map(result => `
                    <tr class="${result.confidence === 'Yes' ? 'high-confidence' : result.confidence === 'Maybe' ? 'medium-confidence' : 'low-confidence'}">
                        <td>${result.coin}</td>
                        <td>${result.currentPrice}</td>
                        <td>${result.entry}</td>
                        <td>${result.exit}</td>
                        <td>${result.reversalPercentage.toFixed(4)}%</td>
                        <td>${result.profit.toFixed(4)}%</td>
                        <td>${result.confidence}</td>
                    </tr>
                `).join('')}
            </table>
        </body>
        </html>
    `;

    await page.setContent(htmlContent);
    console.log("HTML log updated successfully.");
}

// Main function
async function main() {
    const input = prompt("Enter coins (comma-separated): ");
    const coinList = input.split(',').map(c => c.trim().toUpperCase());

    console.log("Launching Chromium...");
    browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });

    page = await browser.newPage();
    console.log("Browser instance created.");

    await fetchAllAssets(); // Fetch asset list before entering the loop

    while (true) {
        for (const coin of coinList) {
            console.log(`Analyzing ${coin}...`);
            const currentPrice = getFinalPrice(coin);
            const klines = await fetchKlines(coin, 300);

            const { entry, exit, reversalPercentage, profit } = calculatePoints(klines);
            let confidence = reversalPercentage > 1.5 ? 'Yes' : reversalPercentage > 0.5 ? 'Maybe' : 'No';

            const existingCoinIndex = results.findIndex(r => r.coin === coin);
            if (existingCoinIndex !== -1) {
                results[existingCoinIndex] = { coin, currentPrice, entry, exit, reversalPercentage, profit, confidence };
            } else {
                results.push({ coin, currentPrice, entry, exit, reversalPercentage, profit, confidence });
            }

            await updateHtml(results);
            refreshCount++;

            console.log("Waiting 3 seconds before analyzing the next coin...");
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        await fetchAllAssets(); // Refresh asset list after each full loop cycle
    }
}

main();
