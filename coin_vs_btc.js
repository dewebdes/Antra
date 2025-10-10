const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
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

function isChartUnstable(klines) {
    const closes = klines.map(c => Number(c[4]));
    const max = Math.max(...closes);
    const min = Math.min(...closes);
    const range = ((max - min) / min) * 100;
    return range > 25;
}

function correlation(coinKlines, btcKlines) {
    const coinCloses = coinKlines.map(c => Number(c[4]));
    const btcCloses = btcKlines.map(c => Number(c[4]));
    const n = coinCloses.length;

    const avgCoin = coinCloses.reduce((a, b) => a + b, 0) / n;
    const avgBTC = btcCloses.reduce((a, b) => a + b, 0) / n;

    let numerator = 0, denomCoin = 0, denomBTC = 0;
    for (let i = 0; i < n; i++) {
        const x = coinCloses[i] - avgCoin;
        const y = btcCloses[i] - avgBTC;
        numerator += x * y;
        denomCoin += x * x;
        denomBTC += y * y;
    }

    const corr = numerator / Math.sqrt(denomCoin * denomBTC);
    return corr.toFixed(3);
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

        if (btcClose < btcOpen && coinClose > coinOpen) {
            oppositeBehaviorCount++;
        }

        if ((btcLow / btcOpen) < (coinLow / coinOpen)) {
            lessDumpCount++;
        }
    }

    if (oppositeBehaviorCount > 0 && lessDumpCount > 15) {
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

    const interval = 300;
    const limit = 30;

    console.log('Fetching data...');
    const sysTime = await getSystemTime();
    if (!sysTime) return;

    const btcKlines = await getKlines('BTCUSDT', interval, sysTime, limit);
    if (!btcKlines) return;

    let results = [];

    for (const coin of coins) {
        const coinKlines = await getKlines(`${coin}USDT`, interval, sysTime, limit);
        if (!coinKlines) continue;

        // 🔍 Experiential chart filter
        if (isChartUnstable(coinKlines)) {
            console.log(`⚠️ ${coin} chart is unstable. Skipping...`);
            continue;
        }

        // 🔍 Multi-timeframe bias check
        const coinKlines1H = await getKlines(`${coin}USDT`, 3600, sysTime, 24);
        if (!coinKlines1H) continue;

        const avg1H = coinKlines1H.map(c => Number(c[4])).reduce((a, b) => a + b, 0) / coinKlines1H.length;
        const lastClose = Number(coinKlines1H[coinKlines1H.length - 1][4]);
        const bias = ((lastClose - avg1H) / avg1H) * 100;

        if (bias < -5) {
            console.log(`⚠️ ${coin} shows bearish bias on 1H. Skipping...`);
            continue;
        }

        // 🔍 BTC correlation check
        const corrScore = correlation(coinKlines, btcKlines);
        if (Math.abs(corrScore) > 0.8) {
            console.log(`⚠️ ${coin} is highly correlated with BTC (${corrScore}). Skipping...`);
            continue;
        }

        const analysis = analyzePumpDay(coinKlines, btcKlines);
        results.push({ coin, corrScore, bias: bias.toFixed(2), ...analysis });
    }

    results.sort((a, b) => b.importanceScore - a.importanceScore);

    let log = `<html><head><title>Crypto Pump Analysis</title></head><body>
        <h1>Crypto Pump Analysis</h1>
        <table border="1">
            <tr>
                <th>Coin</th>
                <th>Opposite Behavior</th>
                <th>Less Dump</th>
                <th>Importance</th>
                <th>Pump Day?</th>
                <th>1H Bias</th>
                <th>BTC Corr</th>
            </tr>`;

    results.forEach(r => {
        log += `<tr>
            <td>${r.coin}</td>
            <td>${r.oppositeBehaviorCount}</td>
            <td>${r.lessDumpCount}</td>
            <td>${r.importanceScore}</td>
            <td>${r.isPumpDay ? 'Yes' : 'No'}</td>
            <td>${r.bias}%</td>
            <td>${r.corrScore}</td>
        </tr>`;
    });

    log += `</table></body></html>`;
    await saveLogAndOpenBrowser(log, 'crypto_pump_analysis.html');
}

main();
