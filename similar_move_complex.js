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

// Function to calculate Euclidean distance
function calculateDistance(array1, array2) {
    return Math.sqrt(
        array1.reduce((sum, value, index) => sum + Math.pow(value - array2[index], 2), 0)
    );
}

// Function to find similar patterns dynamically
function findSimilarPatterns(recentChanges, historicalChanges, windowSize, weights, initialThreshold = 10) {
    const similarities = [];
    let threshold = initialThreshold;

    // Calculate all similarity scores
    for (let i = 0; i <= historicalChanges.price.length - windowSize; i++) {
        const segment = {
            price: historicalChanges.price.slice(i, i + windowSize),
            volume: historicalChanges.volume.slice(i, i + windowSize),
        };

        const priceScore = calculateDistance(segment.price, recentChanges.price) * weights.price;
        const volumeScore = calculateDistance(segment.volume, recentChanges.volume) * weights.volume;

        const combinedScore = priceScore + volumeScore;
        similarities.push({ startIndex: i, score: combinedScore });
    }

    // Iteratively relax threshold if no matches are found
    let matches = similarities.filter(similarity => similarity.score < threshold);
    while (matches.length === 0 && threshold < 100) { // Threshold cap to prevent infinite loop
        threshold += 10; // Relax threshold
        matches = similarities.filter(similarity => similarity.score < threshold);
    }

    return matches.length > 0 ? matches : [similarities.reduce((closest, current) =>
        (closest.score < current.score ? closest : current), { score: Infinity })];
}

// Function to calculate moving averages
function calculateMovingAverage(data, period) {
    return data.map((_, index) => {
        if (index < period - 1) return null; // Not enough data points
        const slice = data.slice(index - period + 1, index + 1);
        return slice.reduce((sum, value) => sum + value, 0) / period;
    });
}

// Function to fetch system time from CoinEx API
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error("Error fetching system time:", error.message);
        return null;
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
                const currentPrices = ${JSON.stringify(currentPrices)};
                const similarPrices = ${JSON.stringify(similarPrices)};
                const xLabels = Array.from({ length: currentPrices.length }, (_, i) => i + 1);

                // Current Movement Chart
                const currentCtx = document.getElementById('currentChart').getContext('2d');
                new Chart(currentCtx, {
                    type: 'line',
                    data: {
                        labels: xLabels,
                        datasets: [{
                            label: 'Current Prices',
                            data: currentPrices,
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
                        labels: xLabels,
                        datasets: [{
                            label: 'Similar Prices',
                            data: similarPrices,
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
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);
}

// Main function to execute the program
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
    const effectiveDayCount = Math.min(dayCount, klines.length); // Adjust day count
    const percentageChanges = calculatePercentageChanges(klines);
    const volumes = klines.map(kline => kline[5]); // Extract volume data

    const recentData = {
        price: percentageChanges.slice(-effectiveDayCount),
        volume: volumes.slice(-effectiveDayCount),
    };

    const historicalData = {
        price: percentageChanges,
        volume: volumes,
    };

    const weights = { price: 0.6, volume: 0.4 }; // Dynamic weights for scoring
    let similarPatterns = findSimilarPatterns(recentData, historicalData, effectiveDayCount, weights);

    // Ensure fallback result
    if (similarPatterns.length === 0) {
        console.log("No similar patterns found within strict conditions. Returning closest match.");
        similarPatterns = [findSimilarPatterns(recentData, historicalData, effectiveDayCount, weights, Infinity)[0]];
    }

    console.log("Similar Patterns:", similarPatterns);

    const bestMatch = similarPatterns[0];
    const similarPrices = klines.slice(bestMatch.startIndex, bestMatch.startIndex + effectiveDayCount).map(kline => kline[4]);

    await createHTMLChartWithChartJS(
        klines.slice(-effectiveDayCount).map(kline => kline[4]),
        similarPrices,
        coin
    );
}

main();
