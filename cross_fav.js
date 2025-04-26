const axios = require('axios');
const prompt = require('prompt-sync')();
const https = require('https');

// Proxy Configuration
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Ignore SSL certificate errors
});

// Function to get coins list from user input
async function getCoinsFromUser() {
    const coinInput = prompt("Enter coin names (comma-separated, e.g., BTC, ETH, SOL): ").trim();
    if (!coinInput) {
        console.error("Error: No coin names entered. Please provide a valid list.");
        process.exit(1);
    }
    return coinInput.split(",").map(coin => coin.trim().toUpperCase());
}

// Function to fetch 5-minute K-line data via proxy
async function fetch5mKlines(coin, sysTime) {
    const interval = 300;
    const startTime = sysTime - (24 * 60 * 60);
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;

    try {
        console.log(`🔄 Fetching K-line data for ${coin} via proxy...`);
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`❌ Failed to fetch data for ${coin} via proxy. Skipping.`);
        return [];
    }
}

// Function to detect breakout level
function detectBreakoutLevel(klines, coin) {
    if (!klines || klines.length === 0) {
        console.error(`⚠️ No K-line data available for ${coin}.`);
        return null;
    }

    let highPrices = klines.map(k => parseFloat(k[2])); // High prices
    let currentPrice = parseFloat(klines[klines.length - 1][4]); // Latest closing price
    let resistanceLevel = Math.max(...highPrices); // Strongest resistance

    return {
        coin: coin,
        breakoutPrice: resistanceLevel,
        currentPrice: currentPrice,
        distanceToPump: resistanceLevel - currentPrice
    };
}

// Main function
async function main() {
    const sysTime = Math.floor(Date.now() / 1000);
    const coins = await getCoinsFromUser();

    console.log(`\n🚀 Analyzing pump potential for ${coins.length} coins through proxy...\n`);

    let analysisResults = [];

    for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        console.log(`[${i + 1}/${coins.length}] Processing ${coin}...`);

        const klines = await fetch5mKlines(coin, sysTime);
        const breakoutData = detectBreakoutLevel(klines, coin);
        if (breakoutData) {
            analysisResults.push(breakoutData);
        }
    }

    // Sort coins by proximity to breakout pump level
    analysisResults.sort((a, b) => a.distanceToPump - b.distanceToPump);

    console.log("\n🔍 **Final Analysis - Coins Closest to Breakout Pump Level:**");
    analysisResults.forEach((data, index) => {
        console.log(`${index + 1}. ${data.coin} → Current: ${data.currentPrice.toFixed(4)}, Breakout Level: ${data.breakoutPrice.toFixed(4)}, Distance: ${data.distanceToPump.toFixed(4)}`);
    });

    // Format output as comma-separated coin list
    const sortedCoins = analysisResults.map(data => data.coin).join(", ");
    console.log("\n🔥 **Sorted Coin List:**", sortedCoins);
}

main();
