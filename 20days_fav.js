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

// Generate and open HTML table report
async function generateHtmlReport(results) {
    // Sort results by highest score
    const sortedResults = results.sort((a, b) => b.score - a.score);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Coin Movement Score Report</title>
            <style>
                body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; }
                table { width: 80%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
                th { background-color: #f4f4f4; font-weight: bold; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                tr:hover { background-color: #f1f1f1; }
            </style>
        </head>
        <body>
            <h1>Coin Movement Score Report</h1>
            <table>
                <thead>
                    <tr>
                        <th>Coin</th>
                        <th>Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedResults.map(result => `
                        <tr>
                            <td>${result.coin}</td>
                            <td>${result.score}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;

    const filePath = path.resolve(__dirname, 'coin_movement_score_report.html');
    fs.writeFileSync(filePath, htmlContent, 'utf8');
    console.log(`HTML report generated: ${filePath}`);

    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Reuse Playwright configuration
    });
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);
    console.log('HTML report opened in browser.');
}

// Main function
async function main() {
    const sysTime = await getSystemTime();
    if (!sysTime) {
        console.error("Failed to retrieve system time. Please try again.");
        return;
    }

    const coinInput = prompt("Enter a list of coins (comma-separated, e.g., BTC,ETH,LTC): ");
    const coins = coinInput.split(',').map(coin => coin.trim().toUpperCase());
    const results = [];

    for (const coin of coins) {
        console.log(`Analyzing ${coin}...`);

        try {
            const klines = await fetchLast20DaysKlines(coin, sysTime);
            if (!klines) {
                console.error(`Failed to fetch data for ${coin}. Skipping...`);
                continue;
            }

            const { dailyChanges, score } = calculateDailyPercentageChanges(klines);
            results.push({ coin, score });

            console.log(`Finished analyzing ${coin}: Score = ${score}`);
        } catch (error) {
            console.error(`Error analyzing ${coin}:`, error.message);
        }
    }

    console.log('Generating HTML report...');
    await generateHtmlReport(results);
}

main();
