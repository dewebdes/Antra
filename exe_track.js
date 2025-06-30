const axios = require('axios');
const { createHash } = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { chromium } = require('playwright');

const ACCESS_ID = "DD053DC012674525AEE34A8C5D093C01";
const SECRET_KEY = "6D968D2DA5629E83B42B6F99362B87F4B5E2077104D6803B";

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(prompt, ans => { rl.close(); res(ans.trim()); }));
}

function createSign(method, path, body, ts) {
  return createHash('sha256').update(method + path + body + ts + SECRET_KEY).digest('hex').toUpperCase();
}

const riskAxios = axios.create({
  baseURL: 'https://api.coinex.com/',
  headers: { 'User-Agent': 'Mozilla/5.0 Chrome/39.0.2171.71' },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10000
});

async function fetchTrades(coin, lastId = null) {
  const ts = Date.now();
  const path = `/v2/spot/deals`;
  const url = `${path}?market=${coin}USDT${lastId ? `&last_id=${lastId}` : ''}`;
  const headers = {
    'X-COINEX-KEY': ACCESS_ID,
    'X-COINEX-SIGN': createSign('GET', path, '', ts),
    'X-COINEX-TIMESTAMP': ts
  };
  const res = await riskAxios.get(url, { headers });
  return res.data?.data || [];
}

function toHHMM(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function normalizeBars(trades) {
  const grouped = {};

  for (const t of trades) {
    const time = toHHMM(t.created_at);
    if (!grouped[time]) grouped[time] = { amount: 0, price: 0, value: 0 };
    grouped[time].amount += +t.amount;
    grouped[time].value += +t.amount * +t.price;
    grouped[time].price = Math.max(grouped[time].price, +t.price);
  }

  const maxValue = Math.max(...Object.values(grouped).map(v => v.value)) || 1;

  return Object.entries(grouped).map(([time, v]) => ({
    time,
    price: v.price,
    amount: v.amount,
    volume_usd: v.value,
    fill: v.price * (v.value / maxValue)
  }));
}

function prepareHTML(buyBars, sellBars, coin) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${coin} Volume Fill Bars</title>
  <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
  <style>
    body { font-family: sans-serif; margin: 0; }
    #status { background: #111; color: #eee; padding: 10px; font-size: 14px; }
    #chart { height: 90vh; }
  </style>
</head>
<body>
  <div id="status">📡 Live ${coin} feed</div>
  <div id="chart"></div>
  <script>
    let buys = ${JSON.stringify(buyBars)};
    let sells = ${JSON.stringify(sellBars)};
    let updates = 0;

    function formatUSD(n) {
      return "$" + n.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
    }

    function render() {
      const layout = {
        title: "${coin} Volume Fill Bars (USD)",
        grid: { rows: 2, columns: 1, pattern: "independent" },
        margin: { t: 60 },
        xaxis: {
          title: "Buy Time",
          type: "category",
          categoryorder: "array",
          categoryarray: buys.map(d => d.time)
        },
        yaxis: { title: "Buy Price" },
        xaxis2: {
          title: "Sell Time",
          type: "category",
          categoryorder: "array",
          categoryarray: sells.map(d => d.time)
        },
        yaxis2: { title: "Sell Price" }
      };

      const buyFrame = {
        type: "bar",
        x: buys.map(d => d.time),
        y: buys.map(d => d.price),
        base: 0,
        offsetgroup: "buy",
        marker: { color: "rgba(0,0,0,0)", line: { color: "green", width: 2 } },
        text: buys.map(d => "▲ " + formatUSD(d.volume_usd)),
        name: "Buy Frame",
        xaxis: "x",
        yaxis: "y",
        showlegend: false
      };

      const buyFill = {
        type: "bar",
        x: buys.map(d => d.time),
        y: buys.map(d => d.fill),
        base: 0,
        offsetgroup: "buy",
        marker: { color: "green", opacity: 0.6 },
        name: "Buy Fill",
        xaxis: "x",
        yaxis: "y",
        showlegend: false
      };

      const sellFrame = {
        type: "bar",
        x: sells.map(d => d.time),
        y: sells.map(d => d.price),
        base: 0,
        offsetgroup: "sell",
        marker: { color: "rgba(0,0,0,0)", line: { color: "red", width: 2 } },
        text: sells.map(d => "▼ " + formatUSD(d.volume_usd)),
        name: "Sell Frame",
        xaxis: "x2",
        yaxis: "y2",
        showlegend: false
      };

      const sellFill = {
        type: "bar",
        x: sells.map(d => d.time),
        y: sells.map(d => d.fill),
        base: 0,
        offsetgroup: "sell",
        marker: { color: "red", opacity: 0.6 },
        name: "Sell Fill",
        xaxis: "x2",
        yaxis: "y2",
        showlegend: false
      };

      Plotly.newPlot("chart", [buyFrame, buyFill, sellFrame, sellFill], layout);
    }

    window.receiveNewData = function (rows) {
      for (const r of rows) {
        const arr = r.side === "buy" ? buys : sells;
        const idx = arr.findIndex(t => t.time === r.readable_time);
        const usd = r.price * r.amount;

        if (idx >= 0) {
          arr[idx].volume_usd += usd;
          arr[idx].price = Math.max(arr[idx].price, r.price);
        } else {
          arr.push({
            time: r.readable_time,
            volume_usd: usd,
            price: r.price,
            fill: 0
          });
        }
      }

      const maxBuy = Math.max(...buys.map(d => d.volume_usd)) || 1;
      const maxSell = Math.max(...sells.map(d => d.volume_usd)) || 1;

      for (const b of buys) b.fill = b.price * (b.volume_usd / maxBuy);
      for (const s of sells) s.fill = s.price * (s.volume_usd / maxSell);

      updates += rows.length;
      document.getElementById("status").textContent = "✅ " + updates + " trades | " + new Date().toLocaleTimeString();
      render();
    };

    render();
  </script>
</body>
</html>`;
}







async function retryGoto(page, file, retries = 5, delay = 60000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(`file://${file}`, { waitUntil: 'load', timeout: 30000 });
      return; // success!
    } catch (err) {
      console.error(`⚠️  Attempt ${attempt} failed: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Waiting ${delay / 1000}s before retrying...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw new Error("❌ Failed to load live.html after multiple attempts.");
      }
    }
  }
}


async function main() {
  const coin = (await ask("Enter coin (e.g. BTC): ")).toUpperCase();
  console.log(`📊 Starting ${coin} volume bar chart...`);

  let all = [], lastId = null;
  for (let page = 1; page <= 10; page++) {
    const chunk = await fetchTrades(coin, lastId);
    if (!chunk.length) break;
    all.push(...chunk);
    lastId = chunk.at(-1).deal_id;
    console.log(`🔄 [Page ${page}] Fetched ${chunk.length}`);
  }

  const reversed = all.reverse();
  const buyBars = normalizeBars(reversed.filter(t => t.side === "buy"));
  const sellBars = normalizeBars(reversed.filter(t => t.side === "sell"));

  const html = prepareHTML(buyBars, sellBars, coin);
  const file = path.join(__dirname, "live.html");
  fs.writeFileSync(file, html);

  const browser = await chromium.launch({
    headless: false,
    executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
  });



  const page = await browser.newPage();
  //await page.goto(`file://${file}`);
  await retryGoto(page, file);


  setInterval(async () => {
    try {
      const updates = await fetchTrades(coin, lastId);
      if (updates.length) {
        lastId = updates.at(-1).deal_id;
        const cleaned = updates.map(t => ({
          side: t.side,
          price: +t.price,
          amount: +t.amount,
          readable_time: toHHMM(t.created_at)
        }));
        await page.evaluate(rows => window.receiveNewData(rows), cleaned);
        console.log(`📈 +${updates.length} new executions`);
      } else {
        console.log("⏸️  No new trades this round");
      }
    } catch (err) {
      console.error("❌ Fetch error:", err.message);
    }
  }, 60_000);
}

main();
