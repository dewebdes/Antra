const fs = require('fs');
const axios = require('axios');
const path = require('path');
const https = require('https');
const readline = require('readline');

const dbFilePath = path.join(__dirname, 'public', 'dbmax.json');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Fetch assets from CoinEx API
async function fetchAssets() {
    try {
        const response = await axios.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000', {
            httpsAgent,
            proxy: { host: '127.0.0.1', port: 8082 }
        });



        return response.data.data;
    } catch (error) {
        console.error('Error fetching assets data:', error.message);
        return [];
    }
}

// Fetch system time from API
async function getSystemTime() {
    try {
        const response = await axios.get('https://www.coinex.com/res/system/time', {
            httpsAgent,
            proxy: { host: '127.0.0.1', port: 8082 }
        });

        if (!response.data || typeof response.data.data.current_timestamp !== 'number') {
            console.error('Invalid system time response:', response.data);
            return null;
        }

        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

// Fetch 5m K-lines from API
async function get5mKlines(coin) {
    const sysTime = await getSystemTime();
    if (!sysTime) return [];

    console.log(`Fetching 5m K-line for ${coin}...`);
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${sysTime - 86400000}&end_time=${sysTime}&interval=300`;

    try {
        const response = await axios.get(url, {
            httpsAgent,
            proxy: { host: '127.0.0.1', port: 8082 }
        });

        if (!response.data || !Array.isArray(response.data.data)) {
            console.error(`Invalid K-line response for ${coin}:`, response.data);
            return [];
        }

        return response.data.data;
    } catch (error) {
        console.error(`Error fetching 5m K-line for ${coin}:`, error.message);
        return [];
    }
}

// Ask user for coin selection and hours for analysis
async function askUserForPreferences() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('Enter coins (comma-separated) or press Enter for all: ', (coinInput) => {
            rl.question('Enter number of hours to analyze: ', (hourInput) => {
                rl.close();
                const selectedCoins = coinInput.split(',').map(coin => coin.trim().toUpperCase()).filter(Boolean);
                const hours = parseInt(hourInput, 10) || 4; // Default to 4 hours if invalid input
                resolve({ coins: selectedCoins.length ? selectedCoins : null, hours });
            });
        });
    });
}

// Process assets and generate dbmax.json
async function generateDbFile() {
    console.log('Fetching assets...');
    const assets = await fetchAssets();
    const { coins: userSelectedCoins, hours } = await askUserForPreferences();
    const klineCount = hours * 12; // Calculate required 5m K-lines
    const coinsData = [];

    for (const asset of assets.data) {
        const coin = asset.asset;
        if (userSelectedCoins && !userSelectedCoins.includes(coin)) continue;

        const price_usd = parseFloat(asset.price_usd);
        const klinesData = await get5mKlines(coin);
        if (!klinesData || klinesData.length === 0) {
            console.log(`Skipping ${coin}: No valid klines data.`);
            continue;
        }

        // Extract the latest 'klineCount' entries
        const recentKlines = klinesData.slice(-klineCount);
        let maxPrice = Math.max(...recentKlines.map(kline => Number(kline[2])));

        if (!maxPrice || maxPrice === -Infinity) {
            console.log(`Skipping ${coin}: No valid price data.`);
            continue;
        }

        const remainingPercent = Math.abs(((maxPrice - price_usd) / maxPrice) * 100).toFixed(2);
        const trend = "up";// price_usd >= maxPrice ? "up" : "down";
        const status = price_usd >= maxPrice ? "crossed" : "safe";
        const crossedTimestamp = status === "crossed" ? Date.now() : null;

        coinsData.push({
            name: coin,
            limit: Number(maxPrice),
            trend,
            status,
            crossedTimestamp,
            remainingPercent
        });
    }

    fs.writeFileSync(dbFilePath, JSON.stringify({ coins: coinsData }, null, 2));
    console.log(`Database saved to ${dbFilePath}`);
}

// Run the script
generateDbFile().catch(console.error);
