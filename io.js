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

function calculateAverageDistance(prices) {
    if (prices.length < 2) return 0; // Avoid division by zero

    let totalDistance = 0;
    for (let i = 1; i < prices.length; i++) {
        totalDistance += Math.abs(prices[i] - prices[i - 1]); // Absolute difference
    }

    return totalDistance / (prices.length - 1); // Average distance
}

function markLargeDistanceRows(points) {
    const sortedPrices = points.map(point => point.price).sort((a, b) => b - a);
    const avgDistance = calculateAverageDistance(sortedPrices); // Get the average price gap

    return points.map(point => ({
        ...point,
        largeDistance: sortedPrices.some((price, index) => {
            const prevPrice = sortedPrices[index - 1];
            return prevPrice && Math.abs(price - prevPrice) > avgDistance; // Compare with previous price
        })
    }));
}

// Fetch current price
async function getFinalPrice(coin) {
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        const assetData = response.data.data.data.find((item) => item.asset === coin);
        return Number(assetData.price_usd); // Ensure it returns a number
    } catch (error) {
        console.error('Error fetching final price:', error.message);
        return null; // Return null to indicate failure
    }
}

// Fetch Klines (candlestick data)
async function fetchKlines(coin, interval) {
    const sysTime = await getSystemTime();
    const market = `${coin}USDT`;
    const apiUrl = `https://www.coinex.com/res/market/kline?market=${market}&start_time=0&end_time=${sysTime}&interval=${interval}`;
    const maxRetries = 5; // Limit the number of retries to prevent infinite loops
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

// Calculate Enter/Exit points
function calculatePoints(klines, dayLabel) {
    if (!klines) {
        console.error("No data received for Klines. Skipping calculations...");
        return { enterPoints: [], exitPoints: [] }; // Return empty arrays to avoid errors
    }

    const enterPoints = [];
    const exitPoints = [];
    const atrPeriod = 14;
    const closePrices = klines.map((kline) => Number(kline[4])); // Ensure prices are numbers
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

// Calculate Fibonacci levels
function calculateFibonacciLevels(minPrice, maxPrice) {
    const diff = maxPrice - minPrice; // Price range difference

    // Calculate key Fibonacci levels
    const fibLevels = [
        { level: '0%', price: maxPrice },
        { level: '23.6%', price: maxPrice - diff * 0.236 },
        { level: '38.2%', price: maxPrice - diff * 0.382 },
        { level: '50%', price: maxPrice - diff * 0.5 },
        { level: '61.8%', price: maxPrice - diff * 0.618 },
        { level: '78.6%', price: maxPrice - diff * 0.786 },
        { level: '100%', price: minPrice }
    ];

    return fibLevels; // Return the Fibonacci levels as an array
}

const formatPrice = (price) => {
    // Convert price to Number, preserving floating points
    return Number(price);
};

function getFloatingPointPrecision(price) {
    const priceString = price.toString();
    if (priceString.includes('.')) {
        return priceString.split('.')[1].length; // Return the number of digits after the decimal
    }
    return 0; // No decimal places
}

async function updateHtml(page, coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels, minPrice, maxPrice) {
    refreshCounter++; // Increment refresh counter

    // Dynamically adjust min/max prices based on the current price
    if (currentPrice > maxPrice) maxPrice = currentPrice;
    if (currentPrice < minPrice) minPrice = currentPrice;

    console.log(`Updated Min Price (5m): ${minPrice}, Max Price (5m): ${maxPrice}`);

    // Combine all price points
    const combinedPoints = [
        ...dailyPoints.enterPoints.map(point => ({ ...point, sourceType: 'Daily' })),
        ...fiveMinPoints.enterPoints.map(point => ({ ...point, sourceType: '5m' })),
        ...dailyPoints.exitPoints.map(point => ({ ...point, sourceType: 'Daily' })),
        ...fiveMinPoints.exitPoints.map(point => ({ ...point, sourceType: '5m' })),
        ...fibonacciLevels.map(level => ({
            price: Number(level.price).toFixed(getFloatingPointPrecision(currentPrice)),
            label: level.level,
            type: 'Fibonacci',
            day: 'Fibonacci',
            sourceType: 'Fibonacci'
        })),
        {
            price: Number(currentPrice),
            label: 'Current Price',
            type: 'Current',
            day: 'Now',
            sourceType: 'Current'
        }
    ];

    // Filter prices within range
    const filteredPoints = combinedPoints.filter(point => point.price >= minPrice && point.price <= maxPrice);

    // Sort prices (highest first)
    const sortedPoints = filteredPoints.sort((a, b) => b.price - a.price);

    // Calculate large price gaps AFTER 5m prices are loaded
    const avgDistance = calculateAverageDistance(sortedPoints.map(point => point.price));
    const markedPoints = sortedPoints.map((point, index, arr) => {
        const prevPrice = arr[index - 1]?.price;
        const isLargeGap = prevPrice && Math.abs(point.price - prevPrice) > avgDistance;
        return { ...point, largeDistance: isLargeGap };
    });

    // Generate HTML
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${coin} Real-Time Analysis</title>
            <style>
                html { scroll-behavior: smooth; } /* Smooth scrolling */
                body { font-family: Arial, sans-serif; text-align: center; }
                table { width: 80%; border-collapse: collapse; margin: 20px auto; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
                th { background-color: #f4f4f4; }
                .safe { color: green; font-weight: bold; }
                .drop { color: red; font-weight: bold; }
                .current-price { background-color: gold; font-weight: bold; color: black; }
                .daily { background-color: lightgreen; }
                .five-min { background-color: lightyellow; }
                .fibonacci { background-color: red; color: white; }
                .large-gap { background-color: orange; font-weight: bold; } /* Highlights only extreme gaps */
                .toolbar { font-weight: bold; padding: 10px; display: block; text-align: center; background: #f4f4f4; border-bottom: 2px solid #ddd; }
            </style>
        </head>
        <body>
            <a href="#current-price" class="toolbar">🔍 Jump to Current Price</a>
            <h2>Refresh Count: ${refreshCounter}</h2>
            <h3>5-Minute Price Range: ${minPrice} - ${maxPrice}</h3>
            <table>
                <thead>
                    <tr>
                        <th>Price</th>
                        <th>Type</th>
                        <th>Source</th>
                    </tr>
                </thead>
                <tbody>
                    ${markedPoints.map(point => {
        const rowClass =
            point.largeDistance ? 'large-gap' :
                point.sourceType === 'Daily' ? 'daily' :
                    point.sourceType === '5m' ? 'five-min' :
                        point.sourceType === 'Fibonacci' ? 'fibonacci' :
                            point.label === 'Current Price' ? 'current-price' : '';

        return `
                        <tr id="${point.label === 'Current Price' ? 'current-price' : ''}" class="${rowClass}">
                            <td>$${point.price}</td>
                            <td>${point.label}</td>
                            <td>${point.day}</td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;

    try {
        await page.setContent(htmlContent);
    } catch (error) {
        console.error('Error setting page content:', error.message);
    }
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


// Main function for real-time execution
async function main() {
    const coin = prompt("Enter the coin name (e.g., BTC): ").toUpperCase(); // Prompt user for coin name

    // Fetch initial daily Klines for calculating daily entry and exit points
    const dailyKlines = await fetchKlines(coin, 86400); // Fetch daily Klines
    const dailyPoints = calculatePoints(dailyKlines, 'Daily'); // Calculate entry/exit points for daily Klines

    // Fetch initial 5-minute Klines for past 24 hours
    let fiveMinKlines = await fetchKlines(coin, 300); // Fetch initial 5-minute Klines
    let { maxPrice, minPrice } = getMaxAndMinPrices(fiveMinKlines); // Calculate initial min and max prices

    // Calculate initial Fibonacci levels based on 5-minute min and max prices
    let fibonacciLevels = calculateFibonacciLevels(minPrice, maxPrice);

    // Launch browser and create an initial HTML page
    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Fixed path for Chrome
    });

    const page = await browser.newPage(); // Create a new page instance

    // Get the initial current price and render the initial HTML content
    const initialCurrentPrice = await getFinalPrice(coin);
    console.log('Creating initial HTML content...');
    await updateHtml(page, coin, initialCurrentPrice, dailyPoints, { enterPoints: [], exitPoints: [] }, fibonacciLevels, minPrice, maxPrice);

    // Set up periodic updates every 1 minute
    setInterval(async () => {
        try {
            // Fetch updated 5-minute Klines and current price
            fiveMinKlines = await fetchKlines(coin, 300); // Fetch 5-minute Klines for the past 24 hours
            const fiveMinPoints = calculatePoints(fiveMinKlines, '5m'); // Calculate entry/exit points for 5-minute Klines
            const currentPrice = await getFinalPrice(coin); // Get the latest current price

            // Recalculate min and max prices dynamically based on 5-minute Klines and current price
            let { maxPrice: updatedMaxPrice, minPrice: updatedMinPrice } = getMaxAndMinPrices(fiveMinKlines);
            if (currentPrice > updatedMaxPrice) updatedMaxPrice = currentPrice; // Update max if current price is higher
            if (currentPrice < updatedMinPrice) updatedMinPrice = currentPrice; // Update min if current price is lower

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
    }, 60000); // Refresh every 1 minute
}




main(); // Run the script
