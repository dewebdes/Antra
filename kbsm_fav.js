const axios = require('axios');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')(); // Library for user input via prompt

let refreshCounter = 0; // Track the number of refreshes

const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

async function fetchSystemTime() {
    const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
    return response.data.data.current_timestamp;
}

async function fetchKlines(coin, interval) {
    const market = `${coin}USDT`;
    const sysTime = await fetchSystemTime();
    const response = await axiosInstance.get(
        `https://www.coinex.com/res/market/kline?market=${market}&start_time=0&end_time=${sysTime}&interval=${interval}`
    );
    return response.data.data;
}

// RTM Strategy: Mean Reversion
function calculateRTM(klines) {
    const closePrices = klines.map(k => Number(k[4]));
    const movingAverage = closePrices.reduce((sum, price) => sum + price, 0) / closePrices.length;
    return closePrices.map(price => ({
        price,
        signal: price < movingAverage ? 'Enter' : price > movingAverage ? 'Exit' : null
    })).filter(s => s.signal !== null);
}

// ICT Strategy: Liquidity Zones
function calculateICT(klines) {
    const highPrices = klines.map(k => Number(k[2]));
    const lowPrices = klines.map(k => Number(k[3]));
    return {
        demandZone: Math.min(...lowPrices),
        supplyZone: Math.max(...highPrices)
    };
}

// Find Best Points
function findBestPoints(rtmSignals, ictZones) {
    const enterPoint = Math.min(
        ...rtmSignals.filter(s => s.signal === 'Enter').map(s => s.price),
        ictZones.demandZone
    );

    const exitPoint = Math.max(
        ...rtmSignals.filter(s => s.signal === 'Exit').map(s => s.price),
        ictZones.supplyZone
    );

    return { enterPoint, exitPoint };
}

// Analyze a Single Coin
async function analyzeCoin(coin) {
    try {
        console.log(`Analyzing data for ${coin}...`);
        const klines = await fetchKlines(coin, 300); // 5-minute interval
        const currentPrice = Number(klines[klines.length - 1][4]);
        const rtmSignals = calculateRTM(klines);
        const ictZones = calculateICT(klines);
        const { enterPoint, exitPoint } = findBestPoints(rtmSignals, ictZones);

        // Calculate the percentage remaining to enter (always positive)
        const percentRemainingToEnter = Math.abs(((enterPoint - currentPrice) / enterPoint) * 100);

        console.log(`Analysis for ${coin} completed. Current Price: ${currentPrice}`);
        return { coin, currentPrice, enterPoint, exitPoint, percentRemainingToEnter: percentRemainingToEnter.toFixed(2) };
    } catch (error) {
        console.error(`Error analyzing ${coin}: ${error.message}`);
        return null;
    }
}

// Generate HTML Table
async function updateHtmlTable(browserPage, results) {
    refreshCounter++; // Increment the refresh count

    // Sort results by ascending percentRemainingToEnter (nearest to Enter price first)
    const sortedResults = results
        .filter(r => r !== null)
        .sort((a, b) => a.percentRemainingToEnter - b.percentRemainingToEnter);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Coin Analysis</title>
            <style>
                body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
                th { background-color: #f4f4f4; font-weight: bold; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                tr:hover { background-color: #f1f1f1; }
                .refresh-count { font-size: 16px; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h1>Coin Analysis</h1>
            <div class="refresh-count">Refresh Count: ${refreshCounter}</div>
            <table>
                <thead>
                    <tr>
                        <th>Coin</th>
                        <th>Current Price</th>
                        <th>Enter Price</th>
                        <th>Exit Price</th>
                        <th>Percent Remaining to Enter (%)</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedResults.map(result => `
                        <tr>
                            <td>${result.coin}</td>
                            <td>${result.currentPrice}</td>
                            <td>${result.enterPoint}</td>
                            <td>${result.exitPoint}</td>
                            <td>${result.percentRemainingToEnter}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;

    console.log(`Updating HTML table... (Refresh Count: ${refreshCounter})`);
    await browserPage.setContent(htmlContent); // Update the browser with new HTML content
}

// Main Script Logic
async function main() {
    const coinsInput = prompt("Enter a list of coins (e.g., BTC,ETH,LTC): ");
    const coins = coinsInput.split(',').map(coin => coin.trim().toUpperCase());

    console.log("Launching browser...");
    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });
    const page = await browser.newPage();

    console.log("Fetching initial data and generating table...");
    async function refreshData() {
        console.log("Fetching and analyzing 5m Klines...");
        const results = await Promise.all(coins.map(coin => analyzeCoin(coin)));
        await updateHtmlTable(page, results);
        console.log("5m Klines data refreshed.");
    }

    // Initial data fetch
    await refreshData();

    // Refresh 5m Klines every 5 minutes
    setInterval(refreshData, 300000);

    // Update just the current prices every 1 minute
    setInterval(async () => {
        console.log("Fetching current prices...");
        const updatedResults = await Promise.all(coins.map(coin => analyzeCoin(coin)));
        await updateHtmlTable(page, updatedResults);
        console.log("Current prices refreshed in HTML log.");
    }, 60000);
}

main();
