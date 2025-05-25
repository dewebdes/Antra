const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const player = require('play-sound')({ player: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" });
const playwright = require('playwright');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTML_FILE_PATH = path.join(__dirname, 'crypto_status.html');

const PROXY_CONFIG = {
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
};

const axiosInstance = axios.create(PROXY_CONFIG);
let refreshCount = 0;

// Timeframe selection function
function getIntervalMilliseconds() {
    console.log("Select timeframe:");
    console.log("1 - 5m");
    console.log("2 - 15m");
    console.log("3 - 1h");
    console.log("4 - 4h");
    console.log("5 - 1d");

    let choice = prompt("Enter the number of your desired timeframe: ");
    const intervalMap = { "1": 300, "2": 900, "3": 3600, "4": 14400, "5": 86400 };

    return intervalMap[choice] || 300;
}

async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time', { timeout: 5000 });
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

async function getCoinNames() {
    const coinInput = prompt('Enter coins (comma-separated, e.g., BTC,ETH,XRP): ').trim();
    if (!coinInput) {
        console.error('Error: No coin names entered.');
        process.exit(1);
    }
    return coinInput.split(',').map(coin => coin.toUpperCase());
}

async function getKlines(coin, days, interval) {
    const sysTime = await getSystemTime();
    if (!sysTime) return [];

    console.log(`Fetching ${days}-day K-lines for ${coin} (Interval: ${interval}s)...`);
    const startTime = sysTime - (days * 86400000);
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;

    try {
        const response = await axiosInstance.get(url, { timeout: 5000 });
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-lines for ${coin}:`, error.message);
        return [];
    }
}

function calculateDeviation(pastKlines, todayKlines, coin) {
    if (pastKlines.length < 8 || todayKlines.length < 2) return null;

    const latestKline = todayKlines[todayKlines.length - 1];
    const todayPercentChange = ((latestKline[2] - latestKline[1]) / latestKline[1]) * 100;

    const avgPercentChange = pastKlines.reduce((sum, prevKline) => {
        return sum + Math.abs((prevKline[2] - prevKline[1]) / prevKline[1]) * 100;
    }, 0) / pastKlines.length;

    return { coin: coin, deviation: todayPercentChange - avgPercentChange, timestamp: latestKline[0] };
}

function calculateCurrentMovement(dailyKlines, coin) {
    if (!dailyKlines.length) return null;

    const today = dailyKlines[dailyKlines.length - 1];
    const todayPercentChange = ((today[2] - today[1]) / today[1]) * 100;

    return {
        coin: coin,
        currentMovement: todayPercentChange > 0 ? `${todayPercentChange.toFixed(2)}% (Pump)` : `${todayPercentChange.toFixed(2)}% (Dump)`
    };
}

async function updateHtmlLog(deviationData, firstRun, page) {
    refreshCount++;
    deviationData.sort((a, b) => b.deviation - a.deviation);

    let htmlContent = `<html><head><title>Crypto Status</title>
        <style>table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid black; }
        .pump { color: green; } .dump { color: red; }</style></head><body>
        <h2>Real-Time Crypto Market Tracking</h2>
        <p>Refresh Count: ${refreshCount}</p>
        <table><tr><th>Coin</th><th>Deviation (%)</th><th>24H Movement</th></tr>`;

    deviationData.forEach((data) => {
        htmlContent += `<tr><td>${data.coin}</td><td>${data.deviation.toFixed(2)}%</td>
        <td class="${data.currentMovement.includes('Pump') ? 'pump' : 'dump'}">${data.currentMovement}</td></tr>`;
    });

    htmlContent += `</table></body></html>`;
    fs.writeFileSync(HTML_FILE_PATH, htmlContent);
    console.log("HTML log updated!");

    await page.setContent(htmlContent);
}

async function main() {
    const coins = await getCoinNames();
    const selectedInterval = getIntervalMilliseconds();
    let deviationData = [];
    let firstRun = true;

    const browser = await playwright.chromium.launch({ executablePath: CHROME_PATH, headless: false });
    const page = await browser.newPage();
    await page.goto(`file://${HTML_FILE_PATH}`);

    while (true) {
        deviationData = []; // Reset the list before each refresh

        for (const coin of coins) {
            const pastKlines = await getKlines(coin, 7, selectedInterval);
            const todayKlines = await getKlines(coin, 1, selectedInterval);
            const dailyKlines = await getKlines(coin, 1, 86400); // Daily movement

            const deviation = calculateDeviation(pastKlines, todayKlines, coin);
            const currentMovement = calculateCurrentMovement(dailyKlines, coin);

            if (deviation && currentMovement) {
                deviationData.push({ ...deviation, ...currentMovement });
            }
        }

        await updateHtmlLog(deviationData, firstRun, page);
        firstRun = false;
    }

}

main();
