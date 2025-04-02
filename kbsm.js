const axios = require('axios');
const KalmanFilter = require('kalmanjs'); // Example library for Kalman filter
const prompt = require('prompt-sync')(); // Library for user input via prompt

// Proxy configuration
const proxy = {
    host: '127.0.0.1',
    port: 8082
};
const axiosInstance = axios.create({
    proxy,
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Fetch system time (required for API calls)
async function fetchSystemTime() {
    const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
    return response.data.data.current_timestamp;
}

// Fetch k-line data
async function fetchKlines(coin, interval) {
    const market = `${coin}USDT`;
    const sysTime = await fetchSystemTime();
    const response = await axiosInstance.get(
        `https://www.coinex.com/res/market/kline?market=${market}&start_time=0&end_time=${sysTime}&interval=${interval}`
    );
    return response.data.data;
}

// RTM Strategy (Mean Reversion)
function calculateRTM(klines) {
    const closePrices = klines.map(k => Number(k[4]));
    const movingAverage = closePrices.reduce((sum, price) => sum + price, 0) / closePrices.length;
    return closePrices.map(price => ({
        price,
        signal: price < movingAverage ? 'Enter' : price > movingAverage ? 'Exit' : null
    })).filter(s => s.signal !== null);
}

// ICT Strategy (Liquidity Zones)
function calculateICT(klines) {
    const highPrices = klines.map(k => Number(k[2]));
    const lowPrices = klines.map(k => Number(k[3]));
    return {
        demandZone: Math.min(...lowPrices),
        supplyZone: Math.max(...highPrices)
    };
}

// KBSM Strategy (Kalman Filter)
function calculateKBSM(klines) {
    const closePrices = klines.map(k => Number(k[4]));
    const kalmanFilter = new KalmanFilter();
    const smoothedPrices = closePrices.map(price => kalmanFilter.filter(price));
    return closePrices.map((price, index) => ({
        price,
        signal: price < smoothedPrices[index] ? 'Enter' : price > smoothedPrices[index] ? 'Exit' : null
    })).filter(s => s.signal !== null);
}

// Correlation Analysis for BTC Relation
function calculateCorrelation(targetPrices, btcPrices) {
    const meanTarget = targetPrices.reduce((sum, price) => sum + price, 0) / targetPrices.length;
    const meanBTC = btcPrices.reduce((sum, price) => sum + price, 0) / btcPrices.length;

    const numerator = targetPrices.reduce((sum, price, index) => sum + (price - meanTarget) * (btcPrices[index] - meanBTC), 0);
    const denominator = Math.sqrt(
        targetPrices.reduce((sum, price) => sum + Math.pow(price - meanTarget, 2), 0) *
        btcPrices.reduce((sum, price) => sum + Math.pow(price - meanBTC, 2), 0)
    );

    return numerator / denominator; // Returns the correlation coefficient
}

// Find Best Enter/Exit Points with BTC Relation
function findBestPoints(rtmSignals, kbsmSignals, ictZones, targetCorrelation, btcCorrelation) {
    const adjustedEnterPoint = Math.min(
        ...rtmSignals.filter(s => s.signal === 'Enter').map(s => s.price),
        ...kbsmSignals.filter(s => s.signal === 'Enter').map(s => s.price),
        ictZones.demandZone
    );

    const adjustedExitPoint = Math.max(
        ...rtmSignals.filter(s => s.signal === 'Exit').map(s => s.price),
        ...kbsmSignals.filter(s => s.signal === 'Exit').map(s => s.price),
        ictZones.supplyZone
    );

    console.log(`Correlation with BTC: ${targetCorrelation.toFixed(4)} (Target Coin), ${btcCorrelation.toFixed(4)} (BTC)`);

    return { enterPoint: adjustedEnterPoint, exitPoint: adjustedExitPoint };
}

// Main Function to Analyze the Coin
async function analyzeCoin() {
    const coin = prompt("Enter the coin name (e.g., BTC): ").toUpperCase(); // Get coin name from user
    const interval = 300; // 5-minute interval
    console.log(`Fetching data for ${coin}...`);

    try {
        const klines = await fetchKlines(coin, interval);
        const currentPrice = Number(klines[klines.length - 1][4]); // Latest price

        let btcKlines = [];
        let targetCorrelation = 0;
        let btcCorrelation = 0;

        if (coin !== 'BTC') {
            console.log('Fetching BTC data for additional analysis...');
            btcKlines = await fetchKlines('BTC', interval);

            const targetPrices = klines.map(k => Number(k[4])); // Closing prices for the target coin
            const btcPrices = btcKlines.map(k => Number(k[4])); // Closing prices for BTC

            targetCorrelation = calculateCorrelation(targetPrices, btcPrices);
            btcCorrelation = calculateCorrelation(btcPrices, btcPrices); // BTC self-correlation for normalization
        }

        const rtmSignals = calculateRTM(klines);
        const ictZones = calculateICT(klines);
        const kbsmSignals = calculateKBSM(klines);

        const { enterPoint, exitPoint } = findBestPoints(rtmSignals, kbsmSignals, ictZones, targetCorrelation, btcCorrelation);

        console.log(`Current Price for ${coin}: ${currentPrice}`);
        console.log(`Best Entry Point (Buy): ${enterPoint}`);
        console.log(`Best Exit Point (Sell): ${exitPoint}`);
    } catch (error) {
        console.error('Error during analysis:', error.message);
    }
}

// Run Analysis
analyzeCoin();
