// Fully optimized script using 5-minute intervals for deviation & 24-hour movement for current movement

const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const player = require('play-sound')({ player: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" });
const playwright = require('playwright');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"; // Exact path
const HTML_FILE_PATH = path.join(__dirname, 'crypto_status2.html'); // Ensure correct file path

const PROXY_CONFIG = {
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) // Ignore SSL checks
};

const axiosInstance = axios.create(PROXY_CONFIG); // Use proxy for all requests
let refreshCount = 0; // Track update cycles

// Ensure HTML file exists before launching browser
function createInitialHtmlFile() {
    const initialHtml = `<html><head><title>Crypto Status</title></head><body>
        <h2>Waiting for updates...</h2></body></html>`;
    fs.writeFileSync(HTML_FILE_PATH, initialHtml);
    console.log("Initialized HTML file.");
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

async function getDailyKlines(coin) {
    const sysTime = await getSystemTime();
    if (!sysTime) return [];

    console.log(`Fetching daily K-line for ${coin}...`);
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=1000000000&end_time=${sysTime}&interval=86400`;
    try {
        const response = await axiosInstance.get(url, { timeout: 5000 });
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching daily K-line for ${coin}:`, error.message);
        return [];
    }
}

async function get5mKlines(coin, days) {
    const sysTime = await getSystemTime();
    if (!sysTime) return [];

    console.log(`Fetching ${days}-day 5m K-lines for ${coin}...`);
    const startTime = sysTime - (days * 86400000); // Convert days to milliseconds
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=300`;

    try {
        const response = await axiosInstance.get(url, { timeout: 5000 });
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching ${days}-day 5m K-lines for ${coin}:`, error.message);
        return [];
    }
}

function calculateDeviation(pastWeek5mKlines, today5mKlines, coin) {
    if (pastWeek5mKlines.length < 8 || today5mKlines.length < 2) return null;

    const latest5mKline = today5mKlines[today5mKlines.length - 1]; // Most recent 5-minute movement
    const todayPercentChange = ((latest5mKline[2] - latest5mKline[1]) / latest5mKline[1]) * 100;

    const avgPercentChange = pastWeek5mKlines.reduce((sum, prevKline) => {
        return sum + Math.abs((prevKline[2] - prevKline[1]) / prevKline[1]) * 100;
    }, 0) / pastWeek5mKlines.length;

    return {
        coin: coin,
        deviation: todayPercentChange - avgPercentChange, // Detects unusual movement vs historical trends
        timestamp: latest5mKline[0]
    };
}

function calculateCurrentMovement(dailyKlines, coin) {
    if (!dailyKlines.length) return null;

    const today = dailyKlines[dailyKlines.length - 1]; // Get last 24-hour movement
    const todayPercentChange = ((today[2] - today[1]) / today[1]) * 100;

    return {
        coin: coin,
        currentMovement: todayPercentChange > 0 ? `${todayPercentChange.toFixed(2)}% (Pump)` : `${todayPercentChange.toFixed(2)}% (Dump)`
    };
}

async function updateHtmlLog(deviationData, firstRun, page) {
    refreshCount++;

    // Sort by deviation, largest at the top
    deviationData.sort((a, b) => b.deviation - a.deviation);

    let htmlContent = `<html><head><title>Crypto Status</title>
        <style>table { width: 100%; border-collapse: collapse; } 
        th, td { padding: 10px; border: 1px solid black; } 
        .pump { color: green; } .dump { color: red; }</style></head><body>
        <h2>Real-Time Crypto Movement Tracking</h2>
        <p>Refresh Count: ${refreshCount}</p>
        <table><tr><th>Coin</th><th>Deviation (5m)</th><th>Current Movement (24h)</th></tr>`;

    deviationData.forEach((data) => {
        htmlContent += `<tr><td>${data.coin}</td><td>${data.deviation.toFixed(2)}%</td>
            <td class="${data.currentMovement.includes('Pump') ? 'pump' : 'dump'}">${data.currentMovement}</td></tr>`;
    });

    htmlContent += `</table></body></html>`;
    fs.writeFileSync(HTML_FILE_PATH, htmlContent); // Update HTML file
    console.log("HTML log updated!");

    await page.setContent(htmlContent); // Modify browser page without reloading
}

async function main() {
    const coins = await getCoinNames();
    let deviationData = [];
    let firstRun = true;

    createInitialHtmlFile(); // Ensure file exists before browser launch

    const browser = await playwright.chromium.launch({ executablePath: CHROME_PATH, headless: false });
    const page = await browser.newPage();
    await page.goto(`file://${HTML_FILE_PATH}`);

    while (true) {
        for (const coin of coins) {
            const pastWeek5mKlines = await get5mKlines(coin, 7);
            const today5mKlines = await get5mKlines(coin, 1);
            const dailyKlines = await getDailyKlines(coin);

            const deviation = calculateDeviation(pastWeek5mKlines, today5mKlines, coin);
            const currentMovement = calculateCurrentMovement(dailyKlines, coin);

            if (deviation && currentMovement) {
                deviationData.push({ ...deviation, ...currentMovement });
                await updateHtmlLog(deviationData, firstRun, page);
            }
        }

        firstRun = false;
    }
}

main();
