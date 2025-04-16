const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

// Sensitive credentials
const ACCESS_ID = "DD053DC012674525AEE34A8C5D093C01"; // Replace with your actual Access ID
const SECRET_KEY = "6D968D2DA5629E83B42B6F99362B87F4B5E2077104D6803B"; // Replace with your actual Secret Key

// Axios configuration for main functionality
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Axios configuration for risk calculation
const riskAxiosInstance = axios.create({
    baseURL: 'https://api.coinex.com/',
    headers: {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
        post: {
            'Content-Type': 'application/json',
        },
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    proxy: {
        host: '127.0.0.1',
        port: 8082,
    },
    timeout: 10000,
});

// Authorization signature generator for risk calculation
function createAuthorization(method, requestPath, bodyJson, timestamp) {
    const text = method + requestPath + bodyJson + timestamp + SECRET_KEY;
    return crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
}

// Express.js setup
const app = express();
const port = 3030;

app.use(bodyParser.json()); // Middleware for parsing JSON
app.use(express.static('public'));

// Fetch system time
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

// Fetch all coins from the CoinEx API
async function fetchAllCoins() {
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        return response.data.data.data.map((item) => item.asset);
    } catch (error) {
        console.error('Error fetching coin list:', error.message);
        return [];
    }
}

// Fetch daily K-lines for the last 20 days
async function fetchLast20DaysKlines(coin, sysTime) {
    const interval = 86400; // 1-day interval
    const startTime = sysTime - (20 * interval);
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-lines data for ${coin}:`, error.message);
        return null;
    }
}

// Calculate daily percentage changes and scores
function calculateDailyPercentageChanges(klines) {
    let totalGreenDays = 0;
    let totalRedDays = 0;

    for (let i = 1; i < klines.length; i++) {
        const prevClose = Number(klines[i - 1][4]);
        const currentClose = Number(klines[i][4]);
        const percentChange = ((currentClose - prevClose) / prevClose) * 100;

        if (percentChange >= 0) totalGreenDays++;
        else totalRedDays++;
    }

    const score = totalGreenDays - totalRedDays;
    return score;
}

// Risk calculation function
async function processRiskCalculation(coin, money) {
    const timestamp = Date.now();
    const url = `/v2/spot/deals?market=${coin}USDT`;
    try {
        const res = await riskAxiosInstance.get(url, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": createAuthorization("GET", "/v2/spot/deals", "", timestamp),
                "X-COINEX-TIMESTAMP": timestamp,
            }
        });

        let counter = 0;
        for (const deal of res.data.data) {
            const mon = parseFloat(deal.amount) * parseFloat(deal.price);
            if (mon >= money) counter++;
        }

        return counter < 5 ? 'bad' : 'good';
    } catch (error) {
        console.error(`Error calculating risk for ${coin}:`, error.message);
        return 'error';
    }
}

app.get('/coin_movement_score_report.html', (req, res) => {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Coin Movement Score Report</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                table {
                    width: 80%;
                    border-collapse: collapse;
                    margin: 20px 0;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: center;
                }
                th {
                    background-color: #f4f4f4;
                    font-weight: bold;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                tr:hover {
                    background-color: #f1f1f1;
                }
            </style>
            <script>
                async function calculateRisk(coin) {
                    console.log(\`Triggering risk calculation for: \${coin}\`);
                    try {
                        const response = await fetch('/process-risk', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ coin: coin, money: 250 })
                        });

                        const data = await response.json();
                        const riskCell = document.querySelector(\`#risk-\${coin}\`);
                        riskCell.innerText = data.result || 'Error';
                    } catch (error) {
                        console.error(\`Error calculating risk for \${coin}:\`, error);
                        const riskCell = document.querySelector(\`#risk-\${coin}\`);
                        riskCell.innerText = 'Error';
                    }
                }
            </script>
        </head>
        <body>
            <h1>Coin Movement Score Report</h1>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Coin</th>
                        <th>Score</th>
                        <th>Risk</th>
                    </tr>
                </thead>
                <tbody>
                    ${['BTC', 'ETH'].map((coin, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${coin}</td>
                            <td>5</td>
                            <td id="risk-${coin}">
                                ${riskResults[coin] ? riskResults[coin] : `<button onclick="calculateRisk('${coin}')">Calculate</button>`}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;
    res.send(htmlContent);
});


// In-memory store for calculated risks
const riskResults = {};


// Main Function
async function main() {
    const sysTime = await getSystemTime();
    if (!sysTime) {
        console.error('Failed to retrieve system time. Please try again.');
        return;
    }

    const coins = await fetchAllCoins();
    if (!coins.length) {
        console.error('No coins retrieved. Exiting...');
        return;
    }

    console.log('Fetched coins:', coins); // Log coins for debugging

    const filePath = path.resolve(__dirname, 'coin_movement_score_report.html');
    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });
    const page = await browser.newPage();
    await page.goto(`http://localhost:3030/coin_movement_score_report.html`);
    console.log('HTML report opened in browser.');

    const results = [];
    for (let i = 0; i < coins.length; i++) {
        const coin = coins[i]; // Initialize `coin` properly
        console.log(`Analyzing ${coin}...`);

        // try {
        const klines = await fetchLast20DaysKlines(coin, sysTime);
        if (!klines) {
            console.error(`Failed to fetch data for ${coin}. Skipping...`);
            continue;
        }

        const score = calculateDailyPercentageChanges(klines);
        results.push({ coin, score });

        console.log(`Finished analyzing ${coin}: Score = ${score}`);
        const sortedResults = results.sort((a, b) => b.score - a.score); // Sort by descending score

        await page.evaluate(({ data, riskResults }) => {
            const tableBody = document.querySelector('tbody'); // Find the table body
            tableBody.innerHTML = ''; // Clear current rows
            data.forEach((result, index) => {
                const row = document.createElement('tr');

                // Check if a risk result exists for the coin
                if (riskResults[result.coin]) {
                    row.innerHTML = `
                <td>${index + 1}</td>
                <td>${result.coin}</td>
                <td>${result.score}</td>
                <td id="risk-${result.coin}">
                    ${riskResults[result.coin]} <!-- Display existing result -->
                </td>
            `;
                } else {
                    row.innerHTML = `
                <td>${index + 1}</td>
                <td>${result.coin}</td>
                <td>${result.score}</td>
                <td id="risk-${result.coin}">
                    <button onclick="calculateRisk('${result.coin}')">Calculate</button> <!-- Default button -->
                </td>
            `;
                }
                tableBody.appendChild(row); // Append the new row
            });
        }, { data: sortedResults, riskResults }); // Pass sorted results and riskResults to the browser context

        // Pass `results` and `riskResults` to the browser context

        // } catch (error) {
        //   console.error(`Error analyzing ${coin}:`, error.message);
        // }

        const progress = ((i + 1) / coins.length) * 100;
        console.log(`Progress: ${progress.toFixed(2)}%`);
    }

    console.log('Analysis complete.');
    console.log('Browser will remain open.');
}

// Server-side endpoint for risk calculation
app.post('/process-risk', async (req, res) => {
    const { coin, money } = req.body;
    try {
        const result = await processRiskCalculation(coin, money);
        riskResults[coin] = result; // Store the result for persistence
        res.send({ result });
    } catch (error) {
        console.error('Error in /process-risk:', error.message);
        res.status(500).send({ error: 'Risk calculation failed' });
    }
});


// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    main(); // Start the main function
});
