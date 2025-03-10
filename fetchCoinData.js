const fs = require('fs');
const path = require('path');
const axios = require('axios');
const randomUserAgent = require('random-useragent');
const https = require('https');

// Create an HTTPS agent to disable SSL certificate verification
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Ensure the output directory exists
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// Function to fetch the wallet data from the provided URL
async function fetchWalletData() {
    const response = await axios.get('https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000', {
        httpsAgent,
        proxy: {
            host: '127.0.0.1',
            port: 8082
        }
    });
    return response.data.data.data;
}

// Function to get the current timestamp
async function getCurrentTimestamp() {
    const response = await axios.get('https://www.coinex.com/res/system/time', {
        httpsAgent,
        proxy: {
            host: '127.0.0.1',
            port: 8082
        }
    });
    return response.data.data.current_timestamp;
}

// Function to get coin data using axios with retry for 403 errors
async function getCoinData(coinName, systime) {
    const url = `https://www.coinex.com/res/market/kline?market=${coinName}USDT&start_time=1736395200&end_time=${systime}&interval=86400`;
    const userAgent = randomUserAgent.getRandom();
    const headers = { 'User-Agent': userAgent };

    try {
        const response = await axios.get(url, {
            headers,
            httpsAgent,
            proxy: {
                host: '127.0.0.1',
                port: 8082
            }
        });
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 403) {
            console.log(`403 error encountered. Retrying request for ${coinName}...`);
            const response = await axios.get(url, {
                headers,
                httpsAgent,
                proxy: {
                    host: '127.0.0.1',
                    port: 8082
                }
            });
            return response.data;
        } else {
            throw error;
        }
    }
}

// Main function to fetch wallet data, loop over JSON entries and save responses
async function main() {
    clearInterval(intervalId); // Clear the interval on process start

    const wallet = await fetchWalletData();
    const systime = await getCurrentTimestamp();
    const totalCoins = wallet.length;
    let processedCoins = 0;
    const failedCoins = [];

    for (const asset of wallet) {
        const coinName = asset.asset;
        console.log(`Processing ${coinName}...`);

        try {
            const data = await getCoinData(coinName, systime);
            const outputFilePath = path.join(outputDir, `${coinName}.json`);

            fs.writeFileSync(outputFilePath, JSON.stringify(data, null, 2)); // Overwrite the old file
            processedCoins++;
            const progress = ((processedCoins / totalCoins) * 100).toFixed(2);
            console.log(`Progress: ${progress}%`);
        } catch (error) {
            if (error.response && error.response.status === 403) {
                console.error(`Error processing ${coinName} after retry:`, error);
                failedCoins.push(coinName);
            } else {
                console.error(`Error processing ${coinName}:`, error);
            }
        }

        // Wait for 3 seconds before making the next request
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('All coins processed.');

    // Generate log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilePath = path.join(outputDir, `fetch_log_${timestamp}.html`);

    const logContent = `
    <html>
    <head><title>Fetch Log</title></head>
    <body>
        <h1>Fetch Log - ${timestamp}</h1>
        <h2>Coins with 403 Errors</h2>
        <table border="1">
            <tr>
                <th>Coin Name</th>
            </tr>
            ${failedCoins.map(coin => `
            <tr>
                <td><a href="https://www.coinex.com/en/exchange/${coin}-usdt" target="_blank">${coin}</a></td>
            </tr>
            `).join('')}
        </table>
        <h2>Processing Results</h2>
        <p>Total Coins Processed: ${processedCoins}</p>
        <p>Total Coins Failed: ${failedCoins.length}</p>
    </body>
    </html>`;

    fs.writeFileSync(logFilePath, logContent);
    console.log(`Log file saved to ${logFilePath}`);

    intervalId = setInterval(main, 300000); // Redefine the interval to run the script every 5 minutes
}

let intervalId = setInterval(main, 300000); // Start the initial interval to run the script every 5 minutes
main();
