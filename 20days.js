const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')(); // For user input via prompt

// Axios configuration
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Fetch system time (required for API calls)
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp; // Return the current system timestamp
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

// Fetch daily K-lines for the last 20 days
async function fetchLast20DaysKlines(coin, sysTime) {
    const interval = 86400; // 1-day interval
    const startTime = sysTime - (20 * interval); // Last 20 days
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data; // Return the K-lines for the last 20 days
    } catch (error) {
        console.error(`Error fetching K-lines data for ${coin}:`, error.message);
        return null;
    }
}

// Calculate percentage change and score for each day
function calculateDailyPercentageChanges(klines) {
    const dailyChanges = [];
    let totalGreenDays = 0;
    let totalRedDays = 0;

    for (let i = 1; i < klines.length; i++) {
        const prevClose = Number(klines[i - 1][4]); // Previous day's close
        const currentClose = Number(klines[i][4]); // Current day's close
        const percentChange = ((currentClose - prevClose) / prevClose) * 100;

        const isGreen = percentChange >= 0;
        if (isGreen) {
            totalGreenDays++; // Count green day
        } else {
            totalRedDays++; // Count red day
        }

        dailyChanges.push({
            day: i, // Day index
            percentChange: percentChange.toFixed(2), // Percentage change
            color: isGreen ? 'green' : 'red' // Green for increase, red for decrease
        });
    }

    const score = totalGreenDays - totalRedDays; // Compute the score
    return { dailyChanges, score };
}

// Create and open the chart
async function createAndOpenChart(coin, dailyChanges, score) {
    const labels = dailyChanges.map(change => `Day ${change.day}`);
    const values = dailyChanges.map(change => parseFloat(change.percentChange));
    const colors = dailyChanges.map(change => change.color);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
        </head>
        <body>
            <div id="chart"></div>
            <script>
                const trace = {
                    x: ${JSON.stringify(labels)},
                    y: ${JSON.stringify(values)},
                    type: 'bar',
                    marker: {
                        color: ${JSON.stringify(colors)}
                    }
                };

                const layout = {
                    title: '${coin} - Last 20 Days Percentage Changes (Score: ${score})',
                    xaxis: {
                        title: 'Days'
                    },
                    yaxis: {
                        title: 'Percentage Change (%)'
                    }
                };

                Plotly.newPlot('chart', [trace], layout);
            </script>
        </body>
        </html>
    `;

    const filePath = path.join(__dirname, `${coin}_daily_changes_chart.html`);
    fs.writeFileSync(filePath, htmlContent);

    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Reuse Playwright configuration
    });
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);
}

// Main function
async function main() {
    const sysTime = await getSystemTime();
    if (!sysTime) {
        console.error("Failed to retrieve system time. Please try again.");
        return;
    }

    const coin = prompt("Enter the coin name (e.g., BTC): ").toUpperCase();
    const klines = await fetchLast20DaysKlines(coin, sysTime);

    if (!klines) {
        console.error("Failed to retrieve Klines data. Please try again.");
        return;
    }

    const { dailyChanges, score } = calculateDailyPercentageChanges(klines);
    console.log(`Score for ${coin}: ${score}`);
    await createAndOpenChart(coin, dailyChanges, score);
}

main();
