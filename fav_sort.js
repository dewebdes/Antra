const axios = require('axios');
const prompt = require('prompt-sync')();

async function getCoinNames() {
    const input = prompt('Enter coin names separated by commas (e.g., BTC,ETH,XRP): ').trim();
    if (!input) {
        console.error('Error: No coin names entered. Please provide valid coin names.');
        process.exit(1);
    }
    return input.toUpperCase().split(',').map(coin => coin.trim());
}

async function getSystemTime() {
    console.log('Fetching server system time...');
    try {
        const response = await axios.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        process.exit(1);
    }
}

async function fetchDailyKlines(coin, sysTime) {
    const startTime = 1000000000;
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=86400`;
    try {
        const response = await axios.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-line data for ${coin}:`, error.message);
        return null;
    }
}

function calculateDeviation(dailyKlines, coin) {
    if (!dailyKlines || dailyKlines.length < 8) return null;

    const todayKline = dailyKlines[dailyKlines.length - 1];
    if (!todayKline) return null; // Ensure todayKline exists

    const todayPercentChange = parseFloat(todayKline[1]) < parseFloat(todayKline[2])
        ? ((parseFloat(todayKline[2]) - parseFloat(todayKline[1])) / parseFloat(todayKline[1])) * 100
        : ((parseFloat(todayKline[1]) - parseFloat(todayKline[2])) / parseFloat(todayKline[1])) * 100;

    const pastWeek = dailyKlines.slice(-8, -1);
    const avgPercentChange = pastWeek.reduce((sum, prevKline) => {
        const prevOpen = parseFloat(prevKline[1]);
        const prevClose = parseFloat(prevKline[2]);
        const change = prevOpen < prevClose
            ? ((prevClose - prevOpen) / prevOpen) * 100
            : ((prevOpen - prevClose) / prevOpen) * 100;
        return sum + Math.abs(change);
    }, 0) / pastWeek.length;

    return {
        coin: coin, // Use the coin name provided instead of extracting it from API response
        currentPercentChange: todayPercentChange,
        avgPercentChange,
        deviation: todayPercentChange - avgPercentChange
    };
}

async function main() {
    const coins = await getCoinNames();
    const sysTime = await getSystemTime();
    const results = [];

    for (const coin of coins) {
        const dailyKlines = await fetchDailyKlines(coin, sysTime);
        const deviationData = calculateDeviation(dailyKlines, coin);
        if (deviationData) results.push(deviationData);
    }

    results.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

    console.log('\n--- Sorted Coins by Today’s Deviation ---');
    results.forEach(({ coin, deviation }) => {
        console.log(`${coin}: ${deviation.toFixed(2)}%`);
    });
}

main();
