const { chromium } = require('playwright');
const axios = require('axios');
const https = require('https');
const { spawnSync } = require('child_process');

const axiosInstance = axios.create({
  proxy: { host: '127.0.0.1', port: 8082 },
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

let browser, page;
let refreshCount = 0;
let requestCount = 0;
let tableData = [];

process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', handleConsoleInput);

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

      if (!isNaN(Number(result.delta))) {
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
  const interval = 300;

  try {
    const res = await axiosInstance.get(
      `https://www.coinex.com/res/market/kline`,
      { params: { market: symbol, start_time: start, end_time: now, interval } }
    );

    const data = res.data.data;
    if (!data || data.length < 288) throw new Error('Not enough candles for 24h');

    const total = data.length;
    const todayCandles = data.slice(-288);
    const historyCandles = data.slice(0, total - 288);

    const todayHigh = Math.max(...todayCandles.map(c => Number(c[3])));
    const historicalHigh = Math.max(...historyCandles.map(c => Number(c[3])));
    const delta = (((todayHigh - historicalHigh) / historicalHigh) * 100).toFixed(2);

    const allQuotes = data.map(c => Number(c[6]));
    const avgVol = allQuotes.reduce((a, b) => a + b, 0) / allQuotes.length;

    const todayQuotes = todayCandles.map(c => Number(c[6]));
    const todayVolAvg = todayQuotes.reduce((a, b) => a + b, 0) / todayQuotes.length;

    const volDeviation = (((todayVolAvg - avgVol) / avgVol) * 100).toFixed(2);
    const close = Number(data[data.length - 1][2]);

    const pulse = extractPulsePoints(data);
    const confirmationStrength = evaluateConfirmationStrength(data, pulse);

    const enterDiff =
      pulse.enterPrice && !isNaN(close)
        ? (((pulse.enterPrice - close) / close) * 100).toFixed(2)
        : null;


    return {
      symbol,
      close,
      high: historicalHigh,
      todayHigh,
      delta,
      volDeviation,
      time: new Date().toISOString(),
      pulse,
      confirmationStrength,
      enterPrice: pulse.enterPrice ?? '-',
      enterDelta: enterDiff
    };
  } catch (e) {
    return {
      symbol,
      close: '-',
      high: '-',
      todayHigh: '-',
      delta: 'error',
      volDeviation: '-',
      time: new Date().toISOString(),
      pulse: null
    };
  }
}
function extractPulsePoints(data) {
  const INTERVAL = 300;
  const VOL_BASELINE_WINDOW = 36;   // 3h
  const STABILITY_WINDOW = 48;      // 4h
  const STDEV_WINDOW = 288;         // 24h

  const pulse = {
    startOfPump: null,
    firstImpulse: null,
    localPeak: null,
    currentDrawdown: null,
    stabilityBefore: { avgVolume: null, avgPrice: null },
    volatilityIndex: null,
    status: null
  };

  const closes = data.map(c => Number(c[2]));
  const vols = data.map(c => Number(c[6]));
  const times = data.map(c => Number(c[0]));

  // -- Volatility Index (VIX)
  if (closes.length >= STDEV_WINDOW) {
    const stdevCloses = closes.slice(-STDEV_WINDOW);
    const mean = stdevCloses.reduce((a, b) => a + b, 0) / stdevCloses.length;
    const stdDev = Math.sqrt(stdevCloses.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / stdevCloses.length);
    pulse.volatilityIndex = stdDev.toFixed(5);
  }

  // -- Detect startOfPump
  for (let i = VOL_BASELINE_WINDOW; i < data.length; i++) {
    const volBase = vols.slice(i - VOL_BASELINE_WINDOW, i);
    const priceBase = closes.slice(i - VOL_BASELINE_WINDOW, i);
    if (volBase.length < VOL_BASELINE_WINDOW || priceBase.length < VOL_BASELINE_WINDOW) continue;

    const volBaseline = avg(volBase);
    const priceBaseline = avg(priceBase);
    const volSurge = vols[i] > volBaseline * 2;
    const pricePop = closes[i] > priceBaseline * 1.02;

    if (volSurge && pricePop) {
      pulse.startOfPump = times[i];

      const volStab = vols.slice(Math.max(0, i - STABILITY_WINDOW), i);
      const priceStab = closes.slice(Math.max(0, i - STABILITY_WINDOW), i);
      pulse.stabilityBefore = {
        avgVolume: volStab.length ? avg(volStab).toFixed(2) : "NaN",
        avgPrice: priceStab.length ? avg(priceStab).toFixed(5) : "NaN"
      };
      break;
    }
  }

  // -- Detect impulse
  if (pulse.startOfPump && pulse.stabilityBefore.avgPrice !== "NaN") {
    const iStart = times.findIndex(t => t === pulse.startOfPump);
    const basePrice = parseFloat(pulse.stabilityBefore.avgPrice);

    for (let i = iStart; i < data.length; i++) {
      if (closes[i] > basePrice * 1.03) {
        pulse.firstImpulse = times[i];
        break;
      }
    }

    // -- Local peak and drawdown
    const post = closes.slice(iStart);
    const peak = Math.max(...post);
    const last = closes[closes.length - 1];
    const peakIdx = post.findIndex(c => c === peak);
    pulse.localPeak = times[iStart + peakIdx];
    pulse.currentDrawdown = (((peak - last) / peak) * 100).toFixed(2);
  }

  // -- Phase classification
  if (!pulse.startOfPump || !pulse.firstImpulse) {
    pulse.status = "no-pump";
  } else {
    const d = parseFloat(pulse.currentDrawdown);
    if (d <= 3) pulse.status = "consolidating";
    else if (d <= 12) pulse.status = "retracing";
    else pulse.status = "impulse-confirmed";
  }

  if (pulse.status !== 'no-pump' && pulse.stabilityBefore.avgPrice !== "NaN") {
    const base = parseFloat(pulse.stabilityBefore.avgPrice);
    pulse.enterPrice = (base * 1.025).toFixed(6);
  }

  return pulse;

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}
function evaluateConfirmationStrength(data, pulse) {
  if (!pulse || pulse.status !== 'impulse-confirmed') return null;

  const closes = data.map(c => Number(c[2]));
  const vols = data.map(c => Number(c[6]));
  const times = data.map(c => Number(c[0]));

  const baseIdx = times.findIndex(t => t === pulse.firstImpulse);
  const postImp = closes.slice(baseIdx);
  const postVol = vols.slice(baseIdx);

  const baseVol = avg(vols.slice(baseIdx - 36, baseIdx));
  const sustainedVol = avg(postVol.slice(0, 12)) > baseVol * 1.1;

  const drawdownOK = parseFloat(pulse.currentDrawdown) < 10;
  const vixOK = parseFloat(pulse.volatilityIndex) < 0.03;

  let score = 0;
  if (sustainedVol) score += 30;
  if (drawdownOK) score += 30;
  if (vixOK) score += 20;

  // Optional: check if recent closes stay above first impulse zone
  const impulsePrice = closes[baseIdx];
  const heldAbove = postImp.slice(0, 12).every(p => p > impulsePrice * 0.99);
  if (heldAbove) score += 20;

  return {
    score,
    rating: score >= 75 ? 'strong' : score >= 50 ? 'moderate' : 'weak'
  };

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}


function handleConsoleInput(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/^json\((\d+)\)$/i);
  if (!match) return;

  const count = parseInt(match[1]);
  const clean = tableData.filter(d => !isNaN(Number(d.delta)));
  const sorted = [...clean].sort((a, b) => Number(b.delta) - Number(a.delta));
  const top = sorted.slice(0, count).map(row => ({
    symbol: row.symbol,
    close: row.close,
    todayHigh: row.todayHigh,
    high: row.high,
    delta: row.delta,
    volDeviation: row.volDeviation,
    time: row.time,
    pulse: row.pulse
  }));

  const output = {
    analysis_type: "breakout_dependency_analysis",
    description: "Copilot should analyze which pumps are independent or dependent by checking external context and signal quality.",
    data: top
  };

  const jsonString = JSON.stringify(output, null, 2);
  console.log(`\n📦 Top ${count} breakout coins JSON:\n`);
  console.log(jsonString);

  try {
    const copyCmd = process.platform === 'win32' ? 'clip' : 'pbcopy';
    require('child_process').spawnSync(copyCmd, [], { input: jsonString });
    console.log('\n✅ JSON copied to clipboard. Paste it to Copilot when ready.');
  } catch (e) {
    console.warn('⚠️ Clipboard copy failed:', e.message);
  }
}

function updateRow(result) {
  const i = tableData.findIndex(r => r.symbol === result.symbol);
  if (i >= 0) tableData[i] = result;
  else tableData.push(result);
}

async function updateHTML() {
  const clean = tableData.filter(d => !isNaN(Number(d.delta)));
  const sorted = [...clean].sort((a, b) => Number(b.delta) - Number(a.delta));
  await page.setContent(generateHTML(sorted));
}

function getStrengthColor(score) {
  if (score === null || score === undefined) return '#aaa';
  if (score >= 75) return '#66ff66'; // green
  if (score >= 50) return '#ffcc66'; // yellow
  return '#ff6666'; // red
}

function getEnterColor(diff) {
  const d = parseFloat(diff);
  if (isNaN(d)) return '#aaa';
  if (Math.abs(d) < 1.0) return '#66ff66'; // green → "entering zone"
  if (Math.abs(d) < 3.5) return '#ffd966'; // yellow → "approaching"
  return '#ff6666'; // red → "too far"
}

function generateHTML(data) {
  var contr = 1;
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
          <th>#</th><th>Coin</th><th>Close</th><th>Today High</th><th>20D High</th><th>Δ%</th><th>VolDev</th><th>Drawdown</th><th>VIX</th><th>Enter</th><th>Status</th><th>Time</th><th>Strength</th>
        </tr>
      </thead><tbody>
        ${data.map(d => `
          <tr>
            <td>${contr++}</td>
            <td>${d.symbol}</td>
            <td>${d.close}</td>
            <td>${d.todayHigh}</td>
            <td>${d.high}</td>
            <td style="color:${Number(d.delta) > 0 ? '#66ff66' : '#ff6666'};">${d.delta}</td>
            <td style="color:${Number(d.volDeviation) > 0 ? '#66ccff' : '#aaa'};">${d.volDeviation}</td>
            <td>${d.pulse?.currentDrawdown ?? '-'}</td>
            <td>${d.pulse?.volatilityIndex ?? '-'}</td>
            <td style="color:${getEnterColor(d.enterDelta)};">${d.enterPrice ?? '-'}</td>
            <td>${d.pulse?.status ?? '-'}</td>
            <td>${d.time}</td>
            <td style="color:${getStrengthColor(d.confirmationStrength?.score)};" title="${d.confirmationStrength?.rating}">${d.confirmationStrength?.score ?? '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </body></html>`;
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}
