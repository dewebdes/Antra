const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) // Ignore SSL checks
});

async function getCoinName() {
    const coinName = prompt('Enter the coin name: ');
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
            interval = '300'; // 5m
            break;
        case 2:
            interval = '900'; // 15m
            break;
        case 3:
            interval = '3600'; // 1h
            break;
        case 4:
            interval = '86400'; // 1d
            break;
        default:
            console.log('Invalid choice, defaulting to 5m interval.');
            interval = '300'; // 5m
    }
    return interval;
}

async function getMinMaxPrices() {
    const minPrice = parseFloat(prompt('Enter the minimum price: '));
    const maxPrice = parseFloat(prompt('Enter the maximum price: '));
    return { minPrice, maxPrice };
}
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error);
    }
}

async function getKlines(coin, interval, sysTime) {
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=1000000000&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching K-lines data:', error);
    }
}

function analyzeKlines(klines, minPrice, maxPrice) {
    let status = 'stable';

    const firstKline = klines[0];
    const lastKline = klines[klines.length - 1];
    const openPrice = parseFloat(firstKline[1]);
    const closePrice = parseFloat(lastKline[4]);

    if (closePrice < minPrice) {
        status = 'dump';
    } else if (closePrice > maxPrice) {
        status = 'pump';
    }

    return status;
}

function calculateFibonacciLevels(minPrice, maxPrice) {
    const fibLevels = {};
    const diff = maxPrice - minPrice;

    fibLevels[0] = maxPrice;
    fibLevels[23.6] = maxPrice - diff * 0.236;
    fibLevels[38.2] = maxPrice - diff * 0.382;
    fibLevels[50] = maxPrice - diff * 0.5;
    fibLevels[61.8] = maxPrice - diff * 0.618;
    fibLevels[78.6] = maxPrice - diff * 0.786;
    fibLevels[100] = minPrice;

    return fibLevels;
}
function detectPricePoints(klines, minPrice, maxPrice) {
    const fibLevels = calculateFibonacciLevels(minPrice, maxPrice);
    const firstKline = klines[0];
    const lastKline = klines[klines.length - 1];
    const openPrice = parseFloat(firstKline[1]);
    const closePrice = parseFloat(lastKline[4]);

    const pricePoints = {
        dumps: [],
        pumps: []
    };

    for (const [level, price] of Object.entries(fibLevels)) {
        if (closePrice < price) {
            pricePoints.dumps.push({ level, price });
        } else if (closePrice > price) {
            pricePoints.pumps.push({ level, price });
        }
    }

    return pricePoints;
}

function calculatePumpPoints(maxPrice) {
    const pumpLevels = {};
    const diff = maxPrice * 0.618;

    pumpLevels[127.2] = maxPrice * 1.272;
    pumpLevels[161.8] = maxPrice * 1.618;
    pumpLevels[261.8] = maxPrice * 2.618;

    return pumpLevels;
}

function calculateDeepDumpPoints(minPrice, maxPrice) {
    const deepDumpLevels = {};
    const diff = maxPrice - minPrice;

    deepDumpLevels[127.2] = minPrice - diff * 0.272;
    deepDumpLevels[161.8] = minPrice - diff * 0.618;
    deepDumpLevels[261.8] = minPrice - diff * 1.618;

    return deepDumpLevels;
}

async function getDailyKlines(coin, sysTime) {
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=1000000000&end_time=${sysTime}&interval=86400`; // 1d interval
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching daily K-lines data:', error);
    }
}

function findPumpPointsFromKlines(dailyKlines, maxPrice) {
    const pumpPointsFromKlines = [];

    for (const kline of dailyKlines) {
        const highPrice = parseFloat(kline[2]);
        if (highPrice > maxPrice) {
            pumpPointsFromKlines.push(highPrice);
            if (pumpPointsFromKlines.length === 3) {
                break;
            }
        }
    }

    return pumpPointsFromKlines;
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
    const coin = await getCoinName();
    await printStrategies();
    const interval = await chooseStrategy();
    const { minPrice, maxPrice } = await getMinMaxPrices();
    const sysTime = await getSystemTime();

    const klines = await getKlines(coin, interval, sysTime);
    const dailyKlines = await getDailyKlines(coin, sysTime);

    const status = analyzeKlines(klines, minPrice, maxPrice);
    const pricePoints = detectPricePoints(klines, minPrice, maxPrice);
    const pumpPoints = calculatePumpPoints(maxPrice);
    const deepDumpPoints = calculateDeepDumpPoints(minPrice, maxPrice);
    const pumpPointsFromKlines = findPumpPointsFromKlines(dailyKlines, maxPrice);

    let log = `<html>
  <head>
    <title>Trading Analysis for ${coin}</title>
  </head>
  <body>
    <h1>Trading Analysis for ${coin}</h1>
    <p>Status: ${status}</p>
    <h2>Fibonacci Levels</h2>
    <table border="1">
      <tr>
        <th>Level</th>
        <th>Price</th>
      </tr>`;

    const fibLevels = calculateFibonacciLevels(minPrice, maxPrice);
    for (const [level, price] of Object.entries(fibLevels)) {
        log += `<tr>
                <td>${level}%</td>
                <td>${price}</td>
              </tr>`;
    }

    log += `</table>
    <h2>Dump Points</h2>
    <ul>`;

    for (const dump of pricePoints.dumps) {
        log += `<li>${dump.level}%: ${dump.price}</li>`;
    }

    log += `</ul>
    <h2>Deep Dump Points</h2>
    <ul>`;

    for (const [level, price] of Object.entries(deepDumpPoints)) {
        log += `<li>${level}%: ${price}</li>`;
    }

    log += `</ul>
    <h2>Pump Points</h2>
    <ul>`;

    for (const [level, price] of Object.entries(pumpPoints)) {
        log += `<li>${level}%: ${price}</li>`;
    }

    for (const pumpPrice of pumpPointsFromKlines) {
        log += `<li>Historical High: ${pumpPrice}</li>`;
    }

    log += `</ul>
    <h2>Daily K-lines Analysis</h2>
    <ul>`;

    for (const kline of dailyKlines) {
        log += `<li>Date: ${new Date(kline[0] * 1000).toLocaleDateString()}, Open: ${kline[1]}, Low: ${kline[2]}, High: ${kline[3]}, Close: ${kline[4]}, Volume: ${kline[5]}</li>`;
    }

    log += `</ul>
  </body>
  </html>`;

    await saveLogAndOpenBrowser(log, `${coin}_trading_analysis.html`);
}

main();
