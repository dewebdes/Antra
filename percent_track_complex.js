const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

// Function to format date with month names
const formatDateWithMonthName = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
};

// Step 1: Get the coin name from the user
async function getCoinName() {
    const coinName = prompt('Enter the coin name (e.g., BTC): ').trim();
    if (!coinName) {
        console.error('Error: No coin name entered. Please provide a valid coin name.');
        process.exit(1);
    }
    return coinName.toUpperCase();
}

// Step 2: Fetch the server system time
async function getSystemTime() {
    console.log('Fetching server system time...');
    try {
        const response = await axios.get('https://www.coinex.com/res/system/time');
        console.log('Successfully fetched server system time:', response.data.data.current_timestamp);
        return response.data.data.current_timestamp;
    } catch (error) {
        console.error('Error fetching system time:', error.message);
        process.exit(1);
    }
}

// Step 3: Fetch daily K-line data for the specified coin
async function fetchDailyKlines(coin, sysTime) {
    console.log(`Fetching daily K-line data for ${coin}...`);
    const startTime = 1000000000; // Adjusted start time as per request
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=86400`; // Daily interval
    try {
        const response = await axios.get(url);
        console.log(`Successfully fetched daily K-line data for ${coin}.`);
        return response.data.data; // Return daily K-line data
    } catch (error) {
        console.error(`Error fetching K-line data for ${coin}:`, error.message);
        process.exit(1);
    }
}

// Step 4: Calculate daily movement percentages (pump/dump)
function calculatePercentages(dailyKlines) {
    const allDays = [];
    const pumps = [];
    const dumps = [];

    dailyKlines.forEach(kline => {
        const open = parseFloat(kline[1]); // Open price
        const close = parseFloat(kline[2]); // Close price
        const max = parseFloat(kline[3]); // Max price
        const min = parseFloat(kline[4]); // Min price

        if (open < close) {
            // It's a pump (green)
            const percentChange = ((close - open) / open) * 100; // Percent change from open to close
            pumps.push({
                timestamp: kline[0],
                percentChange,
                min,
                max,
                type: 'Pump'
            });

            // Add pump to All-Days table
            allDays.push({
                timestamp: kline[0],
                percentChange,
                min,
                max,
                type: 'Pump'
            });
        } else {
            // It's a dump (red)
            const percentChange = ((open - close) / open) * 100; // Percent change from open to close
            dumps.push({
                timestamp: kline[0],
                percentChange,
                min,
                max,
                type: 'Dump'
            });

            // Add dump to All-Days table
            allDays.push({
                timestamp: kline[0],
                percentChange,
                min,
                max,
                type: 'Dump'
            });
        }
    });

    // Sort pumps and dumps by absolute percentage change, descending
    pumps.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
    dumps.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));

    // Sort All-Days table by timestamp (chronological order)
    allDays.sort((a, b) => a.timestamp - b.timestamp);

    return { pumps, dumps, allDays };
}

// Step 4.1: Analyze trends over time
function trendAnalysis(dailyKlines, threshold = 10) {
    const significantEvents = [];
    const patterns = [];
    const consecutiveTrends = [];

    dailyKlines.forEach((kline, index) => {
        const open = parseFloat(kline[1]);
        const close = parseFloat(kline[2]);
        const max = parseFloat(kline[3]);
        const min = parseFloat(kline[4]);

        const percentChange = open < close
            ? ((close - open) / open) * 100 // Pump
            : ((open - close) / open) * 100; // Dump

        // Detect significant movements
        if (Math.abs(percentChange) >= threshold) {
            significantEvents.push({
                timestamp: kline[0],
                percentChange,
                type: open < close ? 'Pump' : 'Dump',
                min,
                max
            });
        }

        // Compare with previous days to identify patterns
        if (index >= 7) {
            const pastWeek = dailyKlines.slice(index - 7, index); // Last 7 days
            const avgPercentChange = pastWeek.reduce((sum, prevKline) => {
                const prevOpen = parseFloat(prevKline[1]);
                const prevClose = parseFloat(prevKline[2]);
                const change = prevOpen < prevClose
                    ? ((prevClose - prevOpen) / prevOpen) * 100
                    : ((prevOpen - prevClose) / prevOpen) * 100;
                return sum + Math.abs(change);
            }, 0) / 7;

            patterns.push({
                timestamp: kline[0],
                currentPercentChange: percentChange,
                avgPercentChange,
                deviation: Math.abs(percentChange) - avgPercentChange
            });
        }
    });

    // Detect consecutive pumps/dumps
    let trendCount = 1;
    for (let i = 1; i < dailyKlines.length; i++) {
        const prevOpen = parseFloat(dailyKlines[i - 1][1]);
        const prevClose = parseFloat(dailyKlines[i - 1][2]);
        const currOpen = parseFloat(dailyKlines[i][1]);
        const currClose = parseFloat(dailyKlines[i][2]);

        const prevType = prevOpen < prevClose ? 'Pump' : 'Dump';
        const currType = currOpen < currClose ? 'Pump' : 'Dump';

        if (prevType === currType) {
            trendCount++;
        } else {
            if (trendCount >= 3) {
                consecutiveTrends.push({
                    type: prevType,
                    count: trendCount,
                    endTimestamp: dailyKlines[i - 1][0]
                });
            }
            trendCount = 1; // Reset the count for the new trend
        }
    }

    return { significantEvents, patterns, consecutiveTrends };
}

// Step 5: Create HTML log with fixed navbar
// Step 5: Create HTML log with fixed navbar
async function createHtmlLog(pumps, dumps, allDays, trends, todayDeviation) {
    const { significantEvents, consecutiveTrends } = trends;

    // Sort Consecutive Trends by count (descending)
    consecutiveTrends.sort((a, b) => b.count - a.count);

    let htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Daily Percentage Movement</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                nav { position: fixed; top: 0; left: 0; width: 100%; background-color: #333; padding: 10px; z-index: 1000; }
                nav a { color: white; margin: 0 10px; text-decoration: none; font-weight: bold; }
                nav a:hover { text-decoration: underline; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; margin-top: 50px; }
                th, td { border: 1px solid #ddd; text-align: left; padding: 8px; }
                th { background-color: #f4f4f4; }
                .pump { color: green; }
                .dump { color: red; }
            </style>
        </head>
        <body>
            <nav>
                <a href="#today-analysis">Today's Analysis</a>
                <a href="#pumps">Pumps</a>
                <a href="#dumps">Dumps</a>
                <a href="#all-days">All Days</a>
                <a href="#significant-movements">Significant Movements</a>
                <a href="#consecutive-trends">Consecutive Trends</a>
            </nav>
           

            <!-- Today's Deviation Analysis -->
            <h2 id="today-analysis" style="color:white;">today</h2>
            <p>
                <strong>Timestamp:</strong> ${formatDateWithMonthName(todayDeviation.timestamp)}<br>
                <strong>Current Movement:</strong> <span class="${todayDeviation.type === 'Pump' ? 'pump' : 'dump'}">
                    ${todayDeviation.currentPercentChange.toFixed(2)}% (${todayDeviation.type})
                </span><br>
                <strong>Average Movement (7 Days):</strong> ${todayDeviation.avgPercentChange.toFixed(2)}%<br>
                <strong>Deviation:</strong> <span class="${todayDeviation.deviation > 0 ? 'pump' : 'dump'}">
                    ${todayDeviation.deviation.toFixed(2)}% (${todayDeviation.deviation > 0 ? 'Faster Movement' : 'Slower Movement'})
                </span>
            </p>

            <!-- Pumps Table -->
            <h2 id="pumps">Pumps</h2>
            <table>
                <tr><th>Timestamp</th><th>Percentage Change</th><th>Min</th><th>Max</th></tr>
                ${pumps.map(p => `
<tr>
    <td>${formatDateWithMonthName(p.timestamp)}</td>
    <td class="pump">+${p.percentChange.toFixed(2)}%</td>
    <td>${p.min}</td>
    <td>${p.max}</td>
</tr>`).join('')}
            </table>

            <!-- Dumps Table -->
            <h2 id="dumps">Dumps</h2>
            <table>
                <tr><th>Timestamp</th><th>Percentage Change</th><th>Min</th><th>Max</th></tr>
                ${dumps.map(d => `
<tr>
    <td>${formatDateWithMonthName(d.timestamp)}</td>
    <td class="dump">${d.percentChange.toFixed(2)}%</td>
    <td>${d.min}</td>
    <td>${d.max}</td>
</tr>`).join('')}
            </table>

            <!-- All-Days Table -->
            <h2 id="all-days">All Percentage Changes</h2>
            <table>
                <tr><th>Timestamp</th><th>Percentage Change</th><th>Min</th><th>Max</th></tr>
                ${allDays.map(day => `
<tr>
    <td>${formatDateWithMonthName(day.timestamp)}</td>
    <td class="${day.type === 'Pump' ? 'pump' : 'dump'}">
        ${day.percentChange.toFixed(2)}%</td>
    <td>${day.min}</td>
    <td>${day.max}</td>
</tr>`).join('')}
            </table>

            <!-- Significant Movements Table -->
            <h2 id="significant-movements">Significant Movements</h2>
            <table>
                <tr><th>Timestamp</th><th>Type</th><th>Percentage Change</th><th>Min</th><th>Max</th></tr>
                ${significantEvents.map(event => `
<tr>
    <td>${formatDateWithMonthName(event.timestamp)}</td>
    <td class="${event.type === 'Pump' ? 'pump' : 'dump'}">${event.type}</td>
    <td class="${event.type === 'Pump' ? 'pump' : 'dump'}">${event.percentChange.toFixed(2)}%</td>
    <td>${event.min}</td>
    <td>${event.max}</td>
</tr>`).join('')}
            </table>

            <!-- Consecutive Trends Table -->
            <h2 id="consecutive-trends">Consecutive Trends</h2>
            <table>
                <tr><th>Type</th><th>Count</th><th>End Date</th></tr>
                ${consecutiveTrends.map(trend => `
<tr>
    <td class="${trend.type === 'Pump' ? 'pump' : 'dump'}">${trend.type}</td>
    <td>${trend.count}</td>
    <td>${formatDateWithMonthName(trend.endTimestamp)}</td>
</tr>`).join('')}
            </table>
        </body>
        </html>
    `;

    const fileName = 'daily_movement.html';
    fs.writeFileSync(fileName, htmlContent);
    console.log(`HTML log created: ${fileName}`);

    try {
        const chromePath = path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe'); // Chrome executable path
        const browser = await playwright.chromium.launch({
            executablePath: chromePath,
            headless: false // Make the browser visible
        });
        const page = await browser.newPage();
        await page.goto(`file://${__dirname}/${fileName}`); // Open the HTML file in the browser
        console.log('HTML log displayed in Playwright browser.');

        // Keep the browser open until the user manually closes it
        console.log('The browser is now open. You can manually terminate the process when done.');
    } catch (error) {
        console.error('Error launching Playwright browser:', error.message);
    }
}



// Main function to orchestrate the process
async function main() {
    const coin = await getCoinName(); // Step 1
    const sysTime = await getSystemTime(); // Step 2
    const dailyKlines = await fetchDailyKlines(coin, sysTime); // Step 3
    const { pumps, dumps, allDays } = calculatePercentages(dailyKlines); // Step 4

    // Calculate today's deviation
    const todayKline = dailyKlines[dailyKlines.length - 1]; // Get the last day's kline (today)
    const todayPercentChange = parseFloat(todayKline[1]) < parseFloat(todayKline[2])
        ? ((parseFloat(todayKline[2]) - parseFloat(todayKline[1])) / parseFloat(todayKline[1])) * 100 // Pump
        : ((parseFloat(todayKline[1]) - parseFloat(todayKline[2])) / parseFloat(todayKline[1])) * 100; // Dump

    const pastWeek = dailyKlines.slice(-8, -1); // Last 7 days (exclude today)
    const avgPercentChange = pastWeek.reduce((sum, prevKline) => {
        const prevOpen = parseFloat(prevKline[1]);
        const prevClose = parseFloat(prevKline[2]);
        const change = prevOpen < prevClose
            ? ((prevClose - prevOpen) / prevOpen) * 100
            : ((prevOpen - prevClose) / prevOpen) * 100;
        return sum + Math.abs(change);
    }, 0) / pastWeek.length;

    const todayDeviation = {
        timestamp: todayKline[0],
        currentPercentChange: todayPercentChange,
        avgPercentChange,
        deviation: todayPercentChange - avgPercentChange,
        type: parseFloat(todayKline[1]) < parseFloat(todayKline[2]) ? 'Pump' : 'Dump'
    };

    const trends = trendAnalysis(dailyKlines); // Trend Analysis
    await createHtmlLog(pumps, dumps, allDays, trends, todayDeviation); // Step 5
}


main();

