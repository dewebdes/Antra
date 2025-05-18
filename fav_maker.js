const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const ACCESS_ID = "DD053DC012674525AEE34A8C5D093C01";
const SECRET_KEY = "6D968D2DA5629E83B42B6F99362B87F4B5E2077104D6803B";

const axiosInstance = axios.create({
    proxy: { host: '127.0.0.1', port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

const riskAxiosInstance = axios.create({
    baseURL: 'https://api.coinex.com/',
    headers: {
        'User-Agent': 'Mozilla/5.0 ... Chrome/39.0.2171.71 Safari/537.36',
        post: { 'Content-Type': 'application/json' },
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    proxy: { host: '127.0.0.1', port: 8082 },
    timeout: 10000,
});

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

// Load existing favorite coins
async function loadFavoriteCoins() {
    try {
        const filePath = path.resolve(__dirname, 'public', 'fav.txt');
        const content = await readFileAsync(filePath, 'utf8');
        return content.split(',').map(coin => coin.trim());
    } catch (error) {
        console.error('Error reading fav.txt:', error.message);
        return [];
    }
}

// Save updated favorite coins
async function saveFavoriteCoins(newFavList) {
    try {
        const filePath = path.resolve(__dirname, 'public', 'fav.txt');
        await writeFileAsync(filePath, newFavList.join(','), 'utf8');
        console.log('Updated fav.txt with new coins.');
    } catch (error) {
        console.error('Error saving fav.txt:', error.message);
    }
}

// Fetch all assets
async function fetchAllCoins() {
    try {
        const response = await axiosInstance.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        return response.data.data.data.map(item => item.asset);
    } catch (error) {
        console.error('Error fetching coin list:', error.message);
        return [];
    }
}

// Authorization signature generator
function createAuthorization(method, requestPath, bodyJson, timestamp) {
    const text = method + requestPath + bodyJson + timestamp + SECRET_KEY;
    return require('crypto').createHash('sha256').update(text).digest('hex').toUpperCase();
}

// Calculate risk for a coin
async function processRiskCalculation(coin, money) {
    const timestamp = Date.now();
    const url = `/v2/spot/deals?market=${coin}USDT`;
    try {
        const res = await riskAxiosInstance.get(url, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": createAuthorization("GET", "/v2/spot/deals", "", timestamp),
                "X-COINEX-TIMESTAMP": timestamp,
            }
        });

        let counter = 0;
        for (const deal of res.data.data) {
            const mon = parseFloat(deal.amount) * parseFloat(deal.price);
            if (mon >= money) counter++;
        }

        return counter < 5 ? 'bad' : 'good';
    } catch (error) {
        console.error(`Error calculating risk for ${coin}:`, error.message);
        return 'error';
    }
}

// Main function
async function main() {
    while (true) {
        console.log('Starting new scan...');
        const favCoins = await loadFavoriteCoins();
        const allCoins = await fetchAllCoins();

        for (const coin of allCoins) {
            if (favCoins.includes(coin) || ['USDC', 'DAI'].includes(coin)) continue; // Skip if in fav.txt or excluded list

            console.log(`Checking ${coin}...`);
            const risk = await processRiskCalculation(coin, 250);
            console.log(`Risk result for ${coin}: ${risk}`);

            if (risk === 'good') {
                console.log(`Adding ${coin} to fav.txt`);
                favCoins.unshift(coin); // Add to start
                await saveFavoriteCoins(favCoins);
            }

            console.log('Sleeping for 3 seconds...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log('Scan complete. Restarting...');
    }
}

// Start script
main().catch(error => console.error('Error in script:', error.message));
