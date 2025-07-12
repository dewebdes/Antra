const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const https = require('https');
const playwright = require('playwright');

const executablePath = path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe');
const INTERVAL = 60;
const START_TIME = 1000000000;
const proxyAgent = new https.Agent({ rejectUnauthorized: false });

function getUserCoins() {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('Enter Coin Names (comma-separated): ', answer => {
            rl.close();
            const coins = answer.split(',').map(s => s.trim()).filter(Boolean);
            resolve(coins);
        });
    });
}

function promptUser(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}


async function getSystemTime() {
    const res = await axios.get('https://www.coinex.com/res/system/time', { httpsAgent: proxyAgent });
    return res.data?.data?.current_timestamp;
}

async function getKlines(market, endTime) {
    const url = `https://www.coinex.com/res/market/kline?market=${market}&start_time=${START_TIME}&end_time=${endTime}&interval=${INTERVAL}`;
    const res = await axios.get(url, { httpsAgent: proxyAgent });
    return res.data?.data || [];
}

function extractStealthCeiling(klines, quoteVolLimit = 1.5) {
    const filtered = klines
        .map(k => ({ price: Number(k[2]), quoteVolume: Number(k[6]) }))
        .filter(k => k.quoteVolume <= quoteVolLimit);
    return Math.max(...filtered.map(k => k.price));
}

function detectAllReversalPumps(fullKlines, stealthTopPrice) {
    const results = [];

    for (let i = 0; i < fullKlines.length; i++) {
        const [ts, , close, high] = fullKlines[i];
        const entryPrice = Number(close);
        const entryTS = ts;
        const entryTime = new Date(ts * 1000).toISOString();

        if (entryPrice > stealthTopPrice) continue;

        const future = fullKlines.slice(i + 1);
        let peakPrice = entryPrice;
        let peakTS = entryTS;
        let peakTime = entryTime;

        for (const futureKline of future) {
            const futureHigh = Number(futureKline[3]);
            if (futureHigh > peakPrice) {
                peakPrice = futureHigh;
                peakTS = futureKline[0];
                peakTime = new Date(peakTS * 1000).toISOString();
            }
        }

        const pumpPercent = ((peakPrice - entryPrice) / entryPrice) * 100;
        results.push({ entryTS, entryTime, entryPrice, peakTS, peakTime, peakPrice, pumpPercent });
    }

    return results;
}

function groupReversalRanges(pumpList) {
    const groups = {};

    for (const p of pumpList) {
        const key = p.peakPrice.toFixed(8);
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    }

    const summaries = Object.entries(groups)
        .map(([peakKey, group]) => {
            const sortedGroup = [...group].sort((a, b) => a.entryTS - b.entryTS);
            const minEntry = Math.min(...group.map(g => g.entryPrice));
            const pumpPercent = ((Number(peakKey) - minEntry) / minEntry) * 100;
            const peakTS = sortedGroup.at(-1)?.peakTS;
            const nowTS = pumpList.at(-1)?.peakTS;
            const secondsSincePeak = peakTS && nowTS ? nowTS - peakTS : '-';

            return {
                peakPrice: Number(peakKey),
                startTime: sortedGroup[0].entryTime,
                endTime: sortedGroup.at(-1).peakTime,
                minEntryPrice: minEntry,
                pumpPercent: pumpPercent,
                secondsSincePeak,
                count: group.length
            };
        })
        .filter(s => s.pumpPercent > 0); // Exclude 0%

    return summaries.sort((a, b) => b.pumpPercent - a.pumpPercent);
}

function generateHtmlTable(rows, refreshCount) {
    return `
    <html>
    <head>
      <title>Reversal Scanner</title>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #ccc; padding: 8px; text-align: center; }
        th { background: #eee; }
      </style>
    </head>
    <body>
      <h2>Stealth Reversal Scanner</h2>
      <p>Refresh Count: ${refreshCount}</p>
      <table id="scanner">
        <thead>
          <tr>
            <th>Coin</th>
            <th>Low Vol Price</th>
            <th>Current Price</th>
            <th>Max Reversal</th>
            <th>Max Range</th>
            <th>Last Reversal</th>
            <th>Last Range</th>
            <th>Seconds Since Last</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </body>
    </html>
  `;
}



function findMaxHighIndex(klines) {
    let maxPrice = -Infinity;
    let index = -1;
    for (let i = 0; i < klines.length; i++) {
        const high = Number(klines[i][3]);
        if (high > maxPrice) {
            maxPrice = high;
            index = i;
        }
    }
    console.log('💎 Max high price:', maxPrice, '| Index:', index);
    return index;
}

function logLowestQuoteVolumes(klines, count = 30, quoteVolLimit = null) {
    const parsed = klines
        .map(k => ({
            timestamp: k[0],
            iso: new Date(k[0] * 1000).toISOString(),
            price: Number(k[2]),
            quoteVolume: Number(k[6])
        }))
        .filter(v => v.quoteVolume > 0);

    if (parsed.length === 0) {
        console.log(`❌ No usable quote volumes found.`);
        return {
            quoteVolumes: [],
            maxStealthPrice: -Infinity,
            suggestedCeiling: 1.5
        };
    }

    const sorted = [...parsed].sort((a, b) => a.quoteVolume - b.quoteVolume);
    const suggestedCeiling = sorted[29]?.quoteVolume || 1.5;

    const effectiveLimit = quoteVolLimit ?? suggestedCeiling;
    const stealthFiltered = sorted.filter(v => v.quoteVolume <= effectiveLimit);

    console.log(`\n🧮 Lowest ${count} Quote Volumes (Suggested Ceiling = ${suggestedCeiling.toFixed(6)} USDT):`);
    sorted.slice(0, count).forEach((v, i) => {
        //console.log(`${i + 1}. TS: ${v.timestamp} | Time: ${v.iso} | QuoteVol: ${v.quoteVolume} | Price: ${v.price}`);
    });

    const anchorPrices = stealthFiltered.map(v => v.price).sort((a, b) => a - b);
    console.log(`\n📌 Stealth Prices (sorted ↑):\n${anchorPrices.map(p => p.toFixed(6)).join(', ')}`);

    const maxPriceEntry = stealthFiltered.reduce((max, cur) =>
        cur.price > max.price ? cur : max,
        { price: -Infinity, timestamp: null, iso: '', quoteVolume: 0 }
    );

    if (maxPriceEntry.price > -Infinity) {
        console.log(`\n🔝 Max Price in Stealth Zone (≤ ${effectiveLimit.toFixed(6)}): ${maxPriceEntry.price} @ ${maxPriceEntry.iso}`);
    }

    return {
        quoteVolumes: sorted.map(v => v.quoteVolume),
        maxStealthPrice: maxPriceEntry.price,
        suggestedCeiling: suggestedCeiling
    };
}






function detectReversalPumps(fullKlines, peakIndex, stealthTopPrice, quoteVolFloor = 1.5) {
    const place2Klines = fullKlines.slice(peakIndex + 1);
    const results = [];

    for (let i = 0; i < place2Klines.length; i++) {
        const [ts, open, close, high, low, , rawQuoteVol] = place2Klines[i];
        const entryPrice = Number(close);
        const quoteVol = Number(rawQuoteVol);
        const entryTime = new Date(ts * 1000).toISOString();

        if (entryPrice > stealthTopPrice || quoteVol < quoteVolFloor) continue;

        const future = place2Klines.slice(i + 1);
        let peakPrice = entryPrice;
        let peakTS = ts;
        let peakTime = entryTime;

        for (const futureKline of future) {
            const futureHigh = Number(futureKline[3]);
            if (futureHigh > peakPrice) {
                peakPrice = futureHigh;
                peakTS = futureKline[0];
                peakTime = new Date(peakTS * 1000).toISOString();
            }
        }

        const pumpPercent = ((peakPrice - entryPrice) / entryPrice) * 100;
        results.push({
            entryTS: ts,
            entryTime,
            entryPrice,
            peakTS,
            peakTime,
            peakPrice,
            pumpPercent,
            quoteVolume: quoteVol
        });
    }

    const sorted = [...results].sort((a, b) => a.entryTS - b.entryTS);

    console.log(`\n🚀 Reversal Pumps Detected: ${sorted.length} (filtered by QV ≥ ${quoteVolFloor})`);
    sorted.forEach((r, i) => {
        //console.log(`${i + 1}. Entry → ${r.entryTime} @ ${r.entryPrice} | Peak → ${r.peakTime} @ ${r.peakPrice} | Pump: ${r.pumpPercent.toFixed(2)}% | QV: ${r.quoteVolume.toFixed(2)}`);
    });

    return sorted;
}

async function refreshLoop(coins, page, refreshCount) {
    refreshCount++;
    const systemTime = await getSystemTime();

    for (const coin of coins) {
        const market = `${coin.toUpperCase()}USDT`;
        try {
            const klines = await getKlines(market, systemTime);
            if (!klines || klines.length === 0) continue;

            const peakIndex = findMaxHighIndex(klines);
            const place1 = klines.slice(0, peakIndex + 1);

            const { maxStealthPrice, suggestedCeiling } = logLowestQuoteVolumes(place1);
            const quoteVolLimit = suggestedCeiling;

            console.log(`✅ ${coin.toUpperCase()} using default stealth QV limit: ${quoteVolLimit}\n`);

            const reversalPumps = detectReversalPumps(klines, peakIndex, maxStealthPrice, quoteVolLimit);
            const groupedRanges = groupReversalRanges(reversalPumps);
            const currentPrice = Number(klines.at(-1)[2]);

            if (groupedRanges.length === 0) {
                console.log(`⛔️ No reversal ranges for ${coin.toUpperCase()}. Skipping HTML row.\n`);
                continue;
            }

            const sortedByStrength = [...groupedRanges].sort((a, b) => b.pumpPercent - a.pumpPercent);
            const max = sortedByStrength[0];
            const matchingMax = reversalPumps.filter(p => p.peakPrice === max.peakPrice);
            const entryPriceMax = matchingMax.length > 0
                ? Math.min(...matchingMax.map(p => p.entryPrice))
                : max.minEntryPrice;

            const sortedByTime = [...groupedRanges].sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
            const latest = sortedByTime[0];
            const matchingLatest = reversalPumps.filter(p => p.peakPrice === latest.peakPrice);
            const entryPriceLatest = matchingLatest.length > 0
                ? Math.min(...matchingLatest.map(p => p.entryPrice))
                : latest.minEntryPrice;

            const row = {
                name: coin.toUpperCase(),
                minEntryPrice: maxStealthPrice,
                currentPrice,
                maxPumpPercent: max.pumpPercent,
                maxRange: `${entryPriceMax.toFixed(6)} → ${max.peakPrice.toFixed(6)}`,
                lastPumpPercent: latest.pumpPercent,
                lastRange: `${entryPriceLatest.toFixed(6)} → ${latest.peakPrice.toFixed(6)}`,
                secondsSinceLast: latest.secondsSincePeak
            };

            // 🖥 Inject or update row in dashboard
            await page.evaluate((r) => {
                const table = document.querySelector('#scanner tbody');
                const existing = [...table.rows].find(row => row.cells[0]?.textContent === r.name);

                const html = `
                    <td>${r.name}</td>
                    <td>${r.minEntryPrice.toFixed(6)}</td>
                    <td>${r.currentPrice.toFixed(6)}</td>
                    <td>${r.maxPumpPercent.toFixed(2)}%</td>
                    <td>${r.maxRange}</td>
                    <td>${r.lastPumpPercent.toFixed(2)}%</td>
                    <td>${r.lastRange}</td>
                    <td>${r.secondsSinceLast}s</td>
                `;

                if (existing) {
                    existing.innerHTML = html;
                } else {
                    const newRow = document.createElement('tr');
                    newRow.innerHTML = html;
                    table.appendChild(newRow);
                }
            }, row);

            // ⏱ Delay between coins
            await new Promise(res => setTimeout(res, 3000));

        } catch (err) {
            console.log(`Error fetching ${market}:`, err.message);
        }
    }

    await page.evaluate((count) => {
        const counter = document.querySelector('p');
        if (counter) counter.textContent = `Refresh Count: ${count}`;
    }, refreshCount);


    // 🔁 Reschedule scan after delay
    setTimeout(() => refreshLoop(coins, page, refreshCount), 15000);
}



async function runDashboard() {
    const coins = await getUserCoins();
    const browser = await playwright.chromium.launch({
        executablePath,
        headless: false
    });
    const page = await browser.newPage();

    // Initial blank table
    await page.setContent(generateHtmlTable([], 0));

    const refreshCount = 0;
    refreshLoop(coins, page, refreshCount);
}




runDashboard().catch(console.error);
