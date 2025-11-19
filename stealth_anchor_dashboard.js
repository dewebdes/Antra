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
const refreshDelayMs = 1000;
const parallelRefreshIntervalMs = 60000;

let browser, page;
let refreshCount = 0;
let parallelCount = 0;
let tableData = [];


const fs = require('fs');
const path = require('path');

// پوشه ذخیره‌سازی
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');

// مطمئن شو پوشه وجود دارد
if (!fs.existsSync(SNAPSHOT_DIR)) {
  fs.mkdirSync(SNAPSHOT_DIR);
}

// تابع ذخیره‌سازی
function saveSnapshot() {
  const snapshot = {
    timestamp: new Date().toISOString(),
    refreshCount,
    parallelCount,
    top: tableData
  };
  const filename = `snapshot-${Date.now()}.json`;
  fs.writeFileSync(path.join(SNAPSHOT_DIR, filename), JSON.stringify(snapshot, null, 2));
  console.log(`💾 Snapshot saved: ${filename}`);
}

// هر 4 ساعت یک بار ذخیره کن
setInterval(saveSnapshot, 4 * 60 * 60 * 1000);

// Add this near the bottom of your Solution-2 script

function handleConsoleInput(input) {
  const cmd = input.trim().toLowerCase();

  if (cmd === 'exit') {
    console.log('👋 Exiting...');
    process.exit(0);
  } else if (cmd === 'status') {
    console.log(`RefreshCount=${refreshCount}, ParallelCount=${parallelCount}`);
  } else if (cmd === 'resetmove') {
    resetMove();
  } else {
    console.log(`Unknown command: ${cmd}`);
  }
}

function resetMove() {
  if (!Array.isArray(tableData)) return;
  for (const row of tableData) {
    row.diffPercent = 0;
    row.avgMovement = 0;
    // If you keep a history array, clear it:
    if (row.movementHistory) row.movementHistory = [];
  }
  console.log('🔄 All movement percentages reset to 0% and histories cleared.');
}

// Attach to stdin
process.stdin.on('data', (data) => {
  handleConsoleInput(data.toString());
});

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
    executablePath: 'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe'
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

    for (let i = 0; i < coins.length; i++) {
      const symbol = coins[i];
      try {
        const klines = await getKlines(nowSec, symbol);
        if (!klines || klines.length === 0) {
          // Keep previous row if exists
          continue;
        }

        const anchorData = calcStealthAnchor(klines);
        if (!anchorData) {
          // Keep previous row if exists
          continue;
        }

        const currentPrice = Number(klines[klines.length - 1][2]);
        if (currentPrice <= 0) {
          // Keep previous row if exists
          continue;
        }

        const diffPercent = percentChange(anchorData.lowestAnchor, currentPrice);

        const nowMs = Date.now();
        const anchorMs = anchorData.anchorTimestamp * 1000;
        const diffDays = Math.floor((nowMs - anchorMs) / (1000 * 60 * 60 * 24));

        // Seed movement only if we don't have history yet; otherwise preserve and extend in parallel refresh
        let movements = [];
        let prevPrice = null;

        const prevRowIdx = tableData.findIndex(r => r.symbol === symbol);
        const prevRow = prevRowIdx >= 0 ? tableData[prevRowIdx] : null;

        if (!prevRow || !Array.isArray(prevRow.movements) || prevRow.movements.length === 0) {
          // Initialize from last two closes
          if (klines.length >= 2) {
            const prevClose = Number(klines[klines.length - 2][2]);
            if (prevClose > 0) {
              movements.push(percentChange(prevClose, currentPrice));
              prevPrice = currentPrice;
            }
          }
        } else {
          // Preserve existing history and prevPrice
          movements = prevRow.movements;
          prevPrice = prevRow.prevPrice ?? currentPrice;
        }

        const avgMovement = average(movements);

        const newRow = {
          symbol,
          stealthCeiling: anchorData.suggestedCeiling,
          lowestAnchor: anchorData.lowestAnchor,
          anchorTimestamp: anchorData.anchorTimestamp,
          currentPrice,
          diffPercent,
          diffDays,
          prevPrice: prevPrice || currentPrice,
          movements,
          avgMovement
        };

        // Upsert in place: update existing row or push new
        if (prevRowIdx >= 0) {
          tableData[prevRowIdx] = newRow;
        } else {
          tableData.push(newRow);
        }

        console.log(
          `📊 [${i + 1}/${coins.length}] ${symbol} → Anchor: ${anchorData.lowestAnchor.toFixed(6)} | Current: ${currentPrice.toFixed(6)} | Δ%: ${diffPercent.toFixed(2)} | Age: ${diffDays}d | AvgMove: ${avgMovement.toFixed(2)}%`
        );
      } catch (e) {
        console.log(`🚫 ${symbol} → error: ${e.message}`);
        // On error: do nothing; existing row (if any) remains, no reset
      }

      // Realtime update: sort and render after each coin
      if (tableData.length > 0) {
        tableData.sort((a, b) => b.diffPercent - a.diffPercent);
        await updateHTML();
      }

      await delay(refreshDelayMs);
    }

    console.log(`✅ Loop #${refreshCount} complete. Coins processed (current table size): ${tableData.length}`);
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
