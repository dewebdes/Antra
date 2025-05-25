const axios = require('axios');
const prompt = require('prompt-sync')();
const { RSI, MACD } = require('technicalindicators');

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

// Fetch K-line data for analysis
async function fetchKlines(coin, interval) {
    try {
        const market = `${coin}USDT`;
        const sysTime = await getSystemTime();
        const startTime = sysTime - (7 * 24 * 3600);
        const apiUrl = `https://www.coinex.com/res/market/kline?market=${market}&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
        const response = await axiosInstance.get(apiUrl);
        return response.data.data || [];
    } catch (error) {
        console.error(`Error fetching Klines for ${coin}:`, error.message);
        return [];
    }
}

// Calculate RSI and MACD for trend strength
function calculateIndicators(klines) {
    const closes = klines.map(k => Number(k[4]));

    const rsi = RSI.calculate({ values: closes, period: 14 });
    const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });

    return { rsi: rsi[rsi.length - 1], macd: macd[macd.length - 1] };
}

// Determine support levels from historical lows
function detectSupportLevel(klines) {
    const recentLows = klines.slice(-20).map(k => parseFloat(k[3]));
    return Math.min(...recentLows);
}

// Analyze whether to hold or exit dynamically
async function analyzeTrade(coin, buyPrice) {
    const klines = await fetchKlines(coin, 300);
    if (klines.length === 0) return console.log(`Error: No market data available for ${coin}`);

    const { rsi, macd } = calculateIndicators(klines);
    const latestPrice = parseFloat(klines[klines.length - 1][4]);
    const lossPercentage = ((buyPrice - latestPrice) / buyPrice) * 100;
    const supportLevel = detectSupportLevel(klines);

    console.log(`\n📊 Analysis for ${coin}`);
    console.log(`Buy Price: ${buyPrice}`);
    console.log(`Current Price: ${latestPrice}`);
    console.log(`Loss %: ${lossPercentage.toFixed(2)}%`);
    console.log(`RSI: ${rsi.toFixed(2)} | MACD Histogram: ${macd.histogram.toFixed(2)}`);
    console.log(`Support Level: ${supportLevel.toFixed(4)}`);

    if (latestPrice < supportLevel * 1.02 && lossPercentage > 5 && rsi < 40 && macd.histogram < 0) {
        console.log(`🚨 **EXIT**: Price breaking below support, trend still weak.`);
    } else {
        console.log(`✅ **HOLD**: Price near support, potential for recovery.`);
    }
}

// Get user input
const coin = prompt("Enter coin name: ").toUpperCase();
const buyPrice = parseFloat(prompt("Enter buy price: "));

analyzeTrade(coin, buyPrice);
