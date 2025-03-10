const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { chromium } = require('playwright');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require("crypto");
const randomUserAgent = require('random-useragent');

const https = require('https');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Configuration variables
const ACCESS_ID = "xxx"; // your access id
const SECRET_KEY = "xxx"; // your secret key
const port = 3000;
const chromePath = path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe');

// Define htmlFilePath here to be used globally
const htmlFilePath = path.resolve(__dirname, 'public', 'index.html');

// Create express app
const app = express();

// Create Axios instance for CoinEx API
const axiosInstance = axios.create({
    baseURL: 'https://api.coinex.com/',
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
        post: {
            'Content-Type': 'application/json',
        },
    },
    httpsAgent: new https.Agent({
        rejectUnauthorized: false,
    }),
    proxy: {
        host: '127.0.0.1',
        port: 8082,
    },
    timeout: 10000,
});

// Set Chrome path for Playwright
let initialVolumes = {};
let initialMarketCaps = {};
let previousCoinOffers = [];
let coinJumps = {}; // Track the number of jumps for each coin
let initialRanks = {};
let refreshCounter = 0;
let browser, page; // Declare browser and page variables
let intervalId; // Declare interval ID variable

// Fetch the latest assets data
async function fetchAssets() {
    try {

        const response = await axios.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000', {
            httpsAgent,
            proxy: {
                host: '127.0.0.1',
                port: 8082
            }
        });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching assets data:', error);
        return [];
    }



}

// Format volume values
function formatVolume(volume) {
    if (!volume) {
        return 'N/A'; // Return 'N/A' if volume is undefined or null
    }
    volume = parseFloat(volume); // Ensure volume is a number
    if (volume >= 1e9) {
        return (volume / 1e9).toFixed(2) + 'B';
    } else if (volume >= 1e6) {
        return (volume / 1e6).toFixed(2) + 'M';
    } else if (volume >= 1e3) {
        return (volume / 1e3).toFixed(2) + 'K';
    } else {
        return volume.toFixed(2);
    }
}

// Calculate volume increase percentage based on initial volume vs. current volume
function calculateVolumeIncreasePercentage(volume_usd, initial_volume_usd) {
    const latestVolume = parseFloat(volume_usd);
    const initialVolume = parseFloat(initial_volume_usd);
    if (initialVolume === 0) return 0; // Avoid division by zero
    const volumeIncreasePercentage = ((latestVolume - initialVolume) / initialVolume) * 100;
    return volumeIncreasePercentage;
}

// Calculate market cap increase percentage based on initial market cap vs. current market cap
function calculateMarketCapIncreasePercentage(market_cap_usd, initial_market_cap_usd) {
    const latestMarketCap = parseFloat(market_cap_usd);
    const initialMarketCap = parseFloat(initial_market_cap_usd);
    if (initialMarketCap === 0) return 0; // Avoid division by zero
    const marketCapIncreasePercentage = ((latestMarketCap - initialMarketCap) / initialMarketCap) * 100;
    return marketCapIncreasePercentage;
}

// Calculate price increase percentage based on initial price vs. current price
function calculatePriceIncreasePercentage(price_usd, initial_price_usd) {
    const latestPrice = parseFloat(price_usd);
    const initialPrice = parseFloat(initial_price_usd);
    if (initialPrice === 0) return 0; // Avoid division by zero
    const priceIncreasePercentage = ((latestPrice - initialPrice) / initialPrice) * 100;
    return priceIncreasePercentage;
}

// Calculate rank increase percentage based on initial rank vs. current rank
function calculateRankIncreasePercentage(currentRank, initialRank) {
    const rankIncreasePercentage = ((initialRank - currentRank) / initialRank) * 100;
    return rankIncreasePercentage;
}

// Calculate standard deviation of volume increases
function calculateStandardDeviation(volumeIncreases) {
    const mean = volumeIncreases.reduce((sum, volume) => sum + volume, 0) / volumeIncreases.length;
    const variance = volumeIncreases.reduce((sum, volume) => sum + Math.pow(volume - mean, 2), 0) / volumeIncreases.length;
    return Math.sqrt(variance);
}

// Calculate buy-price using Fibonacci retracement levels
function calculateBuyPrice(asset, currentPrice, isLong = true) {
    const klinesFilePath = path.join(__dirname, 'output', `${asset}.json`);
    if (!fs.existsSync(klinesFilePath)) {
        throw new Error(`Klines file not found for asset: ${asset}`);
    }

    const klinesData = JSON.parse(fs.readFileSync(klinesFilePath, 'utf8')).data;
    if (!Array.isArray(klinesData)) {
        throw new Error(`Invalid klines data for asset: ${asset}`);
    }

    const closePrices = klinesData.map(kline => parseFloat(kline[4])); // Assume close price is at index 4

    const high = Math.max(...closePrices);
    const low = Math.min(...closePrices);
    const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786];

    let retracementLevels;
    if (isLong) {
        retracementLevels = fibLevels.map(level => low + level * (high - low));
    } else {
        const last30Elements = closePrices.slice(-30);
        const dumpLow = Math.min(...last30Elements);
        const dumpIndex = last30Elements.indexOf(dumpLow);
        const maxAfterDump = Math.max(...last30Elements.slice(dumpIndex));
        retracementLevels = fibLevels.map(level => dumpLow + level * (maxAfterDump - dumpLow));
    }

    // Select the buy price (e.g., using the 0.618 retracement level)
    let buyPrice = retracementLevels[3];

    // Ensure the buy price is below the current price
    if (buyPrice >= currentPrice) {
        buyPrice = currentPrice * 0.95;
    }

    return buyPrice.toFixed(8);
}

// Generate the signal list and refresh HTML log
async function generateSignalList() {
    console.log('Starting to generate the signal list.');
    clearInterval(intervalId); // Clear the interval

    try {
        const assetsData = await fetchAssets();
        console.log('Type of assetsData:', typeof assetsData); // Log the type of assetsData
        console.log('AssetsData Keys:', Object.keys(assetsData)); // Log the keys of assetsData

        // Access the correct property within assetsData
        const assets = assetsData.data; // Correctly access the data array
        const coinOffers = [];
        let rowIndex = 1; // Initialize row index for numbering rows

        for (const asset of assets) {
            const { asset: coin, price_usd, volume_usd, circulation_usd_rank, circulation_usd } = asset;
            const initial_volume_usd = initialVolumes[coin] || volume_usd;  // Use current volume if initial volume is not available
            const initial_market_cap_usd = initialMarketCaps[coin] || circulation_usd;
            const initial_price_usd = initialVolumes[coin] || price_usd; // Use current price if initial price is not available
            const initial_rank = initialRanks[coin] || circulation_usd_rank;

            initialVolumes[coin] = initialVolumes[coin] || volume_usd;
            initialMarketCaps[coin] = initialMarketCaps[coin] || circulation_usd;
            initialRanks[coin] = initialRanks[coin] || circulation_usd_rank;

            try {
                const volumeIncreasePercentage = calculateVolumeIncreasePercentage(volume_usd, initial_volume_usd);
                const marketCapIncreasePercentage = calculateMarketCapIncreasePercentage(circulation_usd, initial_market_cap_usd);
                const priceIncreasePercentage = calculatePriceIncreasePercentage(price_usd, initial_price_usd);
                const rankIncreasePercentage = calculateRankIncreasePercentage(circulation_usd_rank, initial_rank);
                const buyPriceLong = calculateBuyPrice(coin, parseFloat(price_usd), true);  // Calculate buy price using Fibonacci retracement for long
                const buyPriceShort = calculateBuyPrice(coin, parseFloat(price_usd), false);  // Calculate buy price for short

                // Track the number of jumps for each coin
                coinJumps[coin] = coinJumps[coin] || 0;
                const previousOffer = previousCoinOffers.find(o => o.coin === coin);
                if (previousOffer && volumeIncreasePercentage > previousOffer.volumeIncreasePercentage) {
                    coinJumps[coin]++;
                }

                // Calculate the standard deviation of volume increases over the last 30 candlesticks
                const klinesFilePath = path.join(__dirname, 'output', `${coin}.json`);
                const klinesData = JSON.parse(fs.readFileSync(klinesFilePath, 'utf8')).data;
                const volumeIncreases = klinesData.slice(-30).map((kline, index, array) => {
                    if (index === 0) return 0; // Skip the first candlestick
                    return (parseFloat(kline[5]) - parseFloat(array[index - 1][5])) / parseFloat(array[index - 1][5]) * 100;
                });
                const pump = calculateStandardDeviation(volumeIncreases);

                coinOffers.push({
                    coin, price_usd, buyPriceLong, buyPriceShort, volume_usd,
                    volumeIncreasePercentage, marketCapIncreasePercentage,
                    priceIncreasePercentage, rankIncreasePercentage,
                    jumps: coinJumps[coin], rowIndex, pump,
                    marketCap: circulation_usd // Add marketCap to the coinOffers
                });
                rowIndex++;
                console.log(`Processed ${coin}: Volume Increase % = ${volumeIncreasePercentage.toFixed(2)}%, Pump = ${pump.toFixed(2)}`);
            } catch (error) {
                console.error(`Failed to process ${coin}:`, error.message);
            }
        }

        // Sort coin offers based on the pump metric (descending)
        coinOffers.sort((a, b) => b.pump - a.pump || b.volumeIncreasePercentage - a.volumeIncreasePercentage);

        console.log('Sorted the coin offers based on the pump metric.');

        // Determine the maximum jump value
        const maxJumps = Math.max(...coinOffers.map(offer => offer.jumps));
        const topJumpCount = coinOffers.filter(offer => offer.jumps === maxJumps).length;

        refreshCounter++; // Increment the refresh counter

        // Create HTML table
        let htmlContent = `<html><head><title>Refresh Count: ${refreshCounter}</title></head><body>`;
        htmlContent += '<script src="apiconnect.js"></script>';
        htmlContent += '<table border="1"><tr><th>#</th><th>Coin</th><th>Price (USD)</th><th>Buy Price (Long)</th><th>Buy Price (Short)</th><th>Volume (USD)</th><th>Volume Increase (%)</th><th>Market Cap (USD)</th><th>Market Cap Increase (%)</th><th>Price Increase (%)</th><th>Rank Increase (%)</th><th>Jumps</th><th>Pump</th></tr>';

        var rowindx = 0;
        for (const offer of coinOffers) {
            const coinLink = `https://www.coinex.com/en/exchange/${offer.coin}-usdt`;
            const previousOffer = previousCoinOffers.find(o => o.coin === offer.coin);
            const isLevelUp = previousOffer && offer.volumeIncreasePercentage > previousOffer.volumeIncreasePercentage;
            const coinNameStyle = isLevelUp ? 'color: red;' : '';
            const jumpStyle = offer.jumps === maxJumps ? 'color: red;' : '';
            const formattedVolume = formatVolume(offer.volume_usd);
            const formattedMarketCap = formatVolume(offer.marketCap);

            htmlContent += `<tr><td>${rowindx++}</td><td><a href="#${coinLink}" onclick="sendInput('${offer.coin}');return false;" target="_blank" style="${coinNameStyle}">${offer.coin}</a></td><td>${offer.price_usd}</td><td>${offer.buyPriceLong}</td><td>${offer.buyPriceShort}</td><td>${formattedVolume}</td><td>${offer.volumeIncreasePercentage.toFixed(2)}%</td><td>${formattedMarketCap}</td><td>${offer.marketCapIncreasePercentage.toFixed(2)}%</td><td>${offer.priceIncreasePercentage.toFixed(2)}%</td><td>${offer.rankIncreasePercentage.toFixed(2)}%</td><td style="${jumpStyle}">${offer.jumps}</td><td>${offer.pump.toFixed(2)}</td></tr>`;
        }
        htmlContent += '</table></body></html>';

        // Save to HTML file
        fs.writeFileSync(htmlFilePath, htmlContent);
        console.log('Coin buy offers have been saved to coin_buy_offers.html');

        // Serve the HTML file via Express
        app.get('/', (req, res) => {
            res.sendFile(htmlFilePath);
        });

        // Open or refresh HTML log with Playwright
        if (!browser) {
            browser = await chromium.launch({ executablePath: chromePath, headless: false });
            page = await browser.newPage();
            await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
        } else {
            await page.reload({ waitUntil: 'load' });
        }
        console.log('Opened or refreshed the HTML log with Playwright.');

        // Store the current coin offers as the previous coin offers for the next interval
        previousCoinOffers = coinOffers;

    } catch (error) {
        console.error('Error generating signal list:', error);
        intervalId = setInterval(generateSignalList, 300000);
    }

    // Reset the interval after the process is complete
    intervalId = setInterval(generateSignalList, 300000); // Update every 5 minutes (300000 milliseconds)
}

// Start the initial interval
intervalId = setInterval(generateSignalList, 300000);  // Update every 5 minutes (300000 milliseconds)

generateSignalList().catch(console.error);

// Express.js server setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.post('/process', async (req, res) => {
    const coin = req.body.coin;
    const money = req.body.money;
    const result = await processRiskCalculation(coin, money);
    res.send({ result });
});

function createAuthorization(method, request_path, body_json, timestamp) {
    var text = method + request_path + body_json + timestamp + SECRET_KEY;
    console.log(text);
    return crypto
        .createHash("sha256")
        .update(text)
        .digest("hex")
        .toUpperCase();
}

async function processRiskCalculation(coin, money) {
    const timetamp = Date.now();
    const res = await axiosInstance.get(`/v2/spot/deals?market=${coin}USDT`, {
        headers: {
            "X-COINEX-KEY": ACCESS_ID,
            "X-COINEX-SIGN": createAuthorization("GET", "/v2/spot/deals", "", timetamp),
            "X-COINEX-TIMESTAMP": timetamp,
        }
    });
    var counter = 0;
    for (var i = 0; i <= res.data.data.length - 1; i++) {
        var mon = parseInt(parseFloat(res.data.data[i].amount) * parseFloat(res.data.data[i].price));
        if (mon >= money) {
            counter++;
        }
    }
    console.log(counter);
    return counter < 5 ? 'bad' : 'good';
}

app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);

    // Open the HTML file in Playwright with the visible browser
    browser = await chromium.launch({
        headless: false, // This will make the browser visible
        executablePath: chromePath // Use the specified Chrome path
    });
    page = await browser.newPage();
    await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
});
