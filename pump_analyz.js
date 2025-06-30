const axios = require('axios');
const fs = require('fs');
const https = require('https');
const { createHash } = require('crypto');
const { chromium } = require('playwright');
const readline = require('readline');

// === AUTH & SETTINGS ===
const ACCESS_ID = 'DD053DC012674525AEE34A8C5D093C01';
const SECRET_KEY = '6D968D2DA5629E83B42B6F99362B87F4B5E2077104D6803B';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// === User Input ===
function ask(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(prompt, ans => { rl.close(); res(ans); }));
}

// === API Config ===
const riskAPI = axios.create({
    baseURL: 'https://api.coinex.com/',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    proxy: { host: '127.0.0.1', port: 8082 },
    timeout: 10000
});

function readable(ms) {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function authSig(method, path, body, ts) {
    const raw = method + path + body + ts + SECRET_KEY;
    return createHash('sha256').update(raw).digest('hex').toUpperCase();
}

function buildChartHTML() {
    return `
  <html>
    <head>
      <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
      <style>
        body { margin:0; background:#111; color:#ccc; font-family:sans-serif; }
        h3 { padding: 10px; margin: 0; }
      </style>
    </head>
    <body>
      <h3 id="refCount">Refresh: 1</h3>
      <div id="plot" style="width:100vw;height:90vh;"></div>
      <script>
        let count = 1;
        async function update() {
          const res = await fetch('anchor_data.json?' + Date.now());
          const data = await res.json();
          Plotly.newPlot('plot', data.traces, data.layout);
          count++;
          document.getElementById('refCount').innerText = 'Refresh: ' + count;
        }
        update();
        setInterval(update, 60000);
      </script>
    </body>
  </html>
  `;
}

async function fetchTrades(coin) {
    let lastId = null, page = 1, trades = [];
    while (page++ <= 12) {
        const ts = Date.now();
        const path = `/v2/spot/deals`;
        const url = `${path}?market=${coin}USDT${lastId ? `&last_id=${lastId}` : ''}`;
        const headers = {
            'X-COINEX-KEY': ACCESS_ID,
            'X-COINEX-SIGN': authSig('GET', path, '', ts),
            'X-COINEX-TIMESTAMP': ts
        };
        const res = await riskAPI.get(url, { headers });
        const deals = res.data?.data || [];
        if (!deals.length) break;
        deals.forEach(d => trades.push({
            ts: d.created_at * 1000,
            price: Number(d.price),
            amount: Number(d.amount),
            side: d.side
        }));
        lastId = deals.at(-1).deal_id;
    }
    return trades.reverse();
}

function extractAnchors(trades) {
    const anchors = { range: { high: 0, low: Infinity } };
    for (let i = 5; i < trades.length; i++) {
        const w = trades.slice(i - 5, i + 1);
        const buys = w.filter(t => t.side === 'buy').reduce((s, t) => s + t.amount, 0);
        const sells = w.filter(t => t.side === 'sell').reduce((s, t) => s + t.amount, 0);
        const delta = w.at(-1).price - w[0].price;
        const spread = Math.max(...w.map(t => t.price)) - Math.min(...w.map(t => t.price));
        const last = w.at(-1);

        anchors.range.low = Math.min(anchors.range.low, last.price);
        anchors.range.high = Math.max(anchors.range.high, last.price);

        if (!anchors.mm_lift_price && delta > 0 && sells < 1 && buys < 5)
            anchors.mm_lift_price = { price: last.price, time: readable(last.ts) };

        if (!anchors.user_chase_peak && buys > sells * 3 && spread > last.price * 0.003)
            anchors.user_chase_peak = { price: last.price, time: readable(last.ts) };

        if (!anchors.mm_exit_zone && sells > buys * 2 && delta < 0 && spread > last.price * 0.005)
            anchors.mm_exit_zone = { price: last.price, time: readable(last.ts) };

        if (!anchors.flush_support && delta < 0 && buys > 1 && sells > 1 && spread < last.price * 0.002)
            anchors.flush_support = { price: last.price, time: readable(last.ts) };
    }
    return anchors;
}

function makePlotData(trades, anchors) {
    const labels = {
        mm_lift_price: '📈 mm_lift',
        user_chase_peak: '🤖 user FOMO',
        mm_exit_zone: '💰 mm exit',
        flush_support: '🛠 flush support'
    };

    const traceLine = {
        x: trades.map(t => new Date(t.ts)),
        y: trades.map(t => t.price),
        type: 'scatter',
        mode: 'lines',
        name: 'price',
        line: { color: '#00ccff' }
    };

    const markers = Object.entries(labels).map(([k, label]) => {
        const a = anchors[k];
        return !a ? null : {
            x: [a.time],
            y: [a.price],
            type: 'scatter',
            mode: 'markers+text',
            marker: { size: 10 },
            text: [label],
            textposition: 'top center',
            name: label
        };
    }).filter(Boolean);

    return {
        traces: [traceLine, ...markers],
        layout: {
            title: `${coin} Anchor Map`,
            margin: { t: 40 },
            xaxis: { title: 'Time' },
            yaxis: { title: 'Price' },
            showlegend: false
        }
    };
}

async function startChrome() {
    const browser = await chromium.launch({
        headless: false,
        executablePath: CHROME_PATH
    });
    const page = await browser.newPage();
    await page.goto(`file://${__dirname}/anchor_chart.html`);
    return page;
}

let coin = '';

async function generateAndUpdate(refresh = true) {
    const trades = await fetchTrades(coin);
    const anchors = extractAnchors(trades);
    const plot = makePlotData(trades, anchors);
    fs.writeFileSync('anchor_data.json', JSON.stringify(plot));
    if (refresh) console.log(`[${new Date().toLocaleTimeString()}] Chart updated`);
}

(async () => {
    coin = (await ask('Enter coin (e.g. BTC): ')).toUpperCase();
    fs.writeFileSync('anchor_chart.html', buildChartHTML());
    await generateAndUpdate(false);
    await startChrome();
    setInterval(generateAndUpdate, 60000);
})();
