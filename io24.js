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

// Update HTML without closing browser
async function updateHtml(page, coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels, minPrice, maxPrice) {
    refreshCounter++; // Increment refresh counter

    // Dynamically adjust min/max prices based on the current price
    if (currentPrice > maxPrice) maxPrice = currentPrice;
    if (currentPrice < minPrice) minPrice = currentPrice;

    console.log(`Updated Min Price (5m): ${minPrice}, Max Price (5m): ${maxPrice}`);

    // Combine all price points, formatting Fibonacci levels with the current price's floating precision
    const combinedPoints = [
        ...dailyPoints.enterPoints.map(point => ({ ...point, sourceType: 'Daily' })),
        ...fiveMinPoints.enterPoints.map(point => ({ ...point, sourceType: '5m' })),
        ...dailyPoints.exitPoints.map(point => ({ ...point, sourceType: 'Daily' })),
        ...fiveMinPoints.exitPoints.map(point => ({ ...point, sourceType: '5m' })),
        ...fibonacciLevels.map(level => ({
            price: Number(level.price).toFixed(getFloatingPointPrecision(currentPrice)), // FIXED: Use current price precision
            label: level.level, // Fibonacci level (e.g., "0%", "23.6%")
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

    // Filter points to include only those within the min and max range
    const filteredPoints = combinedPoints.filter(point =>
        point.price >= minPrice && point.price <= maxPrice
    );

    // Sort points by price (highest first)
    const sortedPoints = filteredPoints.sort((a, b) => b.price - a.price);

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${coin} Real-Time Analysis</title>
            <style>
                body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; }
                table { width: 80%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
                th { background-color: #f4f4f4; }
                .safe { color: green; font-weight: bold; }
                .drop { color: red; font-weight: bold; }
                .current-price { background-color: gold; font-weight: bold; color: black; }
                .daily { background-color: lightgreen; }
                .five-min { background-color: lightyellow; }
                .fibonacci { background-color: red; color: white; }
                .placeholder { background-color: #f4f4f4; color: gray; font-style: italic; }
            </style>
        </head>
        <body>
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
                    ${sortedPoints.map(point => {
        const rowClass =
            point.sourceType === 'Daily' ? 'daily' :
                point.sourceType === '5m' ? 'five-min' :
                    point.sourceType === 'Fibonacci' ? 'fibonacci' :
                        point.label === 'Current Price' ? 'current-price' : '';

        return `
                        <tr class="${rowClass}">
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
    console.log('Filtering 5m Klines for last 24 hours...');

    // Convert timestamp threshold for the past 24 hours
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Last 24 hours in seconds

    // Filter only the most recent 5m Klines from the last 24 hours
    const filteredKlines = klines.filter(kline => Number(kline[0]) >= oneDayAgo);

    if (filteredKlines.length === 0) {
        console.warn('No valid 5m Klines found for the last 24 hours!');
        return { maxPrice: null, minPrice: null };
    }

    // Determine min and max from filtered data
    const maxPrice = Math.max(...filteredKlines.map(kline => Number(kline[2])));
    const minPrice = Math.min(...filteredKlines.map(kline => Number(kline[3])));

    console.log(`Final 24h Max Price: ${maxPrice}, Min Price: ${minPrice}`);
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

    setInterval(async () => {
        fiveMinKlines = await fetchKlines(coin, 300); // Fetch latest 5-minute Klines
        const fiveMinPoints = calculatePoints(fiveMinKlines, '5m');
        const currentPrice = await getFinalPrice(coin);

        // Get min/max from **only the last 24 hours** of 5m Klines
        let { maxPrice, minPrice } = getMaxAndMinPrices(fiveMinKlines);

        if (currentPrice > maxPrice) maxPrice = currentPrice;
        if (currentPrice < minPrice) minPrice = currentPrice;

        // Recalculate Fibonacci levels using **corrected min/max**
        const fibonacciLevels = calculateFibonacciLevels(minPrice, maxPrice);

        console.log(`Updated 24h Min Price: ${minPrice}, Max Price: ${maxPrice}`);
        console.log('Updated Fibonacci Levels:', fibonacciLevels);

        await updateHtml(page, coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels, minPrice, maxPrice);
    }, 60000); // Refresh every 1 minute


}




main(); // Run the script
