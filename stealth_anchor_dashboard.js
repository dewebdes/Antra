// stealth_anchor_dashboard.js
// Live dashboard ranking coins by % difference between lowest stealth anchor and current price
// Includes Anchor Age (days) and Average Movement (%)

const { chromium } = require('playwright');
const axios = require('axios');
const https = require('https');
const express = require('express');
const app = express();
const cors = require('cors');
const PORT = 3001;

app.use(cors());

const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

const interval = 60;
const startTime = 1000000000;
const anchorWindowCount = 30;
const refreshDelayMs = 150;
const parallelRefreshIntervalMs = 60000;

let browser, page;
let refreshCount = 0;
let parallelCount = 0;
let tableData = [];

// --- API helpers ---
async function getCoinsList() {
    try {
        const res = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        return res.data.data.data.map(c => c.asset + 'USDT');
    } catch (e) {
        console.error('🚫 Error fetching coin list:', e.message);
        return [];
    }
}

async function getKlines(endTime, market) {
    const url = `https://www.coinex.com/res/market/kline?market=${market}&start_time=${startTime}&end_time=${endTime}&interval=${interval}`;
    const res = await axiosInstance.get(url);
    return res.data?.data || [];
}

// --- Core calculations ---
function calcStealthAnchor(klines) {
    const parsed = klines
        .map(k => ({
            timestamp: k[0],          // seconds
            price: Number(k[2]),      // close
            quoteVolume: Number(k[6]) // quote vol
        }))
        .filter(v => v.quoteVolume > 0);

    if (parsed.length < anchorWindowCount) return null;

    const sorted = [...parsed].sort((a, b) => a.quoteVolume - b.quoteVolume);
    const suggestedCeiling = sorted[anchorWindowCount - 1]?.quoteVolume || null;
    if (!suggestedCeiling) return null;

    const stealthFiltered = sorted.filter(v => v.quoteVolume <= suggestedCeiling);
    if (stealthFiltered.length === 0) return null;

    const minAnchorEntry = stealthFiltered.reduce(
        (min, cur) => (cur.price < min.price ? cur : min),
        { price: Infinity, timestamp: null }
    );

    if (minAnchorEntry.price <= 0 || !minAnchorEntry.timestamp) return null;

    return {
        suggestedCeiling,
        lowestAnchor: minAnchorEntry.price,
        anchorTimestamp: minAnchorEntry.timestamp
    };
}

function percentChange(from, to) {
    if (from <= 0 || to <= 0) return 0;
    return ((to - from) / from) * 100;
}

function average(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// --- Main runtime ---
(async () => {
    browser = await chromium.launch({
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    });
    const context = await browser.newContext();
    page = await context.newPage();
    await page.setContent(generateHTML([]));

    while (true) {
        refreshCount++;
        console.log(`\n🔁 Loop #${refreshCount}`);

        const coins = await getCoinsList();
        console.log(`🪙 Loaded ${coins.length} coins...`);

        const nowSec = Math.floor(Date.now() / 1000);
        tableData = [];

        for (let i = 0; i < coins.length; i++) {
            const symbol = coins[i];
            try {
                const klines = await getKlines(nowSec, symbol);
                if (!klines || klines.length === 0) continue;

                const anchorData = calcStealthAnchor(klines);
                if (!anchorData) continue;

                const currentPrice = Number(klines[klines.length - 1][2]);
                if (currentPrice <= 0) continue;

                const diffPercent = percentChange(anchorData.lowestAnchor, currentPrice);

                const nowMs = Date.now();
                const anchorMs = anchorData.anchorTimestamp * 1000;
                const diffDays = Math.floor((nowMs - anchorMs) / (1000 * 60 * 60 * 24));

                // Initialize movement tracking with last two closes if available
                // We use klines to seed a first movement if possible
                let movements = [];
                let prevPrice = null;
                if (klines.length >= 2) {
                    const prevClose = Number(klines[klines.length - 2][2]);
                    if (prevClose > 0) {
                        movements.push(percentChange(prevClose, currentPrice));
                        prevPrice = currentPrice; // set prevPrice to current to continue tracking forward
                    }
                }

                const avgMovement = average(movements);

                tableData.push({
                    symbol,
                    stealthCeiling: anchorData.suggestedCeiling, // number
                    lowestAnchor: anchorData.lowestAnchor,       // number
                    anchorTimestamp: anchorData.anchorTimestamp, // seconds
                    currentPrice,                                // number
                    diffPercent,                                 // number
                    diffDays,                                    // integer
                    prevPrice: prevPrice || currentPrice,        // start tracking from current if no previous
                    movements,                                   // array of % changes
                    avgMovement                                  // number
                });

                console.log(
                    `📊 [${i + 1}/${coins.length}] ${symbol} → Anchor: ${anchorData.lowestAnchor.toFixed(6)} | Current: ${currentPrice.toFixed(6)} | Δ%: ${diffPercent.toFixed(2)} | Age: ${diffDays}d | AvgMove: ${avgMovement.toFixed(2)}%`
                );
            } catch (e) {
                console.log(`🚫 ${symbol} → error: ${e.message}`);
            }

            // Sort after each coin by % difference
            tableData.sort((a, b) => b.diffPercent - a.diffPercent);

            // Update HTML after each coin with sorted list
            await updateHTML();

            await delay(refreshDelayMs);
        }

        console.log(`✅ Loop #${refreshCount} complete. Coins processed: ${tableData.length}`);
    }
})();

// --- Parallel refresh — updates current price, diff%, movements, avgMovement; anchor remains static ---
setInterval(async () => {
    parallelCount++;
    console.log(`\n🔄 Parallel refresh #${parallelCount}`);

    const nowSec = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();

    for (let row of tableData) {
        try {
            const klines = await getKlines(nowSec, row.symbol);
            if (!klines || klines.length === 0) continue;

            const currentPrice = Number(klines[klines.length - 1][2]);
            if (currentPrice <= 0 || row.lowestAnchor <= 0 || !row.anchorTimestamp) continue;

            // Movement tracking (compare last stored price to new current)
            if (row.prevPrice && row.prevPrice > 0 && currentPrice > 0) {
                const move = percentChange(row.prevPrice, currentPrice);
                row.movements.push(move);
                // Optional: cap history length to avoid memory growth
                if (row.movements.length > 500) row.movements.shift();
                row.avgMovement = average(row.movements);
            } else {
                // Seed movement if not available
                row.avgMovement = average(row.movements || []);
            }
            row.prevPrice = currentPrice;

            // Update price and diff
            const diffPercent = percentChange(row.lowestAnchor, currentPrice);
            row.currentPrice = currentPrice;
            row.diffPercent = diffPercent;

            // Recompute age from stored anchor timestamp only
            const anchorMs = row.anchorTimestamp * 1000;
            row.diffDays = Math.floor((nowMs - anchorMs) / (1000 * 60 * 60 * 24));
        } catch { }
    }

    tableData.sort((a, b) => b.diffPercent - a.diffPercent);
    await updateHTML();
    console.log(`✅ Parallel refresh #${parallelCount} updated ${tableData.length} coins`);
}, parallelRefreshIntervalMs);

// --- HTML/UI ---
async function updateHTML() {
    await page.setContent(generateHTML(tableData));
}

function generateHTML(data) {
    const topStealthCoins = [...data]
        .filter(d => d.stealthCeiling > 0)
        .sort((a, b) => b.stealthCeiling - a.stealthCeiling)
        .slice(0, 3)
        .map(d => d.symbol);

    return `
  <html><head>
    <style>
      body { font-family: sans-serif; background: #111; color: #eee; padding: 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { padding: 6px; border: 1px solid #444; text-align: right; }
      th { background: #222; position: sticky; top: 0; }
      tr:nth-child(even) { background: #1a1a1a; }
      td:first-child, th:first-child { text-align: left; }
      .highlight { background: #333; color: #66ff66; font-weight: bold; }
    </style>
  </head><body>
    <h2>🧮 Stealth Anchor Dashboard</h2>
    <p>Loop: ${refreshCount} | Parallel refresh count: ${parallelCount} | Last update: ${new Date().toLocaleTimeString()}</p>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Coin</th><th>Stealth Ceiling</th><th>Lowest Anchor</th><th>Current Price</th><th>Δ%</th><th>Anchor Age (days)</th><th>Avg Movement (%)</th>
        </tr>
      </thead><tbody>
        ${data.map((d, i) => `
          <tr class="${topStealthCoins.includes(d.symbol) ? 'highlight' : ''}">
            <td>${i + 1}</td>
            <td>${d.symbol}</td>
            <td>${d.stealthCeiling.toFixed(6)}</td>
            <td>${d.lowestAnchor.toFixed(6)}</td>
            <td>${d.currentPrice.toFixed(6)}</td>
            <td>${isFinite(d.diffPercent) ? d.diffPercent.toFixed(2) + '%' : '-'}</td>
            <td>${d.diffDays}</td>
            <td>${(d.avgMovement ?? 0).toFixed(2)}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </body></html>`;
}

// --- Helpers ---
function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// --- API endpoint ---
app.get('/stealthanchors/:count', (req, res) => {
    const count = parseInt(req.params.count);
    const top = tableData.slice(0, count);
    res.json({
        timestamp: new Date().toISOString(),
        refreshCount,
        parallelCount,
        top
    });
});

app.listen(PORT, () => {
    console.log(`📡 Stealth Anchor dashboard listening at http://localhost:${PORT}`);
});
