const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const player = require('play-sound')({ player: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" });
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

let refreshCounter = 0;
let assetPrices = {};
let browser, page;
let coins = JSON.parse(fs.readFileSync('public/db.json')).coins;

// Fetch asset prices
async function updateAssetPrices() {
    console.log("🔄 Fetching asset prices...");
    try {
        const response = await axios.get('https://www.coinex.com/res/quotes/assets?limit=8000');
        assetPrices = Object.fromEntries(response.data.data.data.map(asset => [asset.asset, parseFloat(asset.price_usd)]));
        console.log("✅ Updated asset prices.");
        checkPriceCrossing(); // Run analysis immediately after price update
    } catch (error) {
        console.error("❌ Error fetching asset prices:", error.message);
    }
}

setInterval(updateAssetPrices, 60000);

// Fetch 5m K-lines for coins
async function fetchKlines(coin, interval) {
    return new Promise(resolve => {
        setTimeout(() => resolve([
            [Date.now() / 1000, "9082", "9228", "9478", "9002", "41.54", "383856"]
        ]), 1000);
    });
}

// Check price behavior & trigger alerts
async function checkPriceCrossing() {
    refreshCounter++;

    for (let coin of coins) {
        const currentPrice = assetPrices[coin.name] || null;
        const fiveMinKlines = await fetchKlines(coin.name, 300);
        const lastClosePrice = parseFloat(fiveMinKlines[fiveMinKlines.length - 1][2]); // Last closing price

        let { maxPrice, minPrice } = fiveMinKlines.reduce((acc, k) => ({
            maxPrice: Math.max(acc.maxPrice, Number(k[3])), // Highest Price
            minPrice: Math.min(acc.minPrice, Number(k[4]))  // Lowest Price
        }), { maxPrice: -Infinity, minPrice: Infinity });

        // Detect strong movement that matches the trend
        const upwardStrongMove = coin.trend === "up" && currentPrice > maxPrice;
        const downwardStrongMove = coin.trend === "down" && currentPrice < minPrice;
        const strongMovement = upwardStrongMove || downwardStrongMove;

        if (strongMovement && coin.status !== "crossed" && coin.status !== "strong_movement") {
            console.log(`🔥 STRONG MOVE detected: ${coin.name}`);

            // ✅ Compute the percentage movement
            const movementPercent = ((currentPrice - lastClosePrice) / lastClosePrice) * 100;
            coin.movement = movementPercent.toFixed(2) + "%"; // Store percentage change

            coin.status = "strong_movement";
            coin.strongMovementFlag = true;
            player.play('public/alert2.mp3');
        }

        // Check if price crosses predefined limit
        const crossedLimit =
            (coin.trend === "up" && currentPrice >= coin.limit) ||
            (coin.trend === "down" && currentPrice <= coin.limit);

        if (crossedLimit && coin.status !== "crossed") {
            console.log(`🚨 CROSS ALERT: ${coin.name} has broken the limit!`);
            coin.status = "crossed";
            player.play('public/alert2.mp3');
        }

        if (!crossedLimit && coin.status === "crossed") {
            console.log(`✅ RECOVERY: ${coin.name} has pulled back below the limit.`);
            coin.status = "safe";
        }
    }
}

setInterval(checkPriceCrossing, 60000);

// Launch Playwright browser & monitoring system
async function main() {
    console.log("🚀 Launching Playwright browser...");
    browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // ✅ Restored Playwright path
    });

    page = await browser.newPage();
    await page.goto(`http://localhost:3050/price_action.html`);
    console.log("📡 Monitoring system is active.");
}

// Handle adding new coins
app.post('/add-coin', (req, res) => {
    console.log(`➕ Adding coin: ${req.body.coin}, Limit: ${req.body.limit}, Trend: ${req.body.trend}`);
    coins.push({ name: req.body.coin, limit: req.body.limit, trend: req.body.trend, status: "safe" });
    fs.writeFileSync('public/db.json', JSON.stringify({ coins }, null, 2));
    res.send({ status: "Coin added!" });
});

// Handle status requests
app.get('/status', (req, res) => {
    try {
        //console.log("📡 Sending status update.");
        res.json({ refreshCounter, coins, assetPrices });
    } catch (error) {
        console.error("❌ Error fetching status:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Start the server and browser monitoring
app.listen(3050, () => {
    console.log("✅ Server running at http://localhost:3050");
    updateAssetPrices(); // Fetch initial prices and trigger cross-check
    main(); // ✅ Open browser session with Playwright
});
