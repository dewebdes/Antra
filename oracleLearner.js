// oracleLearner.js
// Dynamic learning from snapshots with 7 growth bands and rule mining

const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
const MAX_EXAMPLES_PER_SYMBOL = 5000; // safety cap for very dense snapshots

// --- Utilities ---
function safeReadJSON(filePath) {
    try {
        const buf = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(buf);
    } catch (e) {
        console.warn(`Skip invalid JSON: ${path.basename(filePath)} -> ${e.message}`);
        return null;
    }
}

function loadSnapshots() {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
        console.error(`Snapshots directory not found: ${SNAPSHOT_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.error('No JSON files found in snapshots directory.');
        process.exit(1);
    }

    const snaps = [];
    for (const f of files) {
        const data = safeReadJSON(path.join(SNAPSHOT_DIR, f));
        if (!data) continue;
        const ts = new Date(data.timestamp || data.ts || 0).getTime();
        if (!Number.isFinite(ts)) {
            console.warn(`Skip file without valid timestamp: ${f}`);
            continue;
        }
        if (!Array.isArray(data.top)) {
            console.warn(`Skip file without "top" array: ${f}`);
            continue;
        }
        snaps.push({ ts, data });
    }

    snaps.sort((a, b) => a.ts - b.ts);
    return snaps;
}

function buildSeries(snaps) {
    const bySymbol = {};
    for (const snap of snaps) {
        for (const row of snap.data.top) {
            const s = row.symbol;
            if (!s) continue;
            if (!bySymbol[s]) bySymbol[s] = [];
            bySymbol[s].push({
                ts: snap.ts,
                price: Number(row.currentPrice),
                ceiling: Number(row.stealthCeiling),
                delta: Number(row.diffPercent),
                age: Number(row.diffDays),
                avgMove: Number(row.avgMovement)
            });
        }
    }
    for (const series of Object.values(bySymbol)) {
        series.sort((a, b) => a.ts - b.ts);
    }
    return bySymbol;
}

function labelFromReturn(ret) {
    if (ret >= 100) return 'Growth_100plus';
    if (ret >= 60 && ret < 100) return 'Growth_60_100';
    if (ret >= 30 && ret < 60) return 'Growth_30_60';
    if (ret >= 20 && ret < 30) return 'Growth_20_30';
    if (ret >= 13 && ret < 20) return 'Growth_13_20';
    if (ret >= 7 && ret < 13) return 'Growth_7_13';
    if (ret >= 5 && ret < 7) return 'Growth_5_7';
    if (ret <= -10) return 'Negative_10';
    return 'Neutral';
}

function labelExamples(series) {
    const examples = [];

    for (const [symbol, rows] of Object.entries(series)) {
        const n = rows.length;
        if (n < 2) continue;

        let pairsCount = 0;
        for (let i = 0; i < n - 1; i++) {
            const start = rows[i];
            if (!Number.isFinite(start.price) || start.price <= 0) continue;

            for (let j = i + 1; j < n; j++) {
                const end = rows[j];
                if (!Number.isFinite(end.price) || end.price <= 0) continue;

                const hours = (end.ts - start.ts) / (1000 * 60 * 60);
                if (hours <= 0) continue;

                const ret = ((end.price - start.price) / start.price) * 100;
                const target = labelFromReturn(ret);

                examples.push({
                    symbol,
                    startTs: start.ts,
                    endTs: end.ts,
                    hours,
                    ret,
                    features: {
                        ceiling: start.ceiling,
                        delta: start.delta,
                        age: start.age,
                        avgMove: start.avgMove
                    },
                    target
                });

                pairsCount++;
                if (pairsCount >= MAX_EXAMPLES_PER_SYMBOL) break;
            }
            if (pairsCount >= MAX_EXAMPLES_PER_SYMBOL) break;
        }
    }

    return examples;
}

function bucketizeFeatureSet(f) {
    const bCeil = f.ceiling > 5 ? '>5' : f.ceiling > 3 ? '3-5' : f.ceiling > 1 ? '1-3' : '<=1';
    const bDelta = f.delta > 10 ? '>10' : f.delta > 5 ? '5-10' : f.delta > 0 ? '0-5' : '<=0';
    const bAge = f.age === 0 ? '0' : f.age <= 1 ? '0-1' : f.age <= 3 ? '1-3' : '>3';
    const bMove = f.avgMove > 0 ? 'pos' : f.avgMove < 0 ? 'neg' : 'zero';
    return `${bCeil}|${bDelta}|${bAge}|${bMove}`;
}

function aggregateByLabel(examples, targetLabel) {
    const stats = {};
    let overallPos = 0;
    let overallTotal = 0;

    for (const ex of examples) {
        const key = bucketizeFeatureSet(ex.features);
        if (!stats[key]) stats[key] = { pos: 0, total: 0 };

        stats[key].total++;
        overallTotal++;

        if (ex.target === targetLabel) {
            stats[key].pos++;
            overallPos++;
        }
    }

    const baseline = overallTotal > 0 ? overallPos / overallTotal : 0;
    const rules = Object.entries(stats)
        .map(([key, v]) => {
            const precision = v.total > 0 ? v.pos / v.total : 0;
            const lift = baseline > 0 ? precision / baseline : 0;
            return { rule: key, precision, coverage: v.total, lift };
        })
        .filter(r => r.coverage >= 5 && r.precision >= 0.6 && r.lift >= 2)
        .sort((a, b) => (b.lift - a.lift) || (b.precision - a.precision));

    return { rules, baseline, total: overallTotal, positives: overallPos };
}

function prettyRule(key, label) {
    const [ceil, delta, age, move] = key.split('|');
    return `IF StealthCeiling ${ceil}, Δ% ${delta}, AnchorAge ${age}, AvgMove ${move} THEN ${label}`;
}

function formatHoursStats(examples, targetLabel) {
    const hours = examples
        .filter(e => e.target === targetLabel)
        .map(e => e.hours)
        .sort((a, b) => a - b);
    if (hours.length === 0) return 'hours: n/a';

    const mid = (arr) => {
        const m = Math.floor(arr.length / 2);
        return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
    };
    const p = (arr, q) => {
        const idx = Math.floor(q * (arr.length - 1));
        return arr[idx];
    };

    return `hours: median=${mid(hours).toFixed(1)}, p20=${p(hours, 0.2).toFixed(1)}, p80=${p(hours, 0.8).toFixed(1)}`;
}

function run() {
    const snaps = loadSnapshots();
    const series = buildSeries(snaps);
    const examples = labelExamples(series);

    const labels = [
        'Growth_5_7',
        'Growth_7_13',
        'Growth_13_20',
        'Growth_20_30',
        'Growth_30_60',
        'Growth_60_100',
        'Growth_100plus',
        'Negative_10'
    ];

    for (const label of labels) {
        const { rules, baseline, total, positives } = aggregateByLabel(examples, label);
        console.log(`\n=== ${label} ===`);
        console.log(`Baseline rate: ${(baseline * 100).toFixed(2)}% | examples: ${total} | positives: ${positives}`);
        console.log(formatHoursStats(examples, label));

        if (rules.length === 0) {
            console.log('No strong rules found (coverage ≥ 5, precision ≥ 60%, lift ≥ 2).');
            continue;
        }

        for (const r of rules.slice(0, 10)) {
            console.log(`${prettyRule(r.rule, label)} | precision=${(r.precision * 100).toFixed(1)}% | coverage=${r.coverage} | lift=${r.lift.toFixed(2)}`);
        }
    }
}

run();
