const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTML_FILE_PATH = path.join(__dirname, 'crypto_status_avrage.html'); // Updated filename

const PROXY_CONFIG = {
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
};

const axiosInstance = axios.create(PROXY_CONFIG);
let refreshCount = 0;

// Define popular timeframes (in seconds)
const timeframes = [300, 900, 3600, 14400, 86400]; // 5m, 15m, 1h, 4h, 1d

// Ensure the HTML file exists before browser launch
function createHtmlFileIfNotExist() {
    if (!fs.existsSync(HTML_FILE_PATH)) {
        const initialHtml = `<html><head><title>Crypto Status (Avg)</title></head><body>
        <h2>Waiting for updates...</h2></body></html>`;
        fs.writeFileSync(HTML_FILE_PATH, initialHtml);
        console.log("Initialized new HTML file: crypto_status_avrage.html");
    }
}

async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time', { timeout: 5000 });
        return response.data.data.current_timestamp;
    } catch (error) {
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

    const startTime = sysTime - (days * 86400000);
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;

    try {
        console.log(`Requesting data for ${coin} (Interval: ${interval}s)...`);
        const response = await axiosInstance.get(url, { timeout: 5000 });

        if (!response.data.data || response.data.data.length === 0) {
            console.error(`No data received for ${coin}.`);
            return [];
        }

        console.log(`Received data for ${coin}:`, response.data.data.slice(0, 2)); // Show first two records
        return response.data.data;

    } catch (error) {
        console.error(`Error fetching K-lines for ${coin}:`, error.message);
        return [];
    }
}


// Function to calculate deviation
function calculateDeviation(pastKlines, todayKlines) {
    if (!pastKlines.length || !todayKlines.length) return null;

    const latestKline = todayKlines[todayKlines.length - 1];
    const todayPercentChange = ((latestKline[2] - latestKline[1]) / latestKline[1]) * 100;

    const avgPercentChange = pastKlines.reduce((sum, prevKline) => {
        return sum + Math.abs((prevKline[2] - prevKline[1]) / prevKline[1]) * 100;
    }, 0) / pastKlines.length;

    return todayPercentChange - avgPercentChange;
}

// Function to calculate the average deviation across multiple timeframes
async function getAverageDeviation(coin) {
    let deviations = [];

    for (const timeframe of timeframes) {
        const pastKlines = await getKlines(coin, 7, timeframe);
        const todayKlines = await getKlines(coin, 1, timeframe);
        const deviation = calculateDeviation(pastKlines, todayKlines);
        if (deviation !== null) {
            deviations.push(deviation);
        }
    }

    return deviations.length ? (deviations.reduce((a, b) => a + b) / deviations.length) : null;
}

// Function to calculate current movement (24h trend)
async function calculateCurrentMovement(coin) {
    const dailyKlines = await getKlines(coin, 1, 86400);
    if (!dailyKlines.length) return null;

    const today = dailyKlines[dailyKlines.length - 1];
    const todayPercentChange = ((today[2] - today[1]) / today[1]) * 100;

    return {
        coin: coin,
        currentMovement: todayPercentChange > 0 ? `${todayPercentChange.toFixed(2)}% (Pump)` : `${todayPercentChange.toFixed(2)}% (Dump)`
    };
}

// Function to update HTML log with results
async function updateHtmlLog(deviationData, page) {
    refreshCount++;

    // Read current file content before overwriting
    let existingContent = "";
    if (fs.existsSync(HTML_FILE_PATH)) {
        existingContent = fs.readFileSync(HTML_FILE_PATH, 'utf8');
    }

    // Start with existing content if available
    let htmlContent = existingContent.includes("<html>") ? existingContent.split("</table>")[0] : `<html><head><title>Crypto Status (Avg)</title>
        <style>table { width: 100%; border-collapse: collapse; } 
        th, td { padding: 10px; border: 1px solid black; } 
        .pump { color: green; } .dump { color: red; }</style></head><body>
        <h2>Real-Time Crypto Market Tracking</h2>
        <p>Refresh Count: ${refreshCount}</p>
        <table><tr><th>Coin</th><th>Avg Deviation (%)</th><th>24H Movement</th></tr>`;

    // Append new data
    deviationData.forEach((data) => {
        htmlContent += `<tr><td>${data.coin}</td><td>${data.avgDeviation.toFixed(2)}%</td>
            <td class="${data.currentMovement.includes('Pump') ? 'pump' : 'dump'}">${data.currentMovement}</td></tr>`;
    });

    htmlContent += `</table></body></html>`;
    fs.writeFileSync(HTML_FILE_PATH, htmlContent); // Ensure content updates rather than resetting

    console.log("HTML log updated!");

    await page.setContent(htmlContent);
}


// Main function
async function main() {
    const coins = await getCoinNames();
    let deviationData = [];

    createHtmlFileIfNotExist(); // Ensure the file exists before browser launch

    const browser = await playwright.chromium.launch({ executablePath: CHROME_PATH, headless: false });
    const page = await browser.newPage();
    await page.goto(`file://${HTML_FILE_PATH}`);

    console.log("Browser opened successfully!");

    while (true) {
        deviationData = [];

        console.log("Fetching coin data...");

        for (const coin of coins) {
            const avgDeviation = await getAverageDeviation(coin);
            const currentMovement = await calculateCurrentMovement(coin);

            if (avgDeviation === null || currentMovement === null) {
                console.warn(`Skipping ${coin} due to missing data.`);
                continue;
            }

            deviationData.push({ coin, avgDeviation, ...currentMovement });

            console.log(`Updating HTML for ${coin}...`);
            await updateHtmlLog(deviationData, page); // Updates HTML **after each coin**
        }

        console.log("Cycle complete. Waiting for next update...");
        await new Promise(resolve => setTimeout(resolve, 10000)); // Prevent overload
    }
}




main();
