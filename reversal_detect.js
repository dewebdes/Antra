const axios = require('axios');
const https = require('https');

// Proxy setup
const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

// Config
//const market = 'MEMECOINUSDT';
const interval = 60;
const startTime = 1000000000;

const readline = require('readline');

function promptUser(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}


async function getSystemTime() {
    const res = await axiosInstance.get('https://www.coinex.com/res/system/time');
    const ts = res.data?.data?.current_timestamp;
    console.log('📆 CoinEx System Time:', ts);
    return ts;
}

async function getKlines(endTime, market) {
    const url = `https://www.coinex.com/res/market/kline?market=${market}&start_time=${startTime}&end_time=${endTime}&interval=${interval}`;
    const res = await axiosInstance.get(url);
    const klines = res.data?.data || [];
    console.log(`📈 Klines loaded for ${market}:`, klines.length);
    return klines;
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

function logLowestQuoteVolumes(klines, count = 30) {
    const parsed = klines
        .map(k => ({
            timestamp: k[0],
            iso: new Date(k[0] * 1000).toISOString(),
            price: Number(k[2]),
            quoteVolume: Number(k[6])
        }))
        .filter(v => v.quoteVolume > 0); // usable entries only

    if (parsed.length === 0) {
        console.log('❌ No usable klines for stealth volume analysis.');
        return {
            quoteVolumes: [],
            maxStealthPrice: -Infinity,
            suggestedCeiling: 1.5
        };
    }

    const sorted = [...parsed].sort((a, b) => a.quoteVolume - b.quoteVolume);
    const suggestedCeiling = sorted[29]?.quoteVolume || 1.5;

    const stealthFiltered = sorted.filter(v => v.quoteVolume <= suggestedCeiling);

    console.log(`\n🧮 Lowest ${count} Quote Volumes → Proposed stealth ceiling: ${suggestedCeiling.toFixed(6)} USDT`);
    sorted.slice(0, count).forEach((v, i) => {
        console.log(`${i + 1}. TS: ${v.timestamp} | Time: ${v.iso} | QuoteVol: ${v.quoteVolume} | Price: ${v.price}`);
    });

    const maxPriceEntry = stealthFiltered.reduce((max, cur) =>
        cur.price > max.price ? cur : max,
        { price: -Infinity, timestamp: null, iso: '', quoteVolume: 0 }
    );

    if (maxPriceEntry.price > -Infinity) {
        console.log(`\n🔝 Max Price in Stealth Zone (≤ ${suggestedCeiling.toFixed(6)}): ${maxPriceEntry.price} @ ${maxPriceEntry.iso}`);
    }

    return {
        quoteVolumes: sorted.map(v => v.quoteVolume),
        maxStealthPrice: maxPriceEntry.price,
        suggestedCeiling
    };
}


function detectStealthClusters(klines, quoteVolLimit = 1.5, maxDowntrendTolerance = 5) {
    let clusters = [];
    let currentCluster = [];
    let prevClose = null;
    let downtrendBuffer = [];

    for (let i = 0; i < klines.length; i++) {
        const [ts, open, close, , , , quoteVolRaw] = klines[i];
        const closeNum = Number(close);
        const quoteVol = Number(quoteVolRaw);
        const iso = new Date(ts * 1000).toISOString();
        const trendLabel = (prevClose !== null && closeNum > prevClose) ? 'Uptrend ✅' : 'Downtrend ❌';

        if (prevClose !== null && closeNum > prevClose && quoteVol <= quoteVolLimit) {
            if (downtrendBuffer.length > 0) {
                currentCluster.push(...downtrendBuffer);
                downtrendBuffer = [];
            }
            currentCluster.push({ timestamp: ts, time: iso, quoteVolume: quoteVol, price: closeNum });
            console.log(`🟢 Stealth → TS: ${ts} | Time: ${iso} | QuoteVol: ${quoteVol} | Price: ${closeNum} | ${trendLabel}`);
        } else if (prevClose !== null && closeNum < prevClose && quoteVol <= quoteVolLimit) {
            downtrendBuffer.push({ timestamp: ts, time: iso, quoteVolume: quoteVol, price: closeNum });
            console.log(`🔶 Buffering → TS: ${ts} | Time: ${iso} | QuoteVol: ${quoteVol} | Price: ${closeNum} | ${trendLabel}`);
            if (downtrendBuffer.length >= maxDowntrendTolerance) {
                if (currentCluster.length > 0) {
                    //console.log(`❌ Cluster discarded due to downtrend persistence.`);
                    currentCluster = [];
                }
                downtrendBuffer = [];
            }
        } else {
            if (currentCluster.length > 0) {
                const anchor = currentCluster[currentCluster.length - 1];
                clusters.push({
                    candles: [...currentCluster],
                    anchorCandle: {
                        timestamp: anchor.timestamp,
                        time: anchor.time,
                        price: anchor.price,
                        quoteVolume: anchor.quoteVolume,
                    },
                });
                currentCluster = [];
                downtrendBuffer = [];
            }
            if (prevClose !== null) {
                //console.log(`🔴 Break → TS: ${ts} | Time: ${iso} | QuoteVol: ${quoteVol} | Price: ${closeNum} | ${trendLabel}`);
            }
        }

        prevClose = closeNum;
    }

    if (currentCluster.length > 0) {
        const anchor = currentCluster[currentCluster.length - 1];
        clusters.push({
            candles: [...currentCluster],
            anchorCandle: {
                timestamp: anchor.timestamp,
                time: anchor.time,
                price: anchor.price,
                quoteVolume: anchor.quoteVolume,
            },
        });
    }

    console.log(`\n🧠 Stealth clusters detected: ${clusters.length}`);
    clusters.forEach((c, i) => {
        console.log(
            `${i + 1}. Anchor → TS: ${c.anchorCandle.timestamp} | Time: ${c.anchorCandle.time} | QuoteVol: ${c.anchorCandle.quoteVolume} | Price: ${c.anchorCandle.price} | Length: ${c.candles.length}`
        );
    });

    // Collect all anchor prices
    const anchorPrices = clusters.map(c => c.anchorCandle.price);
    const sortedAnchors = [...anchorPrices].sort((a, b) => a - b);

    console.log(`\n📌 Anchor Prices (sorted ↑):\n${sortedAnchors.map(p => p.toFixed(6)).join(', ')}`);


    return clusters;
}

function detectReversalsAfterPeak(fullKlines, peakIndex, stealthTopPrice, quoteVolFloor = 1.5) {
    const place2Klines = fullKlines.slice(peakIndex + 1);
    const reversals = [];

    for (let i = 0; i < place2Klines.length; i++) {
        const [ts, open, close, high, low, , quoteVolRaw] = place2Klines[i];
        const quoteVol = Number(quoteVolRaw);
        const openNum = Number(open);
        const closeNum = Number(close);
        const lowNum = Number(low);
        const highNum = Number(high);
        const iso = new Date(ts * 1000).toISOString();

        const touchedZone = lowNum <= stealthTopPrice;
        const bounced = closeNum > openNum;

        if (touchedZone && bounced && quoteVol >= quoteVolFloor) {
            bounceStrength = close - low;
            rangeSize = high - low;
            bouncePercent = (bounceStrength / rangeSize) * 100;

            reversals.push({
                timestamp: ts,
                time: iso,
                minPrice: lowNum,
                maxPrice: highNum,
                quoteVolume: quoteVol,
                close: closeNum,
                bouncePercent: bouncePercent
            });
        }
    }

    const sorted = [...reversals].sort((a, b) => b.bouncePercent - a.bouncePercent);

    //console.log(`\n🔄 Reversals detected: ${sorted.length} (sorted by strength ↓)`);
    sorted.forEach((r, i) => {
        // console.log(
        //  `${i + 1}. TS: ${r.timestamp} | Time: ${r.time} | QuoteVol: ${r.quoteVolume.toFixed(2)} | Min: ${r.minPrice} | Max: ${r.maxPrice} | Close: ${r.close} | Bounce: ${r.bouncePercent.toFixed(2)}%`
        // );
    });

    return sorted;
}

function detectFailedReversalZones(fullKlines, peakIndex, stealthTopPrice) {
    const place2Klines = fullKlines.slice(peakIndex + 1);
    const results = [];

    for (let i = 0; i < place2Klines.length; i++) {
        const [ts, open, close, high, low] = place2Klines[i];
        const closeNum = Number(close);
        const highNum = Number(high);
        const lowNum = Number(low);
        const iso = new Date(ts * 1000).toISOString();

        // Skip if above stealthTopPrice
        if (closeNum > stealthTopPrice) continue;

        // Scan forward: if any candle closes above this one, skip it
        const future = place2Klines.slice(i + 1);
        const breakout = future.find(k => Number(k[2]) > closeNum);
        if (breakout) continue;

        // Scan backward to find lowest price before candidate
        const past = place2Klines.slice(0, i);
        let lowestPrice = lowNum;
        for (const p of past) {
            const pastLow = Number(p[4]);
            if (pastLow < lowestPrice) {
                lowestPrice = pastLow;
            }
        }

        // Scan forward again to find first candle breaking below lowestPrice
        let breach = null;
        for (let j = i + 1; j < place2Klines.length; j++) {
            const futureLow = Number(place2Klines[j][4]);
            if (futureLow < lowestPrice) {
                breach = place2Klines[j];
                break;
            }
        }

        // If breach found, record range
        if (breach) {
            const breachTs = breach[0];
            const breachTime = new Date(breachTs * 1000).toISOString();
            const breachLow = Number(breach[4]);
            const dropPercent = ((closeNum - breachLow) / breachLow) * 100;

            results.push({
                entryTS: ts,
                entryTime: iso,
                entryPrice: closeNum,
                breachTS: breachTs,
                breachTime: breachTime,
                breachPrice: breachLow,
                dropPercent: dropPercent
            });
        }
    }

    // Sort by drop percent descending
    const sorted = [...results].sort((a, b) => b.dropPercent - a.dropPercent);

    //console.log(`\n⚠️ Failed Reversal Zones Detected: ${sorted.length} ↓`);
    sorted.forEach((r, i) => {
        //console.log(
        // `${i + 1}. Entry → ${r.entryTime} @ ${r.entryPrice} | Breach → ${r.breachTime} @ ${r.breachPrice} | Drop: ${r.dropPercent.toFixed(2)}%`
        //);
    });

    return sorted;
}

function detectReversalPumps(fullKlines, peakIndex, stealthTopPrice) {
    const place2Klines = fullKlines.slice(peakIndex + 1);
    const results = [];

    for (let i = 0; i < place2Klines.length; i++) {
        const [ts, open, close, high, low] = place2Klines[i];
        const entryPrice = Number(close);
        const entryTime = new Date(ts * 1000).toISOString();

        // Skip if entry price above stealth zone
        if (entryPrice > stealthTopPrice) continue;

        // Scan forward to find peak price after entry
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
            pumpPercent
        });
    }

    // Sort chronologically by entry time
    const sorted = [...results].sort((a, b) => a.entryTS - b.entryTS);

    //console.log(`\n🚀 Reversal Pumps Detected: ${sorted.length} (chronological)`);
    sorted.forEach((r, i) => {
        // console.log(
        //   `${i + 1}. Entry → ${r.entryTime} @ ${r.entryPrice} | Peak → ${r.peakTime} @ ${r.peakPrice} | Pump: ${r.pumpPercent.toFixed(2)}%`
        // );
    });

    return sorted;
}

function summarizePumpRange(pumpList) {
    const sharedPeak = Math.max(...pumpList.map(p => p.peakPrice));
    const minEntry = pumpList.reduce((min, p) => p.entryPrice < min ? p.entryPrice : min, Infinity);
    const pumpPercent = ((sharedPeak - minEntry) / minEntry) * 100;

    const startTime = pumpList[0].entryTime;
    const endTime = pumpList[pumpList.length - 1].peakTime;

    /*console.log(`\n📊 Consolidated Reversal Range:`);
    console.log(`Start → ${startTime}`);
    console.log(`End → ${endTime}`);
    console.log(`Lowest Entry → ${minEntry}`);
    console.log(`Shared Peak → ${sharedPeak}`);
    console.log(`Pump: ${pumpPercent.toFixed(2)}%`);*/
}

function printAllConsolidatedReversalRanges(pumpList) {
    const groups = {};

    // Group by peakPrice
    for (const p of pumpList) {
        const key = p.peakPrice.toFixed(8); // Normalize float keys
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    }

    const summaries = Object.entries(groups).map(([peakKey, group]) => {
        const sortedGroup = [...group].sort((a, b) => a.entryTS - b.entryTS);
        const minEntry = Math.min(...group.map(g => g.entryPrice));
        const pumpPercent = ((Number(peakKey) - minEntry) / minEntry) * 100;

        return {
            peakPrice: Number(peakKey),
            startTime: sortedGroup[0].entryTime,
            endTime: sortedGroup[sortedGroup.length - 1].peakTime,
            minEntryPrice: minEntry,
            pumpPercent: pumpPercent.toFixed(2),
            count: group.length
        };
    });

    // Sort by startTime ASC
    const sortedSummaries = summaries.sort((a, b) =>
        new Date(a.startTime) - new Date(b.startTime)
    );

    //console.log(`\n📊 All Consolidated Reversal Ranges:`);
    sortedSummaries.forEach((s, i) => {
        // console.log(
        //   `${i + 1}. Start → ${s.startTime} | End → ${s.endTime} | Min Entry → ${s.minEntryPrice} | Peak → ${s.peakPrice} | Pump: ${s.pumpPercent}% | Entries: ${s.count}`
        // );
    });
}

function printReversalRangesByPumpStrength(pumpList) {
    const groups = {};

    // Group entries by shared peak price
    for (const p of pumpList) {
        const key = p.peakPrice.toFixed(8);
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    }

    const summaries = Object.entries(groups).map(([peakKey, group]) => {
        const sortedGroup = [...group].sort((a, b) => a.entryTS - b.entryTS);
        const minEntry = Math.min(...group.map(g => g.entryPrice));
        const pumpPercent = ((Number(peakKey) - minEntry) / minEntry) * 100;

        return {
            peakPrice: Number(peakKey),
            startTime: sortedGroup[0].entryTime,
            endTime: sortedGroup[sortedGroup.length - 1].peakTime,
            minEntryPrice: minEntry,
            pumpPercent: pumpPercent,
            count: group.length
        };
    });

    // Filter out 0% pumps
    const filtered = summaries.filter(s => s.pumpPercent > 0);

    // Sort by pump strength descending
    const sorted = filtered.sort((a, b) => b.pumpPercent - a.pumpPercent);

    console.log(`\n🏁 Strong Reversal Ranges (Pump > 0%) ↓`);
    sorted.forEach((s, i) => {
        console.log(
            `${i + 1}. Start → ${s.startTime} | End → ${s.endTime} | Min Entry → ${s.minEntryPrice} | Peak → ${s.peakPrice} | Pump: ${s.pumpPercent.toFixed(2)}% | Entries: ${s.count}`
        );
    });
}


// Runner
async function runDetection() {
    const coinInput = await promptUser('🪙 Enter coin symbol (e.g., MEMECOIN): ');
    const market = `${coinInput.toUpperCase()}USDT`;

    const endTime = await getSystemTime();
    const fullKlines = await getKlines(endTime, market);

    const peakIndex = findMaxHighIndex(fullKlines);
    const place1Klines = fullKlines.slice(0, peakIndex + 1);

    const { maxStealthPrice, suggestedCeiling } = logLowestQuoteVolumes(place1Klines);

    console.log(`\n📊 Suggested stealth ceiling based on 30th lowest quote volume: ${suggestedCeiling}`);
    const userInput = await promptUser(`Use ${suggestedCeiling} as quoteVolume limit? (Enter to accept or type a new value): `);

    const quoteVolLimit = userInput.trim() === '' ? suggestedCeiling : Number(userInput.trim());

    console.log(`\n🛠 Final quoteVolume limit: ${quoteVolLimit}`);

    //return;

    const stealthClusters = detectStealthClusters(place1Klines, quoteVolLimit);

    //return;

    const reversals = detectReversalsAfterPeak(fullKlines, peakIndex, maxStealthPrice, quoteVolLimit);
    const failedReversals = detectFailedReversalZones(fullKlines, peakIndex, maxStealthPrice);
    const reversalPumps = detectReversalPumps(fullKlines, peakIndex, maxStealthPrice);

    //const batch = reversalPumps.filter(p => p.peakPrice === maxStealthPrice);

    //summarizePumpRange(batch);

    printAllConsolidatedReversalRanges(reversalPumps);
    printReversalRangesByPumpStrength(reversalPumps);
}


runDetection().catch(console.error);
