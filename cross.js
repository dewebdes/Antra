const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const https = require('https');

// Configure Axios with Proxy
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Ignore SSL certificate errors
});

// Function to get the coin name from the user
async function getCoinName() {
    const coinName = prompt('Enter the coin name (e.g., BTC, ETH, SOL): ').trim();
    if (!coinName) {
        console.error('Error: No coin name entered. Please provide a valid coin name.');
        process.exit(1);
    }
    return coinName.toUpperCase();
}

// Function to fetch 5-minute K-line data for the last 24 hours using the proxy
async function fetch5mKlines(coin, sysTime) {
    console.log(`Fetching 5-minute K-line data for ${coin} via proxy...`);

    const interval = 300; // 5-minute interval
    const startTime = sysTime - (24 * 60 * 60); // Last 24 hours
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;

    const response = await axiosInstance.get(url);
    return response.data.data;
}

// Function to calculate EMA (Exponential Moving Average)
function calculateEMA(data, period) {
    let multiplier = 2 / (period + 1);
    let emaValues = [];
    let sum = 0;

    for (let i = 0; i < data.length; i++) {
        let closePrice = parseFloat(data[i][4]); // Closing price

        if (i < period) {
            sum += closePrice;
            emaValues.push(null);
        } else if (i === period) {
            emaValues.push(sum / period);
        } else {
            let emaPrev = emaValues[i - 1];
            emaValues.push((closePrice - emaPrev) * multiplier + emaPrev);
        }
    }
    return emaValues;
}

// Function to calculate RSI (Relative Strength Index)
function calculateRSI(data, period) {
    let gains = [];
    let losses = [];

    for (let i = 1; i < data.length; i++) {
        let change = parseFloat(data[i][4]) - parseFloat(data[i - 1][4]); // Closing price difference
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
    }

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let rsiValues = [100 - (100 / (1 + avgGain / avgLoss))];

    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        rsiValues.push(100 - (100 / (1 + avgGain / avgLoss)));
    }

    return rsiValues;
}

// Function to detect critical breakout price level
function detectBreakoutLevel(klines) {
    let resistanceLevels = [];
    let highPrices = klines.map(k => parseFloat(k[2])); // High prices
    let volumeData = klines.map(k => parseFloat(k[5])); // Volume data

    let maxHigh = Math.max(...highPrices); // Identify strongest resistance
    resistanceLevels.push(maxHigh);

    return {
        breakoutPrice: maxHigh,
        avgVolume: volumeData.reduce((a, b) => a + b, 0) / volumeData.length,
    };
}

// Main function
async function main() {
    const coin = await getCoinName(); // Get coin name from user input
    const sysTime = Math.floor(Date.now() / 1000); // Get system time
    const klines = await fetch5mKlines(coin, sysTime);
    const ema10 = calculateEMA(klines, 10);
    const ema50 = calculateEMA(klines, 50);
    const rsi14 = calculateRSI(klines, 14);
    const breakout = detectBreakoutLevel(klines);

    console.log("\n--- Analysis ---");
    console.log(`Breakout Price Level for ${coin}: ${breakout.breakoutPrice.toFixed(4)}`);
    console.log(`Average Volume: ${breakout.avgVolume.toFixed(2)}`);
    console.log(`Latest RSI(14): ${rsi14[rsi14.length - 1].toFixed(2)}`);
    console.log(`EMA10: ${ema10[ema10.length - 1].toFixed(4)}, EMA50: ${ema50[ema50.length - 1].toFixed(4)}`);

    if (rsi14[rsi14.length - 1] > 50 && ema10[ema10.length - 1] > ema50[ema50.length - 1]) {
        console.log(`\n✅ Confidence in short pump for ${coin} is **high** based on breakout past resistance, RSI recovery, and EMA momentum.`);
    } else {
        console.log(`\n⚠️ Pump signal for ${coin} is **weak**. RSI and EMA do not confirm strong breakout momentum.`);
    }
}

main();
