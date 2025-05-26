const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')();
const { RSI } = require('technicalindicators');

let refreshCounter = 0;
let systime = null;
let allResults = [];

const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Fetch system time
async function updateSystemTime() {
    try {
        console.log("Fetching system time...");
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        systime = response.data.data.current_timestamp;
        console.log(`System time updated: ${systime}`);
    } catch (error) {
        console.error("Failed to fetch system time:", error.message);
        systime = null;
    }
}

// Fetch Klines
async function fetchKlines(coin, interval) {
    console.log(`Fetching Klines for ${coin}...`);
    const market = `${coin}USDT`;
    const response = await axiosInstance.get(
        `https://www.coinex.com/res/market/kline?market=${market}&start_time=0&end_time=${systime}&interval=${interval}`
    );
    return response.data.data;
}

// Get current price
async function getFinalPrice(coin) {
    try {
        console.log(`Fetching final price for ${coin}...`);
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        const assetData = response.data.data.data.find((item) => item.asset === coin);
        return Number(assetData.price_usd);
    } catch (error) {
        console.error('Error fetching final price:', error.message);
        return null;
    }
}

// Compute RSI
function calculateRSI(klines, period = 14) {
    const closePrices = klines.map(k => Number(k[4]));
    const rsiValues = RSI.calculate({ values: closePrices, period });
    return rsiValues[rsiValues.length - 1];
}

// Compute liquidity zones
function calculateLiquidityZones(klines) {
    const highPrices = klines.map(k => Number(k[2]));
    const lowPrices = klines.map(k => Number(k[3]));
    return { demandZone: Math.min(...lowPrices), supplyZone: Math.max(...highPrices) };
}

// Calculate Enter/Exit Points
function calculatePoints(klines, dayLabel) {
    if (!klines) return { enterPoints: [], exitPoints: [] };

    const enterPoints = [];
    const exitPoints = [];
    const atrPeriod = 14;
    const closePrices = klines.map(k => Number(k[4]));
    const highPrices = klines.map(k => Number(k[2]));
    const lowPrices = klines.map(k => Number(k[3]));

    const trueRanges = highPrices.map((high, i) => {
        const low = lowPrices[i];
        const prevClose = closePrices[i - 1] || closePrices[0];
        return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    });

    const atr = trueRanges.slice(-atrPeriod).reduce((sum, tr) => sum + tr, 0) / atrPeriod;

    closePrices.forEach((price, index) => {
        if (price < closePrices[index - 1] - atr * 2) {
            enterPoints.push({ price: Number(price), label: 'Enter', day: dayLabel });
        } else if (price > closePrices[index - 1] + atr * 2) {
            exitPoints.push({ price: Number(price), label: 'Exit', day: dayLabel });
        }
    });

    return { enterPoints, exitPoints };
}

// Determine trade details
async function determineTradeDetails(coin, currentPrice) {
    let signal = "NEUTRAL", entryPrice = null, exitPrice = null, percentRemaining = null, profitPercent = null;

    const klines = await fetchKlines(coin, 300);
    const detectedPoints = calculatePoints(klines, "5m");

    const validBuyEntries = detectedPoints.enterPoints.map(point => Number(point.price)).filter(price => price < currentPrice);
    const validSellEntries = detectedPoints.exitPoints.map(point => Number(point.price)).filter(price => price > currentPrice);

    if (validBuyEntries.length > 0) {
        entryPrice = Math.max(...validBuyEntries);
        signal = "LONG";
        exitPrice = findExitPoint(klines, entryPrice, signal);
    } else if (validSellEntries.length > 0) {
        entryPrice = Math.min(...validSellEntries);
        signal = "SHORT";
        exitPrice = findExitPoint(klines, entryPrice, signal);
    }

    if (entryPrice && exitPrice) {
        percentRemaining = Math.abs((entryPrice - currentPrice) / entryPrice) * 100;
        profitPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    }

    return { signal, entryPrice, exitPrice, percentRemaining, profitPercent };
}

// Exit Point Detection
function findExitPoint(klines, entryPrice, tradeType) {
    const closingPrices = klines.map(k => Number(k[4]));

    if (tradeType === "LONG") {
        return closingPrices.find(price => price > entryPrice * 1.02) || entryPrice * 1.03;
    } else if (tradeType === "SHORT") {
        return closingPrices.find(price => price < entryPrice * 0.98) || entryPrice * 0.97;
    }
}

// Analyze a coin
async function analyzeCoin(coin) {
    const klines = await fetchKlines(coin, 300);
    const currentPrice = await getFinalPrice(coin);
    const rsIValue = calculateRSI(klines);
    const liquidityZones = calculateLiquidityZones(klines);

    const tradeDetails = await determineTradeDetails(coin, currentPrice);

    return { coin, currentPrice, rsIValue, ...tradeDetails };
}

// Update HTML after each request
async function updateHtmlTable(page, results) {
    refreshCounter++;
    console.log("Updating HTML...");
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Coin Analysis</title>
            <style>
                body { font-family: Arial, sans-serif; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
            </style>
        </head>
        <body>
            <h1>Coin Analysis</h1>
            <table>
                <thead>
                    <tr><th>Coin</th><th>Current Price</th><th>RSI</th><th>Trade Direction</th><th>Entry</th><th>Exit</th><th>Profit %</th></tr>
                </thead>
                <tbody>
                    ${results.map(result => `<tr><td>${result.coin}</td><td>${result.currentPrice}</td><td>${result.rsIValue}</td><td>${result.signal}</td><td>${result.entryPrice}</td><td>${result.exitPrice}</td><td>${result.profitPercent}</td></tr>`).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;
    await page.setContent(htmlContent);
}

// Execute script
async function main() {
    const coinsInput = prompt("Enter coins (comma-separated): ");
    const coins = coinsInput.split(',').map(coin => coin.trim().toUpperCase());

    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });
    const page = await browser.newPage();

    await updateSystemTime();
    for (const coin of coins) {
        const result = await analyzeCoin(coin);
        if (result) {
            allResults.push(result);
            await updateHtmlTable(page, allResults);
        }
    }
}

main();
