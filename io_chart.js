const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')();

let refreshCounter = 0; // Counter to track the number of refreshes
let browser; // Keep browser instance
let page; // Keep page instance

// Axios instance with proxy configuration
const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Utility function to fetch system time
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error("Error fetching system time:", error.message);
        return null;
    }
}

// Calculate Average Price Distance for Market Movement Analysis
function calculateAverageDistance(prices) {
    if (prices.length < 2) return 0; // Avoid division by zero

    let totalDistance = 0;
    for (let i = 1; i < prices.length; i++) {
        totalDistance += Math.abs(prices[i] - prices[i - 1]); // Absolute difference
    }

    return totalDistance / (prices.length - 1); // Average distance
}

// Highlight Large Price Gaps for Market Trends
function markLargeDistanceRows(points) {
    const sortedPrices = points.map(point => point.price).sort((a, b) => b - a);
    const avgDistance = calculateAverageDistance(sortedPrices);

    return points.map(point => ({
        ...point,
        largeDistance: sortedPrices.some((price, index) => {
            const prevPrice = sortedPrices[index - 1];
            return prevPrice && Math.abs(price - prevPrice) > avgDistance;
        })
    }));
}

// Fetch Latest Market Price for a Given Coin
async function getFinalPrice(coin) {
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        const assetData = response.data.data.data.find((item) => item.asset === coin);
        return Number(assetData.price_usd); // Ensure it returns a number
    } catch (error) {
        console.error('Error fetching final price:', error.message);
        return null;
    }
}

// Fetch Klines (Candlestick Data) for Market Analysis
async function fetchKlines(coin, interval) {
    const sysTime = await getSystemTime();
    const market = `${coin}USDT`;
    const apiUrl = `https://www.coinex.com/res/market/kline?market=${market}&start_time=0&end_time=${sysTime}&interval=${interval}`;
    const maxRetries = 5;
    let attempts = 0;

    while (attempts < maxRetries) {
        try {
            const response = await axiosInstance.get(apiUrl);
            return response.data.data; // Return fetched data if successful
        } catch (error) {
            console.error(`Error fetching ${interval} Klines for ${coin}:`, error.message);
            attempts++;

            if (attempts < maxRetries) {
                console.log(`Retrying in 1 minute... (Attempt ${attempts}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute
            } else {
                console.error(`Max retry attempts reached for ${interval} Klines of ${coin}`);
                return null; // Return null if all retries fail
            }
        }
    }
}

// Detect Entry & Exit Points Based on ATR (Volatility)
function calculatePoints(klines, dayLabel) {
    if (!klines) {
        console.error("No data received for Klines. Skipping calculations...");
        return { enterPoints: [], exitPoints: [] };
    }

    const enterPoints = [];
    const exitPoints = [];
    const atrPeriod = 14;
    const closePrices = klines.map((kline) => Number(kline[4]));
    const highPrices = klines.map((kline) => Number(kline[2]));
    const lowPrices = klines.map((kline) => Number(kline[3]));

    const trueRanges = highPrices.map((high, i) => {
        const low = lowPrices[i];
        const prevClose = closePrices[i - 1] || closePrices[0];
        return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    });

    const atr = trueRanges.slice(-atrPeriod).reduce((sum, tr) => sum + tr, 0) / atrPeriod;

    closePrices.forEach((price, index) => {
        if (price < closePrices[index - 1] - atr * 2) {
            enterPoints.push({ index, price: Number(price), label: 'Enter', type: 'safe', day: dayLabel });
        } else if (price > closePrices[index - 1] + atr * 2) {
            exitPoints.push({ index, price: Number(price), label: 'Exit', type: 'drop', day: dayLabel });
        }
    });

    return { enterPoints, exitPoints };
}

// Calculate Fibonacci Levels for Market Trends
function calculateFibonacciLevels(minPrice, maxPrice) {
    const diff = maxPrice - minPrice;

    return [
        { level: '0%', price: maxPrice },
        { level: '23.6%', price: maxPrice - diff * 0.236 },
        { level: '38.2%', price: maxPrice - diff * 0.382 },
        { level: '50%', price: maxPrice - diff * 0.5 },
        { level: '61.8%', price: maxPrice - diff * 0.618 },
        { level: '78.6%', price: maxPrice - diff * 0.786 },
        { level: '100%', price: minPrice }
    ];
}

// Format Prices & Precision Handling
const formatPrice = (price) => Number(price);
function getFloatingPointPrecision(price) {
    return price.toString().includes('.') ? price.toString().split('.')[1].length : 0;
}
async function updateHtml(page, coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels, minPrice, maxPrice) {
    refreshCounter++;

    // Ensure min/max prices are dynamically adjusted
    maxPrice = Math.max(maxPrice, currentPrice);
    minPrice = Math.min(minPrice, currentPrice);

    console.log(`Updated Min Price (5m): ${minPrice}, Max Price (5m): ${maxPrice}`);

    // Prepare price tracking dataset
    const timeLabels = fiveMinPoints.enterPoints.map((point, index) => `T${index}`);
    const priceValues = fiveMinPoints.enterPoints.map(point => point.price);

    // Include current price as a separate tracked point
    const currentPriceLabel = `Latest Price`;
    timeLabels.push(currentPriceLabel);
    priceValues.push(currentPrice);

    // Generate HTML with updated **chart**
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>${coin} Real-Time Price Chart</title>
        <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
        <style>
            body { font-family: Arial, sans-serif; text-align: center; }
            #chart { width: 90%; max-width: 900px; margin: auto; }
        </style>
    </head>
    <body>
        <h2>${coin} Live Price Chart</h2>
        <h3>Refresh Count: ${refreshCounter}</h3>
        <div id="chart"></div>
        <script>
            (function updateChart() {
                let timeLabels = ${JSON.stringify(timeLabels)};
                let priceValues = ${JSON.stringify(priceValues)};

                let trace1 = {
                    x: timeLabels,
                    y: priceValues,
                    mode: 'lines+markers',
                    name: 'Market Prices',
                    marker: { color: 'blue' }
                };

                let trace2 = {
                    x: [timeLabels[timeLabels.length - 1]],
                    y: [priceValues[priceValues.length - 1]],
                    mode: 'markers',
                    name: 'Current Price',
                    marker: { size: 12, color: 'gold' }
                };

                Plotly.react('chart', [trace1, trace2], { 
                    title: 'Live Price Overview',
                    xaxis: { title: 'Time' },
                    yaxis: { title: 'Price' }
                });
            })();
        </script>
    </body>
    </html>`;

    try {
        await page.setContent(htmlContent);
    } catch (error) {
        console.error('Error setting page content:', error.message);
    }
}

async function main() {
    const coin = prompt("Enter the coin name (e.g., BTC): ").toUpperCase(); // Prompt user for coin name

    // Fetch initial daily Klines for calculating daily entry & exit points
    const dailyKlines = await fetchKlines(coin, 86400); // Fetch daily Klines
    const dailyPoints = calculatePoints(dailyKlines, 'Daily'); // Calculate entry/exit points for daily Klines

    // Fetch initial 5-minute Klines for past 24 hours
    let fiveMinKlines = await fetchKlines(coin, 300); // Fetch initial 5-minute Klines
    let { maxPrice, minPrice } = getMaxAndMinPrices(fiveMinKlines); // Calculate initial min/max prices

    // Calculate initial Fibonacci levels
    let fibonacciLevels = calculateFibonacciLevels(minPrice, maxPrice);

    // Launch browser and create the initial HTML page
    browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Fixed path for Chrome
    });

    page = await browser.newPage(); // Create a new page instance

    // Get the initial current price and render the first HTML content
    const initialCurrentPrice = await getFinalPrice(coin);
    console.log('Creating initial HTML content...');
    await updateHtml(page, coin, initialCurrentPrice, dailyPoints, { enterPoints: [], exitPoints: [] }, fibonacciLevels, minPrice, maxPrice);

    // Set up periodic updates every 1 minute
    setInterval(async () => {
        try {
            // Fetch updated 5-minute Klines and latest price
            fiveMinKlines = await fetchKlines(coin, 300); // Fetch 5-minute Klines
            const fiveMinPoints = calculatePoints(fiveMinKlines, '5m'); // Calculate entry/exit points
            const currentPrice = await getFinalPrice(coin); // Get latest price

            // Recalculate min/max prices dynamically based on 5-minute Klines
            let { maxPrice: updatedMaxPrice, minPrice: updatedMinPrice } = getMaxAndMinPrices(fiveMinKlines);
            updatedMaxPrice = Math.max(updatedMaxPrice, currentPrice);
            updatedMinPrice = Math.min(updatedMinPrice, currentPrice);

            // Recalculate Fibonacci levels dynamically
            fibonacciLevels = calculateFibonacciLevels(updatedMinPrice, updatedMaxPrice);

            // Debugging logs
            console.log(`Updated Min Price: ${updatedMinPrice}, Max Price: ${updatedMaxPrice}`);
            console.log('Updated Fibonacci Levels:', fibonacciLevels);

            // Update the HTML content with refreshed data
            await updateHtml(page, coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels, updatedMinPrice, updatedMaxPrice);
        } catch (error) {
            console.error('Error during periodic updates:', error.message);
        }
    }, 60000); // Refresh every minute
}


function getMaxAndMinPrices(klines) {
    console.log('Calculating max and min prices...');
    let maxPrice = -Infinity;
    let minPrice = Infinity;

    klines.forEach(kline => {
        const high = parseFloat(kline[2]); // High price
        const low = parseFloat(kline[3]);  // Low price

        if (high > maxPrice) maxPrice = high;
        if (low < minPrice) minPrice = low;
    });

    console.log(`Max price: ${maxPrice}, Min price: ${minPrice}`);
    return { maxPrice, minPrice };
}

main(); // Run the script
