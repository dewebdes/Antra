const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Set up Axios proxy (if needed)
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1', // Replace with your proxy host
        port: 8082 // Replace with your proxy port
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) // Ignore SSL checks
});

// Function to fetch system time from the exchange
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
    }
}

// Function to fetch k-line data using system time
async function getKlines(coin, interval, sysTime, limit) {
    const url = `https://www.coinex.com/res/market/kline?market=${coin}&start_time=${sysTime - limit * interval}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-lines data for ${coin}:`, error.message);
    }
}

// Function to analyze escape attempts using previous support and resistance points
function analyzeEscapeAttempts(coinKlines, interval) {
    const currentPrice = Number(coinKlines[coinKlines.length - 1][4]); // Latest closing price
    const candlesPerDay = Math.floor((24 * 60 * 60) / interval); // Number of candles in 1 day based on interval

    let previousSupport = null; // Minimum price that holds for 1 day
    let previousResistance = null; // Maximum price above the current price

    // Find previous support level
    for (let i = coinKlines.length - 2; i >= candlesPerDay; i--) {
        const candidateSupport = Number(coinKlines[i][3]); // Low price of the candidate support candle
        let isSupportValid = true;

        // Check if price stays above candidateSupport for the next 1 day
        for (let j = i + 1; j <= i + candlesPerDay && j < coinKlines.length; j++) {
            if (Number(coinKlines[j][3]) < candidateSupport) {
                isSupportValid = false;
                break;
            }
        }

        if (isSupportValid) {
            previousSupport = candidateSupport;
            break;
        }
    }

    // Find previous resistance level
    for (let i = coinKlines.length - 2; i >= 0; i--) {
        const high = Number(coinKlines[i][2]); // High price of the candle

        if (high > currentPrice && (previousResistance === null || high > previousResistance)) {
            previousResistance = high;
        }
    }

    // Fibonacci Levels (Optional for recovery analysis)
    const high = Math.max(...coinKlines.map(k => Number(k[2]))); // Highest price
    const low = Math.min(...coinKlines.map(k => Number(k[3]))); // Lowest price
    const fibLevels = {
        "23.6%": low + (high - low) * 0.236,
        "38.2%": low + (high - low) * 0.382,
        "50%": low + (high - low) * 0.5,
        "61.8%": low + (high - low) * 0.618,
        "78.6%": low + (high - low) * 0.786
    };

    let recoveryLevel = null;
    let recoveryPercent = 0;
    for (const [level, price] of Object.entries(fibLevels)) {
        if (currentPrice >= price) {
            recoveryLevel = level;
            recoveryPercent = parseFloat(level.replace('%', ''));
        }
    }

    return {
        currentPrice,
        previousSupport: previousSupport || 'N/A',
        previousResistance: previousResistance || 'N/A',
        recoveryLevel,
        recoveryPercent
    };
}

// Counter for refresh tracking
let refreshCount = 0;
let browser, page; // Initialize browser and page variables

// Function to save log and refresh the browser
async function saveLogAndRefreshBrowser(log, fileName) {
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, log);

    if (!browser || !page) {
        // Launch browser if it's not already open
        browser = await chromium.launch({
            headless: false,
            executablePath: path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
        });
        page = await browser.newPage();
    }
    // Refresh the current page to update content
    await page.goto(`file://${filePath}`);
}

// Function to fetch and analyze data for coins
async function analyzeCoins(coins, interval, limit, sysTime) {
    let results = [];

    for (const coin of coins) {
        const coinKlines = await getKlines(`${coin}USDT`, interval, sysTime, limit);
        if (!coinKlines) {
            console.log(`Failed to fetch K-lines data for ${coin}. Skipping...`);
            continue;
        }

        const analysis = analyzeEscapeAttempts(coinKlines, interval);
        // Exclude coins with zero recovery percent
        if (analysis.recoveryPercent > 0) {
            results.push({
                coin,
                ...analysis
            });
        }
    }

    // Sort results by recovery percent in descending order
    results.sort((a, b) => b.recoveryPercent - a.recoveryPercent);

    // Increment refresh count
    refreshCount++;

    // Generate HTML log
    let log = `<html>
    <head>
        <title>Crypto Escape Analysis - Refresh #${refreshCount}</title>
    </head>
    <body>
        <h1>Crypto Escape Analysis</h1>
        <h2>Refresh Count: ${refreshCount}</h2>
        <table border="1" style="border-collapse: collapse; width: 100%;">
            <tr style="background-color: #f2f2f2; text-align: left;">
                <th>Coin</th>
                <th>Current Price</th>
                <th>Previous Support</th>
                <th>Previous Resistance</th>
                <th>Recovery Level</th>
                <th>Recovery Percent</th>
            </tr>`;

    results.forEach(({ coin, currentPrice, previousSupport, previousResistance, recoveryLevel, recoveryPercent }, index) => {
        const rowColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9'; // White for even rows, light gray for odd rows
        log += `
            <tr style="background-color: ${rowColor};">
                <td>${coin}</td>
                <td>${currentPrice}</td>
                <td>${previousSupport}</td>
                <td>${previousResistance}</td>
                <td>${recoveryLevel || 'Below Levels'}</td>
                <td>${recoveryPercent}%</td>
            </tr>`;
    });

    log += `
        </table>
    </body>
    </html>`;

    const fileName = 'crypto_escape_analysis.html';
    await saveLogAndRefreshBrowser(log, fileName);
}

// Main function to initialize repeating task
async function main() {
    const coinsInput = prompt('Enter coin names separated by commas (e.g., ETH,BNB,ADA): ').toUpperCase();
    const coins = coinsInput.split(',').map(coin => coin.trim());

    const interval = 300; // 5-minute interval
    const limit = 500; // Increased for longer historical data

    setInterval(async () => {
        console.log('Fetching data...');
        const sysTime = await getSystemTime();
        if (!sysTime) {
            console.log('Failed to fetch system time. Aborting this iteration...');
            return;
        }

        await analyzeCoins(coins, interval, limit, sysTime);
    }, 60000); // Repeat every 1 minute (60000 milliseconds)
}

main();
