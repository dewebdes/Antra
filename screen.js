const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');
const prompt = require('prompt-sync')(); // For user input

// Axios configuration
const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
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

// Fetch all asset prices (one call for all coins)
async function fetchAllPrices() {
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        return response.data.data.data; // Return the full list of assets
    } catch (error) {
        console.error('Error fetching all asset prices.');
        return null;
    }
}

// Extract prices for specific coins from the fetched list
function extractCoinPrices(assets, coins) {
    const livePrices = {};
    for (const coin of coins) {
        const asset = assets.find(item => item.asset === coin);
        if (asset) {
            livePrices[coin] = parseFloat(asset.price_usd); // Ensure it's a number
        } else {
            console.error(`Price for ${coin} not found in the asset list.`);
        }
    }
    return livePrices;
}

// Determine the decimal precision of a number dynamically
function getDecimalPrecision(price) {
    const priceString = price.toString();
    if (priceString.includes('.')) {
        return priceString.split('.')[1].length; // Count decimal places
    }
    return 1; // No decimal points
}

// Fetch 5-minute K-lines for the last 24 hours
async function fetch24hKlines(coin, sysTime) {
    const interval = 300; // 5-minute interval
    const startTime = sysTime - (24 * 60 * 60); // Last 24 hours
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data; // Return the K-lines
    } catch (error) {
        console.error(`Error fetching K-lines for ${coin}:`, error.message);
        return null;
    }
}

// Calculate min, max, total, current, and trend
function calculateMovementData(klines, lastPrice) {
    const minPrice = Math.min(...klines.map(k => Number(k[3]))); // Lowest price from K-lines
    const maxPrice = Math.max(...klines.map(k => Number(k[2]))); // Highest price from K-lines
    const firstOpen = Number(klines[0][1]); // Opening price

    let finalMin = minPrice;
    let finalMax = maxPrice;

    // Update min if last price falls below it
    if (lastPrice < finalMin) {
        finalMin = lastPrice; // Update min
        console.log(`Min updated to ${finalMin} for last price ${lastPrice}.`);
    }

    // Update max if last price exceeds it
    if (lastPrice > finalMax) {
        finalMax = lastPrice; // Update max
        console.log(`Max updated to ${finalMax} for last price ${lastPrice}.`);
    }

    // Percent movement calculations (avoid issues with zero or small values)
    const totalPercent = finalMin > 0 ? ((finalMax - finalMin) / finalMin) * 100 : 0;
    const currentPercent = finalMin > 0 ? ((lastPrice - finalMin) / finalMin) * 100 : 0;

    // Calculate daily trend (unchanging logic)
    const trend = lastPrice > firstOpen ? 'up' : 'down';

    return {
        minPrice: Number(finalMin).toPrecision(getDecimalPrecision(finalMin)),
        maxPrice: Number(finalMax).toPrecision(getDecimalPrecision(finalMax)),
        lastPrice: Number(lastPrice).toPrecision(getDecimalPrecision(lastPrice)), // Include last price explicitly
        totalPercent: Number(totalPercent).toPrecision(4), // Use dynamic precision
        currentPercent: Number(currentPercent).toPrecision(4), // Use dynamic precision
        trend: trend // Static daily trend
    };
}



// Customize the HTML content for the chart
function customizeHtmlForChart(data, refreshCount) {
    const coinNames = data.map(entry => entry.coin);
    const totalPercents = data.map(entry => Number(entry.totalPercent)); // Total percent movement
    const currentPercents = data.map(entry => Number(entry.currentPercent)); // Current percent position
    const colors = data.map(entry => (entry.trend === 'up' ? 'green' : 'red')); // Color based on trend
    const labels = data.map(
        entry =>
            `${entry.coin}:<br>Min: ${entry.minPrice}<br>Max: ${entry.maxPrice}<br>Last: ${entry.lastPrice}<br>Total: ${entry.totalPercent}%<br>Current: ${entry.currentPercent}%<br>Trend: ${entry.trend}`
    );

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
        </head>
        <body>
            <div id="chart"></div>
            <div id="log">Refresh Count: ${refreshCount}</div> <!-- Display the refresh count -->
            <script>
                const data = [
                    // Total movement (bar from min to max)
                    {
                        x: ${JSON.stringify(coinNames)}, // Coin names
                        y: ${JSON.stringify(totalPercents)}, // Total percent movement
                        type: 'bar',
                        marker: {
                            color: ${JSON.stringify(colors.map(c => `rgba(${c === 'green' ? '0,255,0' : '255,0,0'},0.5)`))}, // Semi-transparent green/red
                            opacity: 0.3 // Semi-transparent
                        },
                        name: 'Total Movement',
                        hoverinfo: 'skip'
                    },
                    // Current position (thicker bar from min to current)
                    {
                        x: ${JSON.stringify(coinNames)}, // Coin names
                        y: ${JSON.stringify(currentPercents)}, // Current percent
                        type: 'bar',
                        marker: {
                            color: ${JSON.stringify(colors)}, // Solid green/red for current position
                            opacity: 1.0
                        },
                        name: 'Current Position',
                        text: ${JSON.stringify(labels)}, // Tooltip with all details including last price
                        hoverinfo: 'text'
                    }
                ];

                const layout = {
                    title: '24-Hour Coin Movements (Min, Max, Last, Total, Current, Trend)',
                    xaxis: { title: 'Coins' },
                    yaxis: { title: 'Percent Movement (%)' }
                };

                Plotly.newPlot('chart', data, layout);
            </script>
        </body>
        </html>
    `;
}


// Generate and open the chart
async function generateChart(results, refreshCount) {
    const htmlContent = customizeHtmlForChart(results, refreshCount);
    const outputPath = path.resolve(__dirname, 'coin_24h_movement_chart.html');

    // Save the dynamically generated HTML
    fs.writeFileSync(outputPath, htmlContent);
    console.log(`Chart saved to: ${outputPath}`);

    // Open the chart in the browser (for the first time only)
    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe')
    });
    const page = await browser.newPage();
    await page.goto(`file://${outputPath}`);
    console.log('Chart opened in the browser.');

    return page; // Return the browser page for updates
}

// Refresh the chart dynamically every minute
async function refreshChart(page, coins, results) {
    let refreshCount = 0;

    setInterval(async () => {
        refreshCount++;

        const assets = await fetchAllPrices();
        if (!assets) {
            console.error("Failed to fetch asset prices.");
            return;
        }

        const livePrices = extractCoinPrices(assets, coins);

        const updatedResults = results.map(result => ({
            ...result,
            lastClose: livePrices[result.coin], // Update last price
            ...calculateMovementData(result.klines, livePrices[result.coin]) // Update min, max, totalPercent, and currentPercent
        }));

        const htmlContent = customizeHtmlForChart(updatedResults, refreshCount);
        fs.writeFileSync(path.resolve(__dirname, 'coin_24h_movement_chart.html'), htmlContent);

        await page.reload();
        console.log(`Chart refreshed (${refreshCount} refreshes so far).`);
    }, 60000); // Refresh every minute
}


async function main() {
    const sysTime = await getSystemTime();
    if (!sysTime) {
        console.error("Failed to fetch system time.");
        return;
    }

    const coinInput = prompt("Enter a list of coins (comma-separated, e.g., BTC,ETH,LTC): ");
    const coins = coinInput.split(',').map(coin => coin.trim().toUpperCase());

    const results = [];
    for (const coin of coins) {
        console.log(`Fetching data for ${coin}...`);
        const klines = await fetch24hKlines(coin, sysTime);
        if (!klines) {
            console.error(`Skipping ${coin} due to data fetch issues.`);
            continue;
        }

        const lastClose = Number(klines[klines.length - 1][4]); // Use the last close price from the K-lines
        const movementData = calculateMovementData(klines, lastClose); // Pass the last close price
        results.push({ coin, klines, lastClose, ...movementData });
        console.log(`${coin}: Movement data calculated.`);
    }

    const page = await generateChart(results, 0); // Create the initial chart
    await refreshChart(page, coins, results); // Set up dynamic refreshes for the chart
}

// Call the main function to start the process
main();
