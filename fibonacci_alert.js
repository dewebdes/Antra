const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const player = require('play-sound')({ player: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" }); // Specify VLC path

const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

let browser; // Persistent browser instance
let page;    // Persistent page instance
let skipSound = true; // Ensure no sound is played on the first analysis
let isPlayingSound = false; // Prevent multiple overlapping sound plays

let levelStates = {}; // Keeps track of each level's state (safe/dropped)

async function getCoinName() {
    const coinName = prompt('Enter the coin name (e.g., BTC): ').trim();
    if (!coinName) {
        console.error('Error: No coin name entered. Please provide a valid coin name.');
        process.exit(1); // Exit the script if no input is given
    }
    return coinName.toUpperCase();
}


async function printStrategies() {
    console.log('Trading Strategies:');
    console.log('1. Short-Term Trading (Scalping) - Intervals: 1m, 5m, 15m');
    console.log('2. Intraday Trading - Intervals: 15m, 30m, 1h');
    console.log('3. Swing Trading - Intervals: 1h, 4h, 1d');
    console.log('4. Long-Term Trading (Position Trading) - Intervals: 1d, 1w, 1m');
}

async function chooseStrategy() {
    const strategyNumber = parseInt(prompt('Choose the strategy number (1-4): '), 10);
    let interval;
    switch (strategyNumber) {
        case 1:
            interval = '60'; // 1 minute
            break;
        case 2:
            interval = '900'; // 15 minutes
            break;
        case 3:
            interval = '3600'; // 1 hour
            break;
        case 4:
            interval = '86400'; // 1 day
            break;
        default:
            console.log('Invalid choice, defaulting to 1-minute interval.');
            interval = '60'; // 1 minute
    }
    return interval;
}

// Replace user input with min and max price calculation
async function getMinMaxPrices(coin) {
    console.log(`Fetching min and max prices for the past 24 hours for ${coin}...`);
    try {
        const sysTime = await getSystemTime(); // Get the current system time
        const klines = await fetch5mKlines(coin, sysTime); // Fetch 5-minute K-line data
        if (!klines) {
            throw new Error('Failed to fetch K-line data.');
        }
        const { minPrice, maxPrice } = getMaxAndMinPrices(klines); // Calculate min and max prices
        console.log(`Calculated Min Price: ${minPrice}, Max Price: ${maxPrice}`);
        return { minPrice, maxPrice };
    } catch (error) {
        console.error('Error calculating min and max prices:', error.message);
        process.exit(1); // Exit if unable to fetch or calculate
    }
}

// Function to fetch the current system time
async function getSystemTime() {
    console.log('Fetching system time...');
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        console.log('Successfully fetched system time:', response.data.data.current_timestamp);
        return response.data.data.current_timestamp; // Return the current system timestamp
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

// Function to fetch 5-minute K-line data for the past 24 hours
async function fetch5mKlines(coin, sysTime) {
    console.log(`Fetching 5-minute K-line data for ${coin}...`);
    const interval = 300; // 5-minute interval
    const startTime = sysTime - (24 * 60 * 60); // Last 24 hours
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        console.log(`Successfully fetched 5-minute K-line data for ${coin}.`);
        return response.data.data; // Return the K-line data
    } catch (error) {
        console.error(`Error fetching 5-minute K-lines for ${coin}:`, error.message);
        return null;
    }
}

// Function to calculate the maximum and minimum prices
function getMaxAndMinPrices(klines) {
    console.log('Calculating max and min prices...');
    let maxPrice = -Infinity;
    let minPrice = Infinity;

    klines.forEach(kline => {
        const high = parseFloat(kline[2]); // High price
        const low = parseFloat(kline[3]);  // Low price

        if (high > maxPrice) maxPrice = high;
        if (low < minPrice) minPrice = low;
    });

    console.log(`Max price: ${maxPrice}, Min price: ${minPrice}`);
    return { maxPrice, minPrice };
}

async function getFinalPrice(coin) {
    try {
        const response = await axios.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000');
        const assetData = response.data.data.data.find((item) => item.asset === coin);
        return parseFloat(assetData.price_usd);
    } catch (error) {
        console.error('Error fetching final price:', error.message);
        return null; // Return null to indicate failure
    }
}

function calculateFibonacciLevels(minPrice, maxPrice) {
    const fibLevels = {};
    const diff = maxPrice - minPrice;

    // Fibonacci Levels
    fibLevels[0] = maxPrice;
    fibLevels[23.6] = maxPrice - diff * 0.236;
    fibLevels[38.2] = maxPrice - diff * 0.382;
    fibLevels[50] = maxPrice - diff * 0.5;
    fibLevels[61.8] = maxPrice - diff * 0.618;
    fibLevels[78.6] = maxPrice - diff * 0.786;
    fibLevels[100] = minPrice;

    return fibLevels;
}

function calculateDeepDumpPoints(minPrice, maxPrice) {
    const deepDumpLevels = {};
    const diff = maxPrice - minPrice;

    // Deep Dump Points using 127.2%, 161.8%, and 261.8% below min price
    deepDumpLevels['127.2'] = minPrice - diff * 0.272;
    deepDumpLevels['161.8'] = minPrice - diff * 0.618;
    deepDumpLevels['261.8'] = minPrice - diff * 1.618;

    return deepDumpLevels;
}

async function saveLogAndOpenBrowser(log, fileName) {
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, log);

    if (!browser) {
        // Launch the browser only once
        browser = await chromium.launch({
            headless: false,
            executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Path to your Chrome
        });
        page = await browser.newPage();
        await page.goto(`file://${filePath}`);
    } else {
        // Refresh the existing page
        await page.reload();
    }
}

async function playAlertSound() {
    if (skipSound) {
        skipSound = false; // Skip the sound only for the first analysis
        return;
    }

    if (isPlayingSound) {
        console.log('Sound is already playing, skipping duplicate trigger.');
        return; // Prevent overlapping sound plays
    }

    try {
        isPlayingSound = true; // Set the flag to prevent overlapping sounds
        player.play('alert.mp3', (err) => {
            if (err) {
                console.error('Error playing sound with VLC:', err.message);
            } else {
                console.log('Sound played successfully with VLC!');
            }
        });
    } finally {
        isPlayingSound = false; // Reset the flag once done
    }
}

async function analyzeAndLog(coin, interval, minPrice, maxPrice, levels, intervalCount) {
    const closePrice = await getFinalPrice(coin);

    if (closePrice === null) {
        console.log('Error fetching final price. Retrying in 1 minute...');
        return; // Skip this iteration, but the app won't crash
    }

    const { fibLevels, deepDumpPoints } = levels;

    // Combine Fibonacci Levels and Deep Dump Points
    const combinedLevels = { ...fibLevels, ...deepDumpPoints };

    // Sort combined levels by price in descending order
    const sortedLevels = Object.entries(combinedLevels).sort(([, priceA], [, priceB]) => priceB - priceA);

    // Generate HTML log
    let log = `<html>
    <head>
        <title>Trading Analysis for ${coin}</title>
    </head>
    <body>
    <h1>Trading Analysis for ${coin}</h1>
    <p>Interval Count: ${intervalCount}</p>
    <p>Final Price: ${closePrice}</p>
    <table border="1">
    <tr><th>Level Name</th><th>Price Level</th><th>Status</th></tr>`;

    for (const [levelName, price] of sortedLevels) {
        let status = 'Safe';
        let color = 'green';

        if (closePrice < price) {
            if (levelStates[price] === 'safe') {
                console.log(`Price dropped below ${levelName}: ${price}`);
                if (!skipSound) {
                    await playAlertSound(); // Play the alert sound if not the first analysis
                }
                levelStates[price] = 'dropped';
            }
            status = 'Dropped';
            color = 'red';
        } else {
            levelStates[price] = 'safe';
        }

        log += `<tr><td>${levelName}</td><td>${price}</td><td style="color: ${color};">${status}</td></tr>`;
    }

    log += `</table>
    </body>
    </html>`;

    await saveLogAndOpenBrowser(log, `${coin}_trading_analysis.html`);

    if (skipSound) {
        skipSound = false; // Set skipSound to false after the first analysis
    }
}

async function monitorPrices(coin, interval, minPrice, maxPrice, levels) {
    let intervalCount = 1;

    const retryIntervalMs = 60000; // 1 minute

    const monitor = async () => {
        try {
            await analyzeAndLog(coin, interval, minPrice, maxPrice, levels, intervalCount);
            intervalCount++;
        } catch (error) {
            console.error('Error during monitoring:', error.message);
        } finally {
            setTimeout(monitor, retryIntervalMs);
        }
    };

    await monitor();
}

async function main() {
    const coin = await getCoinName();
    console.log(`Using coin name: ${coin}`); // Debugging log
    await printStrategies();
    const interval = await chooseStrategy();
    const { minPrice, maxPrice } = await getMinMaxPrices(coin); // Pass the coin name here
    const fibLevels = calculateFibonacciLevels(minPrice, maxPrice);
    const deepDumpPoints = calculateDeepDumpPoints(minPrice, maxPrice);
    const levels = { fibLevels, deepDumpPoints };

    for (const level in fibLevels) {
        levelStates[fibLevels[level]] = 'safe';
    }
    for (const level in deepDumpPoints) {
        levelStates[deepDumpPoints[level]] = 'safe';
    }

    await monitorPrices(coin, interval, minPrice, maxPrice, levels);
}


main();
