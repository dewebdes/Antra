const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')();
const cors = require('cors');

const app = express();
app.use(express.static(__dirname));
app.use(cors());

const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

let browser;
let page;

// **FETCH SYSTEM TIME**
async function getSystemTime() {
    console.log('Fetching system time...');
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        console.log('Successfully fetched system time:', response.data.data.current_timestamp);
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

// **USER INPUT**
console.log("Select a timeframe:");
console.log("1. 5m");
console.log("2. 15m");
console.log("3. 1h");
console.log("4. 4h");

const timeframeChoice = prompt("Enter your choice (1-4): ").trim();
const timeframes = { "1": 300, "2": 900, "3": 3600, "4": 14400 };
const timeframe = timeframes[timeframeChoice] || 300;

const coin = prompt('Enter the coin name (e.g., BTC): ').trim().toUpperCase() || 'BTC';
console.log(`Selected timeframe: ${timeframe / 60} minutes`);

// **FETCH ALL HISTORICAL DAILY K-LINES**
async function fetchDailyKlines(coin) {
    console.log(`Fetching daily K-lines for ${coin}...`);

    const sysTime = await getSystemTime();
    if (!sysTime) return console.error("Failed to fetch system time.");

    const startTime = 1000000000;
    const endTime = sysTime;

    try {
        const response = await axiosInstance.get(
            `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${endTime}&interval=86400`
        );

        if (!response.data || !response.data.data) throw new Error("Invalid API response");
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching daily K-lines for ${coin}:`, error.message);
        return null;
    }
}

// **ANALYZE LIFECYCLE**
function analyzeLifecycle(klines) {
    if (!Array.isArray(klines)) {
        console.error("Error: Expected K-lines to be an array.");
        return [];
    }

    const uniqueDates = {};

    klines.forEach(day => {
        const dateString = new Date(day[0] * 1000).toISOString().split('T')[0];
        if (!uniqueDates[dateString]) {
            uniqueDates[dateString] = {
                date: dateString,
                pumpPercent: (day[3] - day[1]) / day[1] * 100,
            };
        }
    });

    return Object.values(uniqueDates).sort((a, b) => new Date(b.date) - new Date(a.date));
}

// **FETCH K-LINES FOR SELECTED DATE & INTERVAL**
app.get('/klines', async (req, res) => {
    const { coin, date } = req.query;

    const startTime = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
    const endTime = startTime + 86400;

    console.log(`Fetching K-lines for ${coin} on ${date}...`);
    try {
        const response = await axiosInstance.get(
            `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${endTime}&interval=${timeframe}`
        );

        if (!response.data || !response.data.data) throw new Error("Invalid API response");

        const tradeData = response.data.data.map(kline => ({
            time: new Date(kline[0] * 1000).toISOString().substr(11, 5),
            tradeValue: parseFloat(kline[6]),
            close: parseFloat(kline[4])
        }));

        res.json(tradeData);
    } catch (error) {
        console.error(`Error fetching K-lines for ${coin}:`, error.message);
        res.status(500).send('Error fetching K-lines');
    }
});

// **GENERATE HTML CHART**
async function generateHtmlLog(coin, lifecycleData) {
    const calendarHtml = lifecycleData.map(day => {
        const pumpSign = day.pumpPercent >= 0 ? '+' : '-';
        return `<option value="${day.date}">${day.date} ${pumpSign}${Math.abs(day.pumpPercent).toFixed(2)}%</option>`;
    }).join('');

    const filePath = path.resolve(__dirname, `${coin}_trade_log.html`);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; }
                #chart, #priceChart, #mixedChart { width: 100%; height: 400px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <h2>${coin} Trade Data</h2>
            <label for="daySelect">Select a date:</label>
            <select id="daySelect">${calendarHtml}</select>

            <div id="minMaxValues">Trade Min: -- | Max: --</div>
            <div id="chart"></div>

            <div id="priceMinMax">Price Min: -- | Max: --</div>
            <div id="priceChart"></div>

            <h3>Normalized Trade & Price Comparison</h3>
            <div id="mixedChart"></div>

            <script>
                function normalize(value, min, max) {
                    return max === min ? 100 : ((value - min) / (max - min)) * 100;
                }

                function formatNumber(value) {
                    if (value >= 1e9) return (value / 1e9).toFixed(2) + "B"; 
                    if (value >= 1e6) return (value / 1e6).toFixed(2) + "M"; 
                    if (value >= 1e3) return (value / 1e3).toFixed(2) + "K"; 
                    return value.toFixed(2);
                }

                document.getElementById("daySelect").addEventListener("change", async function() {
                    const selectedDate = this.value;
                    const response = await fetch(\`http://localhost:3000/klines?coin=${coin}&date=\${selectedDate}\`);
                    const klineData = await response.json();

                    const tradeValues = klineData.map(d => d.tradeValue);
                    const priceValues = klineData.map(d => d.close);

                    const minTradeValue = Math.min(...tradeValues);
                    const maxTradeValue = Math.max(...tradeValues);
                    const minPrice = Math.min(...priceValues);
                    const maxPrice = Math.max(...priceValues);

                    document.getElementById("minMaxValues").innerText = \`Trade Min: \${formatNumber(minTradeValue)} | Max: \${formatNumber(maxTradeValue)}\`;
                    document.getElementById("priceMinMax").innerText = \`Price Min: \${formatNumber(minPrice)} | Max: \${formatNumber(maxPrice)}\`;

                    // **Trade Value Chart**
                    Plotly.newPlot("chart", [{ 
                        x: klineData.map(d => d.time), 
                        y: tradeValues, 
                        type: "bar", 
                        marker: { color: "blue" } 
                    }]);

                    // **Price Movement Chart**
                    Plotly.newPlot("priceChart", [{ 
                        x: klineData.map(d => d.time), 
                        y: priceValues, 
                        type: "bar", 
                        marker: { color: "green" } 
                    }], {
                        yaxis: { range: [minPrice * 0.99, maxPrice * 1.01] }
                    });

                    // **Mixed Percentage Chart (Now Third)**
                    Plotly.newPlot("mixedChart", [
                        { 
                            x: klineData.map(d => d.time), 
                            y: klineData.map(d => normalize(d.tradeValue, minTradeValue, maxTradeValue)), 
                            text: klineData.map(d => \`Trade: \${formatNumber(d.tradeValue)} ($) | \${normalize(d.tradeValue, minTradeValue, maxTradeValue).toFixed(2)}%\`),
                            type: "bar", name: "Trade Value (%)", marker: { color: "blue" } 
                        },
                        { 
                            x: klineData.map(d => d.time), 
                            y: klineData.map(d => normalize(d.close, minPrice, maxPrice)), 
                            text: klineData.map(d => \`Price: \${formatNumber(d.close)} ($) | \${normalize(d.close, minPrice, maxPrice).toFixed(2)}%\`),
                            type: "bar", name: "Price (%)", marker: { color: "green" } 
                        }
                    ], {
                        title: "Trade & Price Percentage Comparison",
                        xaxis: { title: "Time" },
                        yaxis: { title: "Percentage (%)", range: [1, 100] },
                        hovermode: "x unified"
                    });
                });
            </script>
        </body>
        </html>
    `;

    fs.writeFileSync(filePath, htmlContent);

    if (!browser) {
        browser = await chromium.launch({
            headless: false,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        });
        page = await browser.newPage();
        await page.goto(`file://${filePath}`);
    } else {
        await page.goto(`file://${filePath}`);
        await page.reload();
    }
}






// **MAIN EXECUTION**
async function main() {
    const klines = await fetchDailyKlines(coin);
    if (!klines) return console.error('Failed to fetch K-lines.');

    const lifecycleData = analyzeLifecycle(klines);
    await generateHtmlLog(coin, lifecycleData);
}

app.listen(3000, async () => {
    console.log('Server running on http://localhost:3000');
    await main();
});
