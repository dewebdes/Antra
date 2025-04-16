const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const player = require('play-sound')({ player: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" }); // VLC path for playing sounds

const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

let browser; // Persistent browser instance
let page;    // Persistent page instance

let refreshCount1m = 0; // Count for 1-minute updates
let refreshCount5m = 0; // Count for 5-minute updates
let lastPrice = null; // Keeps track of the latest price
let klines = [];       // Holds K-line data
let fibLevels = {};    // Holds Fibonacci levels
let minPrice = null;   // Minimum price of the chart
let maxPrice = null;   // Maximum price of the chart
let levelStates = {};  // Tracks the state of each level (safe/dropped)
let skipInitialFeed = true; // Skip sound alerts during the first monitoring round
let isPlayingSound = false; // Prevents overlapping sound plays

// Function to play alert sound when a Fibonacci level drops
async function playAlertSound() {
    console.log('Checking if sound alert should be played...');
    if (isPlayingSound) {
        console.log('Sound is already playing, skipping duplicate trigger.');
        return; // Prevent overlapping sounds
    }

    try {
        isPlayingSound = true; // Set flag to prevent overlapping sounds
        player.play('alert.mp3', (err) => {
            if (err) {
                console.error('Error playing sound with VLC:', err.message);
            } else {
                console.log('Alert sound played successfully!');
            }
        });
    } finally {
        isPlayingSound = false; // Reset flag after sound plays
    }
}

async function getSystemTime() {
    console.log('Fetching system time...');
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        console.log('Successfully fetched system time:', response.data.data.current_timestamp);
        return response.data.data.current_timestamp; // Return the current system timestamp
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

async function getFinalPrice(coin) {
    console.log(`Fetching latest price for ${coin}...`);
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        console.log('API response:', response.data); // Log the entire API response for debugging

        const assetData = response.data.data.data.find((item) => item.asset === coin);
        if (!assetData) {
            console.error(`Coin ${coin} not found in API response.`);
            return null;
        }

        console.log(`Successfully fetched price for ${coin}: ${parseFloat(assetData.price_usd)}`);
        return parseFloat(assetData.price_usd);
    } catch (error) {
        console.error(`Error fetching final price for ${coin}:`, error.message);
        return null;
    }
}

async function fetch5mKlines(coin, sysTime) {
    console.log(`Fetching 5-minute K-line data for ${coin}...`);
    const interval = 300; // 5-minute interval
    const startTime = sysTime - (24 * 60 * 60); // Last 24 hours
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        console.log(`Successfully fetched 5-minute K-line data for ${coin}.`);
        return response.data.data; // Return the K-line data
    } catch (error) {
        console.error(`Error fetching 5-minute K-lines for ${coin}:`, error.message);
        return null;
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

function calculateFibonacciLevels(minPrice, maxPrice) {
    console.log('Calculating Fibonacci levels...');
    const fibLevels = {};
    const diff = maxPrice - minPrice;

    fibLevels['0%'] = maxPrice;
    fibLevels['23.6%'] = maxPrice - diff * 0.236;
    fibLevels['38.2%'] = maxPrice - diff * 0.382;
    fibLevels['50%'] = maxPrice - diff * 0.5;
    fibLevels['61.8%'] = maxPrice - diff * 0.618;
    fibLevels['78.6%'] = maxPrice - diff * 0.786;
    fibLevels['100%'] = minPrice;

    console.log('Fibonacci levels calculated:', fibLevels);
    return fibLevels;
}

async function updateChart({ coin, klines, fibLevels, minPrice, maxPrice, lastPrice }) {
    console.log('Updating chart...');
    const candleData = klines.map((kline, index) => {
        const currentClose = parseFloat(kline[4]);
        const previousClose = index > 0 ? parseFloat(klines[index - 1][4]) : currentClose; // Handle first candle

        return {
            x: new Date(kline[0] * 1000).toISOString().substr(11, 5), // Time in hh:mm format
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: currentClose,
            color: currentClose >= previousClose ? 'green' : 'red', // Dynamic color based on net price change
        };
    });


    const updatedCandlestickData = [
        {
            x: candleData.map(d => d.x),
            close: candleData.map(d => d.close),
            open: candleData.map(d => d.open),
            high: candleData.map(d => d.high),
            low: candleData.map(d => d.low),
            type: 'candlestick',
            name: coin,
            increasing: { line: { color: 'green' } }, // Use green for increasing net price
            decreasing: { line: { color: 'red' } },  // Use red for decreasing net price
        },
        {
            x: candleData.map(d => d.x),
            y: Array(candleData.length).fill(lastPrice),
            type: 'scatter',
            mode: 'lines',
            line: {
                color: 'green',
                width: 3,
                dash: 'solid',
            },
            name: 'Current Price',
        }
    ];


    const updatedFibLines = Object.entries(fibLevels).map(([level, price]) => ({
        type: 'line',
        xref: 'paper',
        x0: 0,
        x1: 1,
        yref: 'y',
        y0: price,
        y1: price,
        line: {
            color: level === '50%' ? 'blue' : 'gray',
            width: level === '50%' ? 2 : 1,
            dash: 'dot',
        },
    }));

    // Keep Fibonacci annotations centered
    const fibAnnotations = Object.entries(fibLevels).map(([level, price]) => ({
        xref: 'paper',
        yref: 'y',
        x: 0.5, // Keep labels in the center horizontally
        y: price,
        text: `${level}: ${price.toFixed(2)}`,
        showarrow: false,
        font: {
            size: 20, // Adjust text size
            color: levelStates[price] === 'dropped' ? 'red' : 'green', // Dynamic color based on state
            family: 'Arial, bold', // Ensures the text is bold
        },
        align: 'center',
    }));

    // Add annotation for the current price outside the chart area
    const currentPriceAnnotation = {
        xref: 'paper',
        yref: 'y',
        x: 1.1, // Position it slightly outside the right edge of the chart
        y: lastPrice,
        text: `${lastPrice.toFixed(2)}`, // Show the current price
        showarrow: false,
        font: {
            size: 18,
            color: 'green',
            family: 'Arial, bold',
        },
        align: 'center',
    };

    const layout = {
        title: `Updated Chart for ${coin}`,
        xaxis: { title: "Time (hh:mm)", type: "category" },
        yaxis: {
            title: "Price (USDT)",
            range: [minPrice, maxPrice],
        },
        margin: { l: 40, r: 60, t: 50, b: 50 }, // Adjust margins for better visibility
        shapes: [...updatedFibLines],
        annotations: [...fibAnnotations, currentPriceAnnotation], // Add Fibonacci and current price annotations
        hovermode: "closest",
    };

    await page.evaluate(({ updatedCandlestickData, layout }) => {
        Plotly.react('chart', updatedCandlestickData, layout);
    }, { updatedCandlestickData, layout });

    // Update refresh counts labels
    const logHtml = `
        <p style="font-size: 16px; font-weight: bold;">Refresh Count for 1-Minute Updates: ${refreshCount1m}</p>
        <p style="font-size: 16px; font-weight: bold;">Refresh Count for 5-Minute Updates: ${refreshCount5m}</p>
    `;
    await page.evaluate(({ logHtml }) => {
        document.getElementById('log').innerHTML = logHtml;
    }, { logHtml });

    console.log('Chart updated successfully.');
}



async function saveChartAndOpenBrowser(coin, klines, fibLevels, minPrice, maxPrice) {
    console.log(`Initializing chart for ${coin}...`);
    try {
        const candleData = klines.map((kline) => ({
            x: new Date(kline[0] * 1000).toISOString().substr(11, 5), // Time in hh:mm format
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
        }));

        const candlestickData = [
            {
                x: candleData.map(d => d.x),
                close: candleData.map(d => d.close),
                open: candleData.map(d => d.open),
                high: candleData.map(d => d.high),
                low: candleData.map(d => d.low),
                type: 'candlestick',
                name: coin,
            },
            {
                x: candleData.map(d => d.x),
                y: Array(candleData.length).fill(lastPrice),
                type: 'scatter',
                mode: 'lines',
                line: {
                    color: 'green',
                    width: 3,
                    dash: 'solid',
                },
                name: 'Current Price',
            }
        ];

        const layout = {
            title: `5-Minute K-line Chart with Fibonacci Levels for ${coin}`,
            xaxis: { title: "Time (hh:mm)", type: "category" },
            yaxis: {
                title: "Price (USDT)",
                range: [minPrice, maxPrice],
            },
            margin: { l: 40, r: 50, t: 50, b: 50 }, // Adjust margins for better visibility
            hovermode: "closest",
        };

        console.log('Chart data prepared. Writing HTML...');
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
                <style>
                    body, html {
                        margin: 0;
                        padding: 0;
                        height: 100%; /* Ensure body and html height */
                    }
                    #chart {
                        height: 90%; /* Maximize chart height */
                    }
                    #log {
                        height: 10%; /* Display refresh counts at the top */
                        text-align: center;
                        font-size: 14px;
                        font-weight: bold;
                        color: black;
                    }
                </style>
            </head>
            <body>
                <div id="log">
                    <p>Refresh Count for 1-Minute Updates: ${refreshCount1m}</p>
                    <p>Refresh Count for 5-Minute Updates: ${refreshCount5m}</p>
                </div>
                <div id="chart"></div>
                <script>
                    const data = ${JSON.stringify(candlestickData)};
                    const layout = ${JSON.stringify(layout)};
                    Plotly.newPlot("chart", data, layout);
                </script>
            </body>
            </html>
        `;

        const filePath = path.resolve(__dirname, `${coin}_5m_kline_chart.html`);
        fs.writeFileSync(filePath, htmlContent);

        console.log('HTML file written successfully.');

        if (!browser) {
            console.log('Launching browser...');
            browser = await chromium.launch({
                headless: false,
                executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe'),
            });
            page = await browser.newPage();
            await page.goto(`file://${filePath}`);
        } else {
            await page.reload(); // Reload the browser page for updates
        }
        console.log('Chart initialized successfully.');
    } catch (error) {
        console.error('Error initializing chart:', error.message);
    }
}

async function monitorPrices(coin) {
    console.log(`Starting price monitoring for ${coin}...`);

    const retryIntervalMs1m = 60000; // 1-minute interval for short-term price updates
    const retryIntervalMs5m = 300000; // 5-minute interval for K-line and Fibonacci updates

    const monitor1m = async () => {
        console.log('Running 1-minute monitoring...');
        try {
            const price = await getFinalPrice(coin);
            if (price === null) {
                console.error('Failed to fetch price in 1-minute monitoring.');
            } else {
                lastPrice = price;
                refreshCount1m++;
                console.log(`1-minute update complete. Last price: ${lastPrice}`);

                // Check Fibonacci levels for dropped status
                for (const [level, fibPrice] of Object.entries(fibLevels)) {
                    if (lastPrice < fibPrice && levelStates[fibPrice] !== 'dropped') {
                        console.log(`Price dropped below ${level}: ${fibPrice}`);
                        levelStates[fibPrice] = 'dropped';

                        // Play sound only if it's not the initial feed
                        if (!skipInitialFeed) {
                            await playAlertSound();
                        }
                    } else if (lastPrice >= fibPrice && levelStates[fibPrice] === 'dropped') {
                        // Reset level to safe if price goes back above
                        console.log(`Price recovered above ${level}: ${fibPrice}`);
                        levelStates[fibPrice] = 'safe';
                    }
                }

                // Update the chart dynamically
                await updateChart({ coin, klines, fibLevels, minPrice, maxPrice, lastPrice });
            }
        } catch (error) {
            console.error('Error during 1-minute monitoring:', error.message);
        } finally {
            skipInitialFeed = false; // Ensure future updates allow sound alerts
            setTimeout(monitor1m, retryIntervalMs1m); // Schedule next 1-minute monitoring
        }
    };



    const monitor5m = async () => {
        console.log('Running 5-minute monitoring...');
        try {
            const sysTime = await getSystemTime();
            klines = await fetch5mKlines(coin, sysTime);
            const priceRange = getMaxAndMinPrices(klines);
            minPrice = priceRange.minPrice;
            maxPrice = priceRange.maxPrice;
            fibLevels = calculateFibonacciLevels(minPrice, maxPrice);

            refreshCount5m++;
            console.log('5-minute update complete. Fibonacci levels and K-line data updated.');
            await updateChart({ coin, klines, fibLevels, minPrice, maxPrice, lastPrice });
        } catch (error) {
            console.error('Error during 5-minute monitoring:', error.message);
        } finally {
            setTimeout(monitor5m, retryIntervalMs5m); // Schedule next 5-minute monitoring
        }
    };

    await monitor1m(); // Start 1-minute monitoring
    await monitor5m(); // Start 5-minute monitoring
}

async function main() {
    const coinInput = prompt('Enter the coin name (e.g., BTC): ');
    const coin = coinInput.trim().toUpperCase() || 'BTC'; // Default to BTC if no input is given

    console.log(`Starting monitoring for ${coin}...`);

    const sysTime = await getSystemTime();
    klines = await fetch5mKlines(coin, sysTime);
    if (!klines) {
        console.error('Unable to fetch K-lines. Exiting...');
        return;
    }

    const priceRange = getMaxAndMinPrices(klines);
    minPrice = priceRange.minPrice;
    maxPrice = priceRange.maxPrice;
    fibLevels = calculateFibonacciLevels(minPrice, maxPrice);

    // Initialize all Fibonacci levels as "safe"
    for (const level in fibLevels) {
        levelStates[fibLevels[level]] = 'safe';
    }

    // Render the initial chart and open the browser
    await saveChartAndOpenBrowser(coin, klines, fibLevels, minPrice, maxPrice);

    // Start the monitoring processes (1-minute and 5-minute intervals)
    await monitorPrices(coin);
}

// Start the program
main().catch((error) => {
    console.error(`Error initializing application: ${error.message}`);
});
