const axios = require('axios');
const prompt = require('prompt-sync')();

const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
    }
}

async function getKlines(coin, interval, sysTime, limit) {
    const url = `https://www.coinex.com/res/market/kline?market=${coin}&start_time=${sysTime - limit * interval}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching ${coin} K-lines:`, error.message);
    }
}

function calculateChangeRate(klines) {
    const high = Math.max(...klines.map(kline => parseFloat(kline[2])));
    const low = Math.min(...klines.map(kline => parseFloat(kline[3])));
    return ((high - low) / high) * 100; // Percentage change
}

function predictCoinPrice(btcChangeRate, coinChangeRate, currentBTCPrice, targetBTCPrice, currentCoinPrice) {
    const btcDumpFactor = (currentBTCPrice - targetBTCPrice) / currentBTCPrice;
    const estimatedCoinChange = btcDumpFactor * (coinChangeRate / btcChangeRate);
    return currentCoinPrice * (1 - estimatedCoinChange);
}

async function main() {
    const coin = prompt('Enter the coin name (e.g., ETH): ').toUpperCase();
    const targetBTCPrice = parseFloat(prompt('Enter the target price for BTC: '));

    console.log('Fetching data...');
    const sysTime = await getSystemTime();
    if (!sysTime) return;

    const interval = 300; // 5-minute interval
    const limit = 30; // Last 30 candles

    const btcKlines = await getKlines('BTCUSDT', interval, sysTime, limit);
    const coinKlines = await getKlines(`${coin}USDT`, interval, sysTime, limit);

    if (btcKlines && coinKlines) {
        console.log('Calculating change rates...');
        const btcChangeRate = calculateChangeRate(btcKlines);
        const coinChangeRate = calculateChangeRate(coinKlines);

        console.log(`BTC Change Rate: ${btcChangeRate.toFixed(2)}%`);
        console.log(`${coin} Change Rate: ${coinChangeRate.toFixed(2)}%`);

        const currentBTCPrice = parseFloat(btcKlines[btcKlines.length - 1][4]);
        const currentCoinPrice = parseFloat(coinKlines[coinKlines.length - 1][4]);

        console.log(`Current BTC Price: ${currentBTCPrice}`);
        console.log(`Current ${coin} Price: ${currentCoinPrice}`);

        console.log('Predicting coin price...');
        const predictedCoinPrice = predictCoinPrice(
            btcChangeRate,
            coinChangeRate,
            currentBTCPrice,
            targetBTCPrice,
            currentCoinPrice
        );

        console.log(`Estimated ${coin} price if BTC dumps to ${targetBTCPrice}: ${predictedCoinPrice.toFixed(2)}`);
    } else {
        console.log('Failed to fetch data for analysis.');
    }
}

main();
