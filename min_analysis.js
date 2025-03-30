const prompt = require('prompt-sync')();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Axios configuration
const axiosInstance = axios.create({
    proxy: {
        host: '127.0.0.1',
        port: 8082
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

// Get system time
async function getSystemTime() {
    try {
        const response = await axiosInstance.get('https://www.coinex.com/res/system/time');
        return response.data.data.current_timestamp; // Return the current system timestamp
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        return null;
    }
}

// Get coin name from user
async function getCoinName() {
    const coinName = prompt("Enter the coin name: ");
    return coinName.toUpperCase();
}

// Fetch all Klines
async function getKlines(coin, interval, sysTime) {
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=0&end_time=${sysTime}&interval=${interval}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching K-lines data for ${coin}:`, error.message);
        return null;
    }
}

// Extract minimum prices
function extractMinPrices(klines) {
    return klines.map(kline => parseFloat(kline[3])); // Index 3 represents daily low prices
}

async function createAndOpenChart(coin, minPrices) {
    const labels = Array.from({ length: minPrices.length }, (_, i) => i + 1);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
            <style>
                html, body {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    width: 100%;
                    display: flex;
                    flex-direction: column;
                }
                #toolbar {
                    padding: 10px;
                    background-color: #f1f1f1;
                    border-bottom: 1px solid #ccc;
                }
                #chartContainer {
                    flex-grow: 1; /* Make the chart container fill the remaining space */
                    width: 100%; /* Full width */
                    height: 100%; /* Full height */
                }
            </style>
        </head>
        <body>
            <div id="toolbar">
                <label for="minRange">Minimum Price:</label>
                <input type="number" id="minRange" step="0.01">
                <label for="maxRange">Maximum Price:</label>
                <input type="number" id="maxRange" step="0.01">
                <button id="updateButton">Update Chart</button>
                <button id="resetButton">Reset Chart</button>
            </div>
            <div id="chartContainer">
                <div id="minPricesChart"></div>
            </div>
            <script>
                // Initial data
                let originalPrices = ${JSON.stringify(minPrices)};
                let originalLabels = ${JSON.stringify(labels)};
                
                // Create the chart
                function renderChart(labels, prices) {
                    const trace = {
                        x: labels,
                        y: prices,
                        mode: 'lines',
                        line: {
                            color: 'blue',
                            width: 1 // Thin line
                        }
                    };
                    
                    const layout = {
                        xaxis: {
                            title: 'Day',
                            rangeslider: { visible: true }, // Enable range slider
                            fixedrange: false // Allow panning and zooming
                        },
                        yaxis: {
                            title: 'Price',
                            fixedrange: true // Disable vertical zoom/panning
                        },
                        margin: { t: 0, l: 0, r: 0, b: 0 }, // Remove all margins
                        width: window.innerWidth, // Match window width
                        height: window.innerHeight - document.getElementById('toolbar').offsetHeight // Subtract toolbar height
                    };

                    Plotly.newPlot('minPricesChart', [trace], layout, { responsive: true });
                }

                // Render the chart on page load
                renderChart(originalLabels, originalPrices);

                // Re-render the chart on window resize for responsiveness
                window.addEventListener('resize', () => {
                    renderChart(originalLabels, originalPrices);
                });

                // Update chart based on price range
                document.getElementById('updateButton').addEventListener('click', () => {
                    const minRange = parseFloat(document.getElementById('minRange').value);
                    const maxRange = parseFloat(document.getElementById('maxRange').value);

                    if (!isNaN(minRange) && !isNaN(maxRange)) {
                        const filteredPrices = originalPrices.filter(price => price >= minRange && price <= maxRange);
                        const filteredLabels = originalLabels.slice(0, filteredPrices.length);

                        renderChart(filteredLabels, filteredPrices);
                    } else {
                        alert("Please enter valid price ranges.");
                    }
                });

                // Reset chart to the original data
                document.getElementById('resetButton').addEventListener('click', () => {
                    renderChart(originalLabels, originalPrices);
                });
            </script>
        </body>
        </html>
    `;

    const filePath = path.join(__dirname, `${coin}_min_prices_chart.html`);
    fs.writeFileSync(filePath, htmlContent);

    const browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve('C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe') // Reuse Playwright configuration
    });
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);
}



// Main function
async function main() {
    const sysTime = await getSystemTime();
    if (!sysTime) {
        console.error("Failed to retrieve system time. Please try again.");
        return;
    }

    const coin = await getCoinName();
    const interval = 86400; // 1-day interval in seconds
    const klines = await getKlines(coin, interval, sysTime);

    if (!klines) {
        console.error("Failed to retrieve Klines data. Please try again.");
        return;
    }

    const minPrices = extractMinPrices(klines);
    await createAndOpenChart(coin, minPrices);
}

main();
