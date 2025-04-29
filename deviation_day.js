// Fully optimized script with both daily and 5-minute deviation tracking

const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const player = require('play-sound')({ player: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" });
const playwright = require('playwright');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"; // Exact path
const HTML_FILE_PATH = path.join(__dirname, 'crypto_status.html'); // Ensure correct file path

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

function calculateDailyDeviation(dailyKlines, coin) {
    if (dailyKlines.length < 8) return null; // Need at least 7 past days + today for analysis

    const today = dailyKlines[dailyKlines.length - 1]; // Last 24-hour movement
    const pastWeek = dailyKlines.slice(-8, -1); // Last 7 days

    const todayPercentChange = ((today[2] - today[1]) / today[1]) * 100;
    const avgPercentChange = pastWeek.reduce((sum, prevKline) => {
        return sum + Math.abs((prevKline[2] - prevKline[1]) / prevKline[1]) * 100;
    }, 0) / pastWeek.length;

    return {
        coin: coin,
        dailyDeviation: todayPercentChange - avgPercentChange, // Long-term trend tracking
        currentMovement: todayPercentChange > 0 ? `${todayPercentChange.toFixed(2)}% (Pump)` : `${todayPercentChange.toFixed(2)}% (Dump)`,
        timestamp: today[0]
    };
}

function calculate5mDeviation(pastWeek5mKlines, today5mKlines, coin) {
    if (pastWeek5mKlines.length < 8 || today5mKlines.length < 2) return null;

    const latest5mKline = today5mKlines[today5mKlines.length - 1]; // Most recent 5-minute movement
    const todayPercentChange = ((latest5mKline[2] - latest5mKline[1]) / latest5mKline[1]) * 100;

    const avgPercentChange = pastWeek5mKlines.reduce((sum, prevKline) => {
        return sum + Math.abs((prevKline[2] - prevKline[1]) / prevKline[1]) * 100;
    }, 0) / pastWeek5mKlines.length;

    return {
        coin: coin,
        shortTermDeviation: todayPercentChange - avgPercentChange, // Short-term trend tracking
    };
}

async function updateHtmlLog(deviationData, firstRun, page) {
    refreshCount++;

    // Sort by daily deviation, largest at the top
    deviationData.sort((a, b) => b.dailyDeviation - a.dailyDeviation);

    let htmlContent = `<html><head><title>Crypto Status</title>
        <style>table { width: 100%; border-collapse: collapse; } 
        th, td { padding: 10px; border: 1px solid black; } 
        .pump { color: green; } .dump { color: red; }</style></head><body>
        <h2>Real-Time Crypto Movement Tracking</h2>
        <p>Refresh Count: ${refreshCount}</p>
        <table><tr><th>Coin</th><th>Daily Deviation (24h)</th><th>5m Deviation</th><th>Current Movement (24h)</th></tr>`;

    deviationData.forEach((data) => {
        htmlContent += `<tr><td>${data.coin}</td><td>${data.dailyDeviation.toFixed(2)}%</td>
            <td>${data.shortTermDeviation.toFixed(2)}%</td>
            <td class="${data.currentMovement.includes('Pump') ? 'pump' : 'dump'}">${data.currentMovement}</td></tr>`;
    });

    htmlContent += `</table></body></html>`;
    fs.writeFileSync(HTML_FILE_PATH, htmlContent);
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
            const dailyKlines = await getDailyKlines(coin);
            const pastWeek5mKlines = await get5mKlines(coin, 7);
            const today5mKlines = await get5mKlines(coin, 1);

            const dailyDeviation = calculateDailyDeviation(dailyKlines, coin);
            const shortTermDeviation = calculate5mDeviation(pastWeek5mKlines, today5mKlines, coin);

            if (dailyDeviation && shortTermDeviation) {
                // Check if coin already exists and update instead of duplicating
                const existingIndex = deviationData.findIndex((data) => data.coin === coin);
                if (existingIndex !== -1) {
                    deviationData[existingIndex] = { ...dailyDeviation, ...shortTermDeviation };
                } else {
                    deviationData.push({ ...dailyDeviation, ...shortTermDeviation });
                }

                await updateHtmlLog(deviationData, firstRun, page);
            }
        }

        firstRun = false;
    }
}

main();
