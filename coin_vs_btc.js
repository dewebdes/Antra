const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1', // Replace with your proxy host
        port: 8082 // Replace with your proxy port
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) // Ignore SSL checks
});

async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
    }
}

async function getKlines(coin, interval, sysTime, limit) {
    const url = `https://www.coinex.com/res/market/kline?market=${coin}&start_time=${sysTime - limit * interval}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-lines data for ${coin}:`, error.message);
    }
}

function analyzePumpDay(coinKlines, btcKlines) {
    let isPumpDay = false;
    let lessDumpCount = 0;
    let oppositeBehaviorCount = 0;

    for (let i = 0; i < coinKlines.length; i++) {
        const coinOpen = Number(coinKlines[i][1]);
        const coinClose = Number(coinKlines[i][4]);
        const coinLow = Number(coinKlines[i][3]);

        const btcOpen = Number(btcKlines[i][1]);
        const btcClose = Number(btcKlines[i][4]);
        const btcLow = Number(btcKlines[i][3]);

        // Check for opposite behavior (BTC dumps while the coin pumps)
        if (btcClose < btcOpen && coinClose > coinOpen) {
            oppositeBehaviorCount++;
        }

        // Check for less dump compared to BTC
        if ((btcLow / btcOpen) < (coinLow / coinOpen)) {
            lessDumpCount++;
        }
    }

    // Confirm pump day if:
    // 1. There are instances of opposite behavior
    // 2. The coin has less dumps in a majority of candles
    if (oppositeBehaviorCount > 0 && lessDumpCount > 15) { // More than half the candles
        isPumpDay = true;
    }

    const importanceScore = oppositeBehaviorCount * 2 + lessDumpCount;

    return { isPumpDay, oppositeBehaviorCount, lessDumpCount, importanceScore };
}

async function saveLogAndOpenBrowser(log, fileName) {
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, log);

    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);
}

async function main() {
    const coinsInput = prompt('Enter coin names separated by commas (e.g., ETH,BNB,ADA): ').toUpperCase();
    const coins = coinsInput.split(',').map(coin => coin.trim());

    const interval = 300; // 5-minute interval
    const limit = 30; // Last 30 candles

    console.log('Fetching data...');
    const sysTime = await getSystemTime();
    if (!sysTime) {
        console.log('Failed to fetch system time. Aborting...');
        return;
    }

    const btcKlines = await getKlines('BTCUSDT', interval, sysTime, limit);
    if (!btcKlines) {
        console.log('Failed to fetch BTC K-lines data. Aborting...');
        return;
    }

    let results = [];

    for (const coin of coins) {
        const coinKlines = await getKlines(`${coin}USDT`, interval, sysTime, limit);
        if (!coinKlines) {
            console.log(`Failed to fetch K-lines data for ${coin}. Skipping...`);
            continue;
        }

        const analysis = analyzePumpDay(coinKlines, btcKlines);
        results.push({
            coin,
            ...analysis
        });
    }

    // Sort results by importance score in descending order
    results.sort((a, b) => b.importanceScore - a.importanceScore);

    let log = `<html>
    <head>
        <title>Crypto Pump Analysis</title>
    </head>
    <body>
        <h1>Crypto Pump Analysis</h1>
        <table border="1">
            <tr>
                <th>Coin</th>
                <th>Opposite Behavior Count</th>
                <th>Less Dump Count</th>
                <th>Importance Score</th>
                <th>Is Pump Day?</th>
            </tr>`;

    results.forEach(({ coin, oppositeBehaviorCount, lessDumpCount, importanceScore, isPumpDay }) => {
        log += `
            <tr>
                <td>${coin}</td>
                <td>${oppositeBehaviorCount}</td>
                <td>${lessDumpCount}</td>
                <td>${importanceScore}</td>
                <td>${isPumpDay ? 'Yes' : 'No'}</td>
            </tr>`;
    });

    log += `
        </table>
    </body>
    </html>`;

    const fileName = 'crypto_pump_analysis.html';
    await saveLogAndOpenBrowser(log, fileName);
}

main();
