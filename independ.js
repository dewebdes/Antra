const { chromium } = require('playwright');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  proxy: { host: '127.0.0.1', port: 8082 },
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

let browser, page;
let refreshCount = 0;
let requestCount = 0;
let tableData = [];

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

    for (let i = 0; i < coins.length; i++) {
      const symbol = coins[i];
      const result = await scanCoin(symbol);
      requestCount++;

      if (!isNaN(parseFloat(result.delta))) {
        updateRow(result);
        console.log(`📊 [${i + 1}/${coins.length}] ${symbol} → Δ: ${result.delta}% | VolDev: ${result.volDeviation}%`);
      } else {
        console.log(`⚠️  [${i + 1}/${coins.length}] ${symbol} → skipped`);
      }

      await updateHTML();
      await delay(150);
    }

    console.log(`✅ Loop #${refreshCount} complete. Total requests: ${requestCount}`);
  }
})();

async function getCoinsList() {
  try {
    const res = await axiosInstance.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000');
    return res.data.data.data.map(c => c.asset + 'USDT');
  } catch (e) {
    console.error('🚫 Error fetching coin list:', e.message);
    return [];
  }
}

async function scanCoin(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const start = 1000000000;
  const interval = 300; // 5 minutes

  try {
    const res = await axiosInstance.get(
      `https://www.coinex.com/res/market/kline`,
      {
        params: {
          market: symbol,
          start_time: start,
          end_time: now,
          interval: interval
        }
      }
    );

    const data = res.data.data;
    if (!data || data.length < 288) throw new Error('Not enough candles for 24h');

    const total = data.length;
    const todayCandles = data.slice(-288); // last 24h of 5m candles
    const historyCandles = data.slice(0, total - 288); // everything before that

    const todayHigh = Math.max(...todayCandles.map(c => parseFloat(c[3])));
    const historicalHigh = Math.max(...historyCandles.map(c => parseFloat(c[3])));
    const delta = (((todayHigh - historicalHigh) / historicalHigh) * 100).toFixed(2);

    const allQuotes = data.map(c => parseFloat(c[6]));
    const avgVol = allQuotes.reduce((a, b) => a + b, 0) / allQuotes.length;

    const todayQuotes = todayCandles.map(c => parseFloat(c[6]));
    const todayVolAvg = todayQuotes.reduce((a, b) => a + b, 0) / todayQuotes.length;

    const volDeviation = (((todayVolAvg - avgVol) / avgVol) * 100).toFixed(2);
    const close = parseFloat(data[data.length - 1][2]);

    return {
      symbol,
      close,
      high: historicalHigh,
      todayHigh,
      delta,
      volDeviation,
      time: new Date().toISOString()
    };
  } catch (e) {
    return {
      symbol,
      close: '-',
      high: '-',
      todayHigh: '-',
      delta: 'error',
      volDeviation: '-',
      time: new Date().toISOString()
    };
  }
}



function updateRow(result) {
  const i = tableData.findIndex(r => r.symbol === result.symbol);
  if (i >= 0) tableData[i] = result;
  else tableData.push(result);
}

async function updateHTML() {
  const clean = tableData.filter(d => !isNaN(parseFloat(d.delta)));
  const sorted = [...clean].sort((a, b) => parseFloat(b.delta) - parseFloat(a.delta));
  await page.setContent(generateHTML(sorted));
}

function generateHTML(data) {
  return `
  <html><head>
    <style>
      body { font-family: sans-serif; background: #111; color: #eee; padding: 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { padding: 6px; border: 1px solid #444; text-align: right; }
      th { background: #222; position: sticky; top: 0; }
      tr:nth-child(even) { background: #1a1a1a; }
      td:first-child, th:first-child { text-align: left; }
    </style>
  </head><body>
    <h2>🚨 5-Min Pump Recon (20-Day Horizon)</h2>
    <p>Loop: ${refreshCount} | Requests: ${requestCount} | Last update: ${new Date().toLocaleTimeString()}</p>
    <table>
      <thead>
        <tr>
          <th>Coin</th><th>Close</th><th>Today High</th><th>20D High</th><th>Δ%</th><th>VolDev</th><th>Time</th>
        </tr>
      </thead><tbody>
        ${data.map(d => `
          <tr>
            <td>${d.symbol}</td>
            <td>${d.close}</td>
            <td>${d.todayHigh}</td>
            <td>${d.high}</td>
            <td style="color:${parseFloat(d.delta) > 0 ? '#66ff66' : '#ff6666'};">${d.delta}</td>
            <td style="color:${parseFloat(d.volDeviation) > 0 ? '#66ccff' : '#aaa'};">${d.volDeviation}</td>
            <td>${d.time}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </body></html>`;
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}
