const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')();
const { RSI, MACD } = require('technicalindicators');

let browser;
let page;

// Set up Axios instance with proxy
const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Fetch system time from CoinEx API
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error("Error fetching system time:", error.message);
        return null;
    }
}

// Fetch full 7-day 5-minute K-line data iteratively
async function fetchFullWeekKlines(coin, interval) {
    let klines = [];
    let sysTime = await getSystemTime();
    let startTime = 1000000000;

    while (klines.length < (7 * 24 * 12)) {
        try {
            const market = `${coin}USDT`;
            const apiUrl = `https://www.coinex.com/res/market/kline?market=${market}&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
            const response = await axiosInstance.get(apiUrl);
            const data = response.data.data;

            if (data.length === 0) break;
            if (sysTime == data[0][0]) break;

            klines = [...data, ...klines];
            sysTime = data[0][0];
        } catch (error) {
            console.error(`Error fetching Klines for ${coin}:`, error.message);
            break;
        }
    }

    return klines;
}

// Analyze volume trends for reversal signals
function analyzeVolumeDeviation(klines) {
    if (!klines || klines.length < 2) return { deviation: 0, latestSurge: 0 };

    const volumeData = klines.map(k => Number(k[5]));
    const avgVolume = volumeData.reduce((sum, v) => sum + v, 0) / volumeData.length;
    const deviation = Math.sqrt(volumeData.map(v => (v - avgVolume) ** 2).reduce((sum, v) => sum + v, 0) / volumeData.length);
    const latestSurge = volumeData[volumeData.length - 1] - avgVolume;

    return { deviation, latestSurge };
}

// Detect trend reversal probability
function detectReversalProbability(klines) {
    if (!klines || klines.length < 2) return 0;

    const recentVolumes = klines.slice(-5).map(k => Number(k[5]));
    const avgRecentVolume = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length;
    const previousVolumes = klines.slice(-20, -5).map(k => Number(k[5]));
    const avgPreviousVolume = previousVolumes.reduce((sum, v) => sum + v, 0) / previousVolumes.length;

    return ((avgRecentVolume - avgPreviousVolume) / avgPreviousVolume) * 100;
}

// Estimate ideal short entry points
function recommendShortEntry(klines) {
    if (!klines || klines.length < 2) return null;

    let recentLows = klines.map(k => parseFloat(k[3])); // Extract recent low prices
    let minPrice = Math.min(...recentLows); // Find lowest support zone
    let shortEntry = minPrice * 1.005; // Slightly above previous support for safer breakdown entry

    return shortEntry.toFixed(4);
}


// Estimate exit price and potential profit percentage
function estimateExitPrice(klines) {
    if (!klines) return null;

    let latestPrice = parseFloat(klines[klines.length - 1][4]);
    let maxPriceToday = Math.max(...klines.map(k => parseFloat(k[2])));
    let exitPrice = maxPriceToday * 0.98; // Conservative take-profit level for shorts
    let benefitPercentage = ((exitPrice - latestPrice) / latestPrice * 100).toFixed(2);

    return { exitPrice: exitPrice.toFixed(4), benefitPercentage };
}

// Classify risk level of trades
function classifyRiskLevel(reversalProbability) {
    if (reversalProbability > 50) return '🚨 High Risk';
    if (reversalProbability > 20) return '⚖️ Stable';
    return '✅ Low Risk';
}

// Update HTML log
async function updateHtml(results) {
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Momentum Analysis Report</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; }
                table { width: 80%; border-collapse: collapse; margin: 20px auto; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
                th { background-color: #f4f4f4; }
                .high-risk { color: red; font-weight: bold; }
                .low-risk { color: green; font-weight: bold; }
                .stable { color: blue; font-weight: bold; }
            </style>
        </head>
        <body>
            <h2>Momentum Analysis Report</h2>
            <table>
                <thead>
                    <tr>
                        <th>Coin</th>
                        <th>Volume Surge (Deviation)</th>
                        <th>Reversal Probability</th>
                        <th>Short Entry</th>
                        <th>Exit Price</th>
                        <th>Profit %</th>
                        <th>Risk Level</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map(result => `
                        <tr>
                            <td>${result.coin}</td>
                            <td>${result.latestSurge} (±${result.deviation})</td>
                            <td>${result.reversalProbability.toFixed(2)}%</td>
                            <td>${result.shortEntry}</td>
                            <td>${result.exitPrice}</td>
                            <td>${result.benefitPercentage}%</td>
                            <td class="${classifyRiskLevel(result.reversalProbability)}">${classifyRiskLevel(result.reversalProbability)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;

    await page.setContent(htmlContent);
}

// Analyze multiple coins
async function analyzeCoins(coinList) {
    const results = [];

    for (const coin of coinList) {
        console.log(`Analyzing ${coin}...`);

        const klines = await fetchFullWeekKlines(coin, 300);
        const { deviation, latestSurge } = analyzeVolumeDeviation(klines);
        const reversalProbability = detectReversalProbability(klines);
        const shortEntry = recommendShortEntry(klines);
        const { exitPrice, benefitPercentage } = estimateExitPrice(klines);

        results.push({ coin, latestSurge, deviation, reversalProbability, shortEntry, exitPrice, benefitPercentage });
    }

    results.sort((a, b) => (b.latestSurge + b.deviation) - (a.latestSurge + a.deviation));

    await updateHtml(results);
}

// Run main analysis function
async function main() {
    const input = prompt("Enter coins (comma-separated): ");
    const coinList = input.split(',').map(coin => coin.trim().toUpperCase());

    browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });

    page = await browser.newPage();
    await analyzeCoins(coinList);
}

main();
