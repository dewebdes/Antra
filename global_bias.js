// global_bias.js – Updated script using CoinEx real-time sentiment data

const https = require('https');

const COINEX_ENDPOINT = 'https://www.coinex.com/res/system/trade/info';

function fetchMarketData(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed?.data); // top-level response holds 'data' object
                } catch (err) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        }).on('error', err => reject(err));
    });
}

function computeGlobalBias(raw) {
    const {
        price_up_nums,
        price_down_nums,
        total_asset_count,
        circulation_usd_change_rate,
        spot_deal_rate,
        spot_deal_24
    } = raw || {};

    const safeParse = v => Number.isFinite(v) ? v : parseFloat(v) || 0;

    const up = safeParse(price_up_nums);
    const down = safeParse(price_down_nums);
    const total = safeParse(total_asset_count);
    const circChange = safeParse(circulation_usd_change_rate);
    const dealRate = safeParse(spot_deal_rate);
    const deal24 = safeParse(spot_deal_24); // not used yet but available

    const upRatio = up / (total || 1);
    const downRatio = down / (total || 1);
    const circulationScore = Math.sign(circChange);
    const dealScore = Math.sign(dealRate) * 0.5;

    let bias_score = (upRatio - downRatio) + circulationScore + dealScore;
    bias_score = Math.max(-1, Math.min(1, bias_score));

    let sentiment_label = 'neutral';
    let suggested_sell_profit = 0.2;
    let buy_order_depth_factor = 1.0;

    if (bias_score > 0.3) {
        sentiment_label = 'bullish';
        suggested_sell_profit = 0.22;
        buy_order_depth_factor = 0.8;
    } else if (bias_score < -0.3) {
        sentiment_label = 'bearish';
        suggested_sell_profit = 0.15;
        buy_order_depth_factor = 1.3;
    }

    return {
        bias_score: Number(bias_score.toFixed(2)),
        sentiment_label,
        suggested_sell_profit,
        buy_order_depth_factor
    };
}

async function runBiasAnalysis() {
    try {
        const marketData = await fetchMarketData(COINEX_ENDPOINT);
        const result = computeGlobalBias(marketData);

        console.log('\n📊 Global Bias Analysis');
        console.log('------------------------');
        console.log(`🧭 Bias Score       : ${result.bias_score}`);
        console.log(`📉 Sentiment        : ${result.sentiment_label}`);
        console.log(`💰 Sell Profit Target: ${result.suggested_sell_profit * 100}%`);
        console.log(`📥 Buy Depth Factor : ${result.buy_order_depth_factor}`);
    } catch (err) {
        console.error('\n⚠️ Error:', err.message);
    }
}

runBiasAnalysis();
