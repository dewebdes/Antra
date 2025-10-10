const { chromium } = require('playwright');
const axios = require('axios');
const https = require('https');
const { spawnSync } = require('child_process');
const express = require('express');
const app = express();
const cors = require('cors');
const PORT = 3000; // Change as needed

app.use(cors());

app.get('/deltatrend/:count', (req, res) => {
  const count = parseInt(req.params.count);

  const deltaSnapshots = Object.entries(deltaHistoryMap)
    .map(([symbol, history]) => {
      if (!history || history.length < 2) return { symbol, avgMove: -Infinity };
      const changes = [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const percentChange = ((curr - prev) / Math.abs(prev || 1)) * 100;
        changes.push(percentChange);
      }
      const avgMove = changes.reduce((a, b) => a + b, 0) / changes.length;
      return { symbol, avgMove };
    });

  const sorted = deltaSnapshots
    .filter(d => d.avgMove !== -Infinity)
    .sort((a, b) => b.avgMove - a.avgMove);

  // 🔄 Sorted by live delta, matching HTML row order
  const htmlSorted = [...tableData]
    .filter(d => !isNaN(Number(d.delta)))
    .sort((a, b) => Number(b.delta) - Number(a.delta));

  const top = sorted.slice(0, count).map(d => {
    const cleanSymbol = d.symbol.replace(/USDT$/, '');
    const rowIdx = htmlSorted.findIndex(r => r.symbol === d.symbol);
    const row = rowIdx >= 0 ? htmlSorted[rowIdx] : null;

    const history = deltaHistoryMap[d.symbol] || [];
    const changes = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      const pct = ((curr - prev) / Math.abs(prev || 1)) * 100;
      changes.push(pct);
    }
    const avgTrend = changes.length
      ? changes.reduce((a, b) => a + b, 0) / changes.length
      : null;

    return {
      rank: rowIdx + 1, // ✅ HTML row number
      symbol: cleanSymbol,
      avgMove: d.avgMove,
      close: row?.close ?? '-',
      todayHigh: row?.todayHigh ?? '-',
      high: row?.high ?? '-',
      delta: row?.delta ?? '-',
      volDeviation: row?.volDeviation ?? '-',
      drawdown: row?.pulse?.currentDrawdown ?? null,
      vix: row?.pulse?.volatilityIndex ?? null,
      enterPrice: row?.enterPrice ?? '-',
      enterDelta: row?.enterDelta ?? '-',
      status: row?.pulse?.status ?? '-',
      confirmationStrength: row?.confirmationStrength ?? null,
      jump: row?.jump ?? null,
      jumpFromStart: row?.jumpFromStart ?? null,
      deltaTrendAvg: avgTrend?.toFixed(2) ?? null
    };
  });

  res.json({
    timestamp: new Date().toISOString(),
    refreshCount,
    resetCount,
    top
  });
});




const axiosInstance = axios.create({
  proxy: { host: '127.0.0.1', port: 8082 },
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

let browser, page;
let refreshCount = 0;
let requestCount = 0;
let tableData = [];
let initialOrder = null;
let previousOrder = null;
const rankHistoryMap = {}; // symbol => [rank1, rank2, rank3...]

const deltaHistoryMap = {}; // symbol => [delta1, delta2, delta3...]


process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', handleConsoleInput);

const appStartDate = new Date();

function shouldReset() {
  const now = new Date();
  const daysElapsed = Math.floor((now - appStartDate) / (1000 * 60 * 60 * 24));
  return now.getHours() === 0 && daysElapsed >= 2;
}

function exportSnapshot(count = 20) {
  const clean = tableData.filter(d => !isNaN(Number(d.delta)));
  const sorted = [...clean].sort((a, b) => Number(b.delta) - Number(a.delta));
  const top = sorted.slice(0, count);

  const output = {
    analysis_type: "reset_export",
    description: `Snapshot before reset @ ${new Date().toISOString()}`,
    symbols: top.map(r => r.symbol),
    data: top
  };

  const json = JSON.stringify(output, null, 2);
  const fs = require('fs');
  const filename = `reset_snapshot_${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(filename, json);
  console.log(`📁 Snapshot saved: ${filename}`);
}

let resetCount = 0;


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


    if (shouldReset()) {
      exportSnapshot();
      console.log('\n🔄 Auto-reset triggered after 2 days at midnight.');
      tableData = [];
      initialOrder = null;
      previousOrder = null;
      Object.keys(rankHistoryMap).forEach(k => rankHistoryMap[k] = []);
      Object.keys(deltaHistoryMap).forEach(k => deltaHistoryMap[k] = []);
      refreshCount = 0;
      requestCount = 0;
      resetCount++;
    }




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

      await updateHTML();  // Live update after each request
      await delay(150);
    }

    // -- Only run jump + trend tracking after full loop --
    const cleanSorted = [...tableData]
      .filter(d => !isNaN(Number(d.delta)))
      .sort((a, b) => Number(b.delta) - Number(a.delta));

    const symbolsNow = cleanSorted.map(row => row.symbol);

    if (!initialOrder) initialOrder = [...symbolsNow];

    if (previousOrder) {
      cleanSorted.forEach((row, i) => {
        const prevIdx = previousOrder.indexOf(row.symbol);
        const jump = prevIdx !== -1 ? prevIdx - i : 0;
        row.jump = jump;

        const initIdx = initialOrder.indexOf(row.symbol);
        const jumpFromStart = initIdx !== -1 ? initIdx - i : 0;
        row.jumpFromStart = jumpFromStart;
      });
    }

    previousOrder = [...symbolsNow];

    cleanSorted.forEach((row, idx) => {
      if (!rankHistoryMap[row.symbol]) rankHistoryMap[row.symbol] = [];
      rankHistoryMap[row.symbol].push(idx + 1); // 1-based rank
    });

    console.log(`✅ Loop #${refreshCount} complete. Total requests: ${requestCount}`);
  }


})();

function generateSparkline(history, color = '#66ccff') {
  if (!history || history.length < 2) return '';

  const w = 50, h = 20;
  const len = Math.min(history.length, 12); // limit to recent points
  const data = history.slice(-len);
  const max = Math.max(...data);
  const min = Math.min(...data);

  const points = data.map((val, i) => {
    const x = (i / (len - 1)) * w;
    const y = h - ((val - min) / (max - min || 1)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"/>
    </svg>
  `;
}

function getJumpColor(j) {
  if (j === null || j === undefined) return '#aaa';
  const val = Math.abs(j);
  if (val === 0) return '#ccc'; // no move
  if (j > 0) return '#66ff66'; // moved up
  if (j < 0) return '#ff6666'; // moved down
}

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

  let marketCap = null;
  let volume24h = null;

  try {
    // 🔍 Fetch market cap and volume from CoinEx asset list
    const asset = symbol.replace('USDT', '');
    const assetRes = await axiosInstance.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000');
    const assetData = assetRes.data.data.data.find(c => c.asset === asset);
    if (assetData) {
      marketCap = Number(assetData.circulation_usd);
      volume24h = Number(assetData.deal_amount);
    }

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

    if (!deltaHistoryMap[symbol]) deltaHistoryMap[symbol] = [];
    deltaHistoryMap[symbol].push(Number(delta) || 0);

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
      enterDelta: enterDiff,
      marketCap,
      volume24h,
      volumeToCapRatio: (volume24h && marketCap) ? (volume24h / marketCap).toFixed(4) : null
    };
  } catch (e) {
    if (!deltaHistoryMap[symbol]) deltaHistoryMap[symbol] = [];
    deltaHistoryMap[symbol].push(0);

    return {
      symbol,
      close: '-',
      high: '-',
      todayHigh: '-',
      delta: 'error',
      volDeviation: '-',
      time: new Date().toISOString(),
      pulse: null,
      marketCap,
      volume24h,
      volumeToCapRatio: null
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

  // -- JSON Export --
  const jsonMatch = trimmed.match(/^json\((\d+)\)$/i);
  if (jsonMatch) {
    const count = parseInt(jsonMatch[1]);
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
    return;
  }

  // -- Jump Filter Export --
  const jumpMatch = trimmed.match(/^jump\((\-?\d+)\)$/i);
  if (jumpMatch) {
    const threshold = parseInt(jumpMatch[1]);
    const candidates = tableData.filter(d => typeof d.jump === 'number' && d.jump >= threshold);
    const symbols = candidates.map(d => d.symbol).join(',');
    console.log(`\n🚀 Coins with jump >= ${threshold}:\n${symbols}\n`);

    try {
      const copyCmd = process.platform === 'win32' ? 'clip' : 'pbcopy';
      require('child_process').spawnSync(copyCmd, [], { input: symbols });
      console.log('✅ Symbol list copied to clipboard.');
    } catch (e) {
      console.warn('⚠️ Clipboard copy failed:', e.message);
    }
    return;
  }

  // -- Delta Trend Export (based on average movement %)
  const deltaTrendMatch = trimmed.match(/^deltatrend\((\d+)\)$/i);
  if (deltaTrendMatch) {
    const count = parseInt(deltaTrendMatch[1]);

    const deltaSnapshots = Object.entries(deltaHistoryMap)
      .map(([symbol, history]) => {
        if (!history || history.length < 2) return { symbol, avgMove: -Infinity };

        const changes = [];
        for (let i = 1; i < history.length; i++) {
          const prev = history[i - 1];
          const curr = history[i];
          const percentChange = ((curr - prev) / Math.abs(prev || 1)) * 100;
          changes.push(percentChange);
        }

        const avgMove = changes.reduce((a, b) => a + b, 0) / changes.length;
        return { symbol, avgMove };
      });

    const sorted = deltaSnapshots
      .filter(d => d.avgMove !== -Infinity)
      .sort((a, b) => b.avgMove - a.avgMove);

    const topSymbols = sorted.slice(0, count).map(d => d.symbol).join(',');

    console.log(`\n📈 Top ${count} coins by Δ trend (avg movement):\n${topSymbols}\n`);

    try {
      const copyCmd = process.platform === 'win32' ? 'clip' : 'pbcopy';
      require('child_process').spawnSync(copyCmd, [], { input: topSymbols });
      console.log('✅ Symbol list copied to clipboard.');
    } catch (e) {
      console.warn('⚠️ Clipboard copy failed:', e.message);
    }
    return;
  }

  // -- Delta History Export for a Symbol
  const deltaHistMatch = trimmed.match(/^deltahistory\(([\w]+)\)$/i);
  if (deltaHistMatch) {
    const symbol = deltaHistMatch[1].toUpperCase();
    const history = deltaHistoryMap[symbol];

    if (!history || history.length === 0) {
      console.log(`\n🚫 No delta history found for ${symbol}\n`);
      return;
    }

    const output = history.map(v => v.toFixed(2)).join(',');
    console.log(`\n🧮 Δ History for ${symbol}:\n${output}\n`);

    try {
      const copyCmd = process.platform === 'win32' ? 'clip' : 'pbcopy';
      require('child_process').spawnSync(copyCmd, [], { input: output });
      console.log('✅ History copied to clipboard.');
    } catch (e) {
      console.warn('⚠️ Clipboard copy failed:', e.message);
    }
    return;
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
          <th>#</th><th>Coin</th><th>Close</th><th>Today High</th><th>20D High</th><th>Δ%</th><th>Δ Trend</th><th>VolDev</th><th>Drawdown</th><th>VIX</th><th>Enter</th><th>Status</th><th>Time</th><th>Strength</th><th>Jump</th><th>Trend</th>
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
            <td style="color:${(() => {
      const history = deltaHistoryMap[d.symbol];
      if (!history || history.length < 2) return '#aaa';

      const changes = [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const percentChange = ((curr - prev) / Math.abs(prev || 1)) * 100;
        changes.push(percentChange);
      }

      const avgMovement = changes.length
        ? changes.reduce((a, b) => a + b, 0) / changes.length
        : 0;

      return avgMovement > 0 ? '#66ff66' : '#ff6666'; // green/red
    })()}">
  ${(() => {
      const history = deltaHistoryMap[d.symbol];
      if (!history || history.length < 2) return '-';

      const changes = [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const percentChange = ((curr - prev) / Math.abs(prev || 1)) * 100;
        changes.push(percentChange);
      }

      const avgMovement = changes.length
        ? changes.reduce((a, b) => a + b, 0) / changes.length
        : 0;

      return avgMovement.toFixed(2);
    })()}
</td>



            <td style="color:${Number(d.volDeviation) > 0 ? '#66ccff' : '#aaa'};">${d.volDeviation}</td>
            <td>${d.pulse?.currentDrawdown ?? '-'}</td>
            <td>${d.pulse?.volatilityIndex ?? '-'}</td>
            <td style="color:${getEnterColor(d.enterDelta)};">${d.enterPrice ?? '-'}</td>
            <td>${d.pulse?.status ?? '-'}</td>
            <td>${d.time}</td>
            <td style="color:${getStrengthColor(d.confirmationStrength?.score)};" title="${d.confirmationStrength?.rating}">${d.confirmationStrength?.score ?? '-'}</td>
            <td title="${d.jumpFromStart > 0 ? '+' : ''}${d.jumpFromStart} since loop #1" style="color:${getJumpColor(d.jump)};">${d.jump > 0 ? '+' : ''}${d.jump ?? '-'}</td>
            <td>${generateSparkline(rankHistoryMap[d.symbol])}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </body></html>`;
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

app.listen(PORT, () => {
  console.log(`📡 DeltaTrend socket listening at http://localhost:${PORT}`);
});

