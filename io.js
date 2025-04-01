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
    const fibLevels = [];
    const diff = maxPrice - minPrice;

    // Add all key Fibonacci levels
    fibLevels.push({ level: '0%', price: maxPrice });
    fibLevels.push({ level: '23.6%', price: maxPrice - diff * 0.236 });
    fibLevels.push({ level: '38.2%', price: maxPrice - diff * 0.382 });
    fibLevels.push({ level: '50%', price: maxPrice - diff * 0.5 });
    fibLevels.push({ level: '61.8%', price: maxPrice - diff * 0.618 });
    fibLevels.push({ level: '78.6%', price: maxPrice - diff * 0.786 });
    fibLevels.push({ level: '100%', price: minPrice });

    // Ensure each level is correctly labeled and type-marked for table display
    return fibLevels.map((level) => ({
        price: Number(level.price),
        label: level.level,
        type: 'Fibonacci', // Mark as Fibonacci in "Type" column
        day: 'Daily' // Always based on today's daily high/low
    }));
}

// Update HTML without closing browser
async function updateHtml(coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels) {
    refreshCounter++; // Increment refresh counter

    // Combine all price points (including Fibonacci levels)
    const combinedPoints = [
        ...dailyPoints.enterPoints,
        ...dailyPoints.exitPoints,
        ...fiveMinPoints.enterPoints,
        ...fiveMinPoints.exitPoints,
        ...fibonacciLevels // Include refined Fibonacci levels
    ];

    // Make the price list distinct by filtering out duplicates
    const uniquePoints = combinedPoints.filter(
        (point, index, self) => self.findIndex(p => p.price === point.price) === index
    );

    // Add the current price as a special point
    uniquePoints.push({
        price: currentPrice,
        label: 'Current Price', // Indicate this is the current price
        type: 'Current', // Special type
        day: 'Now' // Special day label
    });

    // Filter points to include only within ±3% above and ±5% below the current price
    const filteredPoints = uniquePoints.filter((point) =>
        Number(point.price) <= currentPrice * 1.03 && Number(point.price) >= currentPrice * 0.95
    );

    // Reverse sort points by price (highest first)
    const sortedPoints = filteredPoints.sort((a, b) => b.price - a.price);

    // Limit to 5 prices above the current price
    const aboveCurrent = sortedPoints.filter(point => point.price > currentPrice).slice(0, 5);

    // Limit to 10 prices below the current price (ensure 10 items are displayed at all times)
    let belowCurrent = sortedPoints.filter(point => point.price <= currentPrice).slice(0, 10);
    if (belowCurrent.length < 10) {
        // Add placeholders if fewer than 10 items are available
        const missingItems = 10 - belowCurrent.length;
        for (let i = 0; i < missingItems; i++) {
            belowCurrent.push({
                price: '-',
                label: 'No Data', // Indicate placeholder
                type: 'Placeholder', // Special type for missing data
                day: '-' // Empty source
            });
        }
    }

    const limitedPoints = [...aboveCurrent, ...belowCurrent];

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
                .enter { background-color: lightblue; }
                .exit { background-color: orange; }
                .past-days { background-color: lightgray; }
                .current-price { background-color: gold; font-weight: bold; color: black; }
                .placeholder { background-color: #f4f4f4; color: gray; font-style: italic; }
            </style>
        </head>
        <body>
            <h2>Refresh Count: ${refreshCounter}</h2>
            <table>
                <thead>
                    <tr>
                        <th>Price</th>
                        <th>Type</th>
                        <th>Source</th>
                    </tr>
                </thead>
                <tbody>
                    ${limitedPoints
            .map((point) => {
                const rowClass = point.label === 'Current Price'
                    ? 'current-price' // Highlight current price row
                    : point.type === 'Placeholder'
                        ? 'placeholder' // Highlight placeholders
                        : point.day === 'Daily' || point.day === '5m'
                            ? 'past-days' // Highlight past 3 days' points
                            : ''; // Default for others
                const typeClass = point.label === 'Enter' ? 'enter' : point.label === 'Exit' ? 'exit' : ''; // Type-specific styling
                return `
                                <tr class="${rowClass}">
                                    <td>$${point.price}</td> <!-- Removed .toFixed(2) -->
                                    <td class="${typeClass}">${point.label}</td> <!-- Merged column for Type -->
                                    <td>${point.day}</td> <!-- Source: Daily/5m/Fibonacci/Now -->
                                </tr>
                            `;
            })
            .join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;

    await page.setContent(htmlContent); // Update content in the existing browser window
}





// Main function for real-time execution
async function main() {
    const coin = prompt("Enter the coin name (e.g., BTC): ").toUpperCase();
    const dailyKlines = await fetchKlines(coin, 86400); // Fetch daily Klines
    const dailyPoints = calculatePoints(dailyKlines, 'Daily'); // Label daily points source

    const dailyHigh = Math.max(...dailyKlines.map((kline) => Number(kline[2]))); // Highest price
    const dailyLow = Math.min(...dailyKlines.map((kline) => Number(kline[3]))); // Lowest price
    const fibonacciLevels = calculateFibonacciLevels(dailyLow, dailyHigh);

    browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Fixed path
    });
    page = await browser.newPage();

    setInterval(async () => {
        const fiveMinKlines = await fetchKlines(coin, 300); // Fetch 5-minute Klines
        const fiveMinPoints = calculatePoints(fiveMinKlines, '5m'); // Label 5-minute points source
        const currentPrice = await getFinalPrice(coin);

        console.log(`New Entry Points: ${fiveMinPoints.enterPoints.length}`);
        console.log(`New Exit Points: ${fiveMinPoints.exitPoints.length}`);
        console.log(`Fibonacci Levels: ${fibonacciLevels.length}`);

        await updateHtml(coin, currentPrice, dailyPoints, fiveMinPoints, fibonacciLevels); // Update HTML
    }, 60000); // Refresh every minute
}

main(); // Run the script
