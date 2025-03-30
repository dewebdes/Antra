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

// Function to predict future prices based on detected similar movements
function predictNextPrices(currentPrices, similarPrices, xDaysLater) {
    // Step 1: Calculate percentage movements for current and similar prices
    const currentMovements = [];
    const similarMovements = [];
    for (let i = 1; i < currentPrices.length; i++) {
        const currentChange = ((currentPrices[i] - currentPrices[i - 1]) / currentPrices[i - 1]) * 100;
        const similarChange = ((similarPrices[i] - similarPrices[i - 1]) / similarPrices[i - 1]) * 100;
        currentMovements.push(currentChange);
        similarMovements.push(similarChange);
    }

    // Step 2: Calculate percentage differences between movements
    const movementDifferences = currentMovements.map((movement, i) => movement - similarMovements[i]);

    // Step 3: Calculate average difference
    const averageDifference = movementDifferences.reduce((sum, diff) => sum + diff, 0) / movementDifferences.length;

    // Step 4: Predict future prices using next x movements from similarPrices
    const predictedPrices = [];
    let lastPrice = currentPrices[currentPrices.length - 1]; // Start from the last price in currentPrices
    for (let i = currentPrices.length; i < currentPrices.length + xDaysLater; i++) {
        const similarNextMovement = ((similarPrices[i] - similarPrices[i - 1]) / similarPrices[i - 1]) * 100;
        const adjustedMovement = similarNextMovement + averageDifference; // Adjusted movement
        const predictedPrice = lastPrice * (1 + adjustedMovement / 100); // Apply movement
        predictedPrices.push(parseFloat(predictedPrice.toFixed(2))); // Format to 2 decimals
        lastPrice = predictedPrice; // Update last price for next iteration
    }

    return predictedPrices;
}



// Function to find similar patterns and predict next days' movements
function findSimilarPatternsWithPrediction(recentChanges, historicalChanges, windowSize, weights, xDaysLater, initialThreshold = 10) {
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

    const bestMatch = matches.length > 0 ? matches[0] : similarities.reduce((closest, current) =>
        (closest.score < current.score ? closest : current), { score: Infinity });

    // Extract `x` days later movements for prediction
    const predictedMovements = historicalChanges.price.slice(bestMatch.startIndex + windowSize, bestMatch.startIndex + windowSize + xDaysLater);

    return { bestMatch, predictedMovements };
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
async function createHTMLChartWithChartJS(currentPrices, similarPrices, predictedPrices, coin) {
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${coin} Price Charts</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                canvas {
                    max-width: 90%;
                    height: 300px;
                    margin: 20px 0;
                }
            </style>
        </head>
        <body>
            <h1>${coin} Price Analysis</h1>
            <canvas id="currentChart"></canvas>
            <canvas id="similarChart"></canvas>
            <canvas id="predictedChart"></canvas>

            <script>
                const currentPrices = ${JSON.stringify(currentPrices)};
                const similarPrices = ${JSON.stringify(similarPrices)};
                const predictedPrices = ${JSON.stringify(predictedPrices)};

                const labelsCurrent = Array.from({ length: currentPrices.length }, (_, i) => \`Day \${i + 1}\`);
                const labelsPredicted = Array.from({ length: predictedPrices.length }, (_, i) => \`Day \${i + 1}\`);

                // Current Prices Chart
                const currentChartCtx = document.getElementById('currentChart').getContext('2d');
                new Chart(currentChartCtx, {
                    type: 'line',
                    data: {
                        labels: labelsCurrent,
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
                        plugins: {
                            legend: { display: true }
                        },
                        scales: {
                            x: { title: { display: true, text: 'Days' } },
                            y: { title: { display: true, text: 'Prices (USD)' } }
                        }
                    }
                });

                // Similar Prices Chart
                const similarChartCtx = document.getElementById('similarChart').getContext('2d');
                new Chart(similarChartCtx, {
                    type: 'line',
                    data: {
                        labels: labelsCurrent,
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
                        plugins: {
                            legend: { display: true }
                        },
                        scales: {
                            x: { title: { display: true, text: 'Days' } },
                            y: { title: { display: true, text: 'Prices (USD)' } }
                        }
                    }
                });

                // Predicted Prices Chart
                const predictedChartCtx = document.getElementById('predictedChart').getContext('2d');
                new Chart(predictedChartCtx, {
                    type: 'line',
                    data: {
                        labels: labelsPredicted,
                        datasets: [{
                            label: 'Predicted Prices',
                            data: predictedPrices,
                            borderColor: 'red',
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                            borderWidth: 2,
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { display: true }
                        },
                        scales: {
                            x: { title: { display: true, text: 'Days Ahead' } },
                            y: { title: { display: true, text: 'Predicted Prices (USD)' } }
                        }
                    }
                });
            </script>
        </body>
        </html>
    `;

    const filePath = path.join(__dirname, `${coin}_charts.html`);
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
    const xDaysLater = parseInt(prompt("Enter the number of days to predict ahead: "), 10);
    const effectiveDayCount = Math.min(dayCount, klines.length);
    const currentPrices = klines.slice(-effectiveDayCount).map(kline => kline[4]);
    const similarPrices = klines.slice(0, effectiveDayCount + xDaysLater).map(kline => kline[4]);

    const { bestMatch } = findSimilarPatternsWithPrediction(
        {
            price: currentPrices.slice(-effectiveDayCount),
            volume: klines.slice(-effectiveDayCount).map(kline => kline[5]),
        },
        {
            price: klines.map(kline => kline[4]),
            volume: klines.map(kline => kline[5]),
        },
        effectiveDayCount,
        { price: 0.6, volume: 0.4 },
        xDaysLater
    );

    console.log("Best Match:", bestMatch);

    const similarPricesSegment = klines.slice(bestMatch.startIndex, bestMatch.startIndex + effectiveDayCount).map(kline => kline[4]);
    const currentLastPrice = currentPrices[currentPrices.length - 1];

    // Step: Predict the next x days' prices
    const predictedPrices = predictNextPrices(currentPrices, similarPrices, xDaysLater);

    // Log the start date of the similar pattern
    const startTimestamp = klines[bestMatch.startIndex][0]; // Get timestamp from the matching pattern
    const startDate = new Date(startTimestamp * 1000); // Convert to a readable date
    const startDayInWords = startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    console.log(`Start Date of Similar Pattern: ${startDayInWords}`); // Added this log

    // Generate the charts
    await createHTMLChartWithChartJS(
        currentPrices,
        similarPricesSegment,
        predictedPrices,
        coin
    );
}


main();
