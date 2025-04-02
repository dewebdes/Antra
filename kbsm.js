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

// Helper function to detect decimal precision
function getDecimalPoints(price) {
    const priceString = price.toString();
    if (priceString.includes('.')) {
        return priceString.split('.')[1].length; // Number of digits after the decimal point
    }
    return 0; // No decimals
}

// Calculate Sell Prices based on profit percentages
function calculateSellPrices(entryPrice) {
    const decimalPoints = getDecimalPoints(entryPrice); // Get decimal precision dynamically
    return {
        profit1_33: (entryPrice * 1.0133).toFixed(decimalPoints),
        profit2_4: (entryPrice * 1.024).toFixed(decimalPoints),
        profit3: (entryPrice * 1.03).toFixed(decimalPoints),
        profit5: (entryPrice * 1.05).toFixed(decimalPoints)
    };
}

// Find Best Enter/Exit Points
function findBestPoints(rtmSignals, kbsmSignals, ictZones) {
    const enterPoint = Math.min(
        ...rtmSignals.filter(s => s.signal === 'Enter').map(s => s.price),
        ...kbsmSignals.filter(s => s.signal === 'Enter').map(s => s.price),
        ictZones.demandZone
    );

    const exitPoint = Math.max(
        ...rtmSignals.filter(s => s.signal === 'Exit').map(s => s.price),
        ...kbsmSignals.filter(s => s.signal === 'Exit').map(s => s.price),
        ictZones.supplyZone
    );

    return { enterPoint, exitPoint };
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

        if (coin !== 'BTC') {
            console.log('Fetching BTC data for additional analysis...');
            btcKlines = await fetchKlines('BTC', interval);

            const targetPrices = klines.map(k => Number(k[4])); // Closing prices for the target coin
            const btcPrices = btcKlines.map(k => Number(k[4])); // Closing prices for BTC

            targetCorrelation = calculateCorrelation(targetPrices, btcPrices);
        }

        const rtmSignals = calculateRTM(klines);
        const ictZones = calculateICT(klines);
        const kbsmSignals = calculateKBSM(klines);

        const { enterPoint, exitPoint } = findBestPoints(rtmSignals, kbsmSignals, ictZones);

        const sellPrices = calculateSellPrices(enterPoint);
        const kbsmProfit = (((exitPoint / enterPoint) - 1) * 100).toFixed(getDecimalPoints(exitPoint)); // KBSM profit percentage

        console.log(`Current Price for ${coin}: ${currentPrice}`);
        console.log(`Best Entry Point (Buy): ${enterPoint}`);
        console.log('Sell Prices for Profit:');
        console.log(`  1. 1.33% profit: ${sellPrices.profit1_33}`);
        console.log(`  2. 2.4% profit: ${sellPrices.profit2_4}`);
        console.log(`  3. 3% profit: ${sellPrices.profit3}`);
        console.log(`  4. 5% profit: ${sellPrices.profit5}`);
        console.log(`  5. KBSM Sell Price: ${exitPoint} (${kbsmProfit}% profit)`);
    } catch (error) {
        console.error('Error during analysis:', error.message);
    }
}

// Run Analysis
analyzeCoin();
