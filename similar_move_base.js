const prompt = require('prompt-sync')();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Axios configuration for API requests
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Function to calculate percentage changes
function calculatePercentageChanges(data) {
    const percentageChanges = [];
    for (let i = 1; i < data.length; i++) {
        const prevClose = data[i - 1][4]; // Previous day's closing price
        const currentClose = data[i][4]; // Current day's closing price
        const change = ((currentClose - prevClose) / prevClose) * 100;
        percentageChanges.push(parseFloat(change.toFixed(2))); // Format to 2 decimal places
    }
    return percentageChanges;
}

// Function to find continuous days with similar pump/dump patterns
function findSimilarContinuousPatterns(recentChanges, historicalChanges, windowSize) {
    const similarities = [];
    for (let i = 0; i <= historicalChanges.length - windowSize; i++) {
        const segment = historicalChanges.slice(i, i + windowSize);
        const distance = Math.sqrt(
            segment.reduce((sum, value, index) =>
                sum + Math.pow(value - recentChanges[index], 2), 0)
        );
        similarities.push({ startIndex: i, distance });
    }

    // Sort by similarity score and filter by a threshold
    similarities.sort((a, b) => a.distance - b.distance);
    return similarities.filter(similarity => similarity.distance < 10); // Threshold for similarity
}

// Function to create the HTML chart using Chart.js
async function createHTMLChartWithChartJS(currentPrices, similarPrices, coin) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    flex-direction: column; /* Stack charts vertically */
                }
                canvas {
                    width: 100%; /* Full width for each chart */
                    height: 400px; /* Fixed height */
                }
            </style>
        </head>
        <body>
            <div>
                <canvas id="currentChart"></canvas>
            </div>
            <div>
                <canvas id="similarChart"></canvas>
            </div>
            <script>
                const currentPrices = ${JSON.stringify(currentPrices)}; // Dynamically inject prices
                const similarPrices = ${JSON.stringify(similarPrices)}; // Dynamically inject prices
                const xLabels = Array.from({ length: currentPrices.length }, (_, i) => i + 1);

                // Current Movement Chart
                const currentCtx = document.getElementById('currentChart').getContext('2d');
                new Chart(currentCtx, {
                    type: 'line',
                    data: {
                        labels: xLabels, // Sequential numbers for x-axis
                        datasets: [{
                            label: 'Current Prices',
                            data: currentPrices, // Closing prices for y-axis
                            borderColor: 'blue',
                            backgroundColor: 'rgba(0, 0, 255, 0.1)',
                            borderWidth: 2,
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return 'Price: ' + context.raw;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: 'Day (X-Axis)'
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Closing Prices (Y-Axis)'
                                },
                                beginAtZero: false
                            }
                        }
                    }
                });

                // Similar Movement Chart
                const similarCtx = document.getElementById('similarChart').getContext('2d');
                new Chart(similarCtx, {
                    type: 'line',
                    data: {
                        labels: xLabels, // Sequential numbers for x-axis
                        datasets: [{
                            label: 'Similar Prices',
                            data: similarPrices, // Closing prices for y-axis
                            borderColor: 'green',
                            backgroundColor: 'rgba(0, 255, 0, 0.1)',
                            borderWidth: 2,
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return 'Price: ' + context.raw;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: 'Day (X-Axis)'
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Closing Prices (Y-Axis)'
                                },
                                beginAtZero: false
                            }
                        }
                    }
                });
            </script>
        </body>
        </html>
    `;

    const filePath = path.join(__dirname, `${coin}_movement_comparison.html`);
    fs.writeFileSync(filePath, htmlContent);

    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Playwright configuration
    });
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);
}

// Function to fetch the system time from CoinEx API
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error("Error fetching system time:", error.message);
    }
}

// Function to fetch daily Klines for a specified coin
async function fetchDailyKlines(coin, sysTime) {
    const market = `${coin}USDT`;
    const apiUrl = `https://www.coinex.com/res/market/kline?market=${market}&start_time=0&end_time=${sysTime}&interval=86400`;
    try {
        const response = await axiosInstance.get(apiUrl);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching daily K-lines for ${coin}:`, error.message);
        return null;
    }
}

// Main function to run the program
async function main() {
    const coin = prompt("Enter the coin name (e.g., BTC): ").toUpperCase();
    const sysTime = await getSystemTime();
    if (!sysTime) return;

    const klines = await fetchDailyKlines(coin, sysTime);
    if (!klines || klines.length === 0) {
        console.error("No Klines data available for the coin.");
        return;
    }

    const dayCount = parseInt(prompt("Enter the number of days for comparison: "), 10);
    const effectiveDayCount = Math.min(dayCount, klines.length); // Adjust day count based on available data

    const percentageChanges = calculatePercentageChanges(klines);

    const recentChanges = percentageChanges.slice(-effectiveDayCount);
    const recentPrices = klines.slice(-effectiveDayCount).map(kline => kline[4]); // Closing prices for recent days

    const similarPatterns = findSimilarContinuousPatterns(recentChanges, percentageChanges, effectiveDayCount);

    console.log("Similar Continuous Patterns:", similarPatterns); // Debugging log

    // Use the top match for visualization
    const bestMatch = similarPatterns[0];
    const similarPrices = klines.slice(bestMatch.startIndex, bestMatch.startIndex + effectiveDayCount).map(kline => kline[4]);

    await createHTMLChartWithChartJS(recentPrices, similarPrices, coin);
}

main();
