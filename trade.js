const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const crypto = require('crypto');
const Axios = require('axios');

// Local JSON database file paths
const localDatabase = "./public/buy_offers.json";
const sellDatabase = "./public/sell_orders.json";
const profitDatabase = "./public/profit_log.json";

// CoinEx API Credentials
const ACCESS_ID = "xxxx";
const SECRET_KEY = "xxxx";

// Global Variables
let buyOffers = [];
let sellOrders = [];
let profitLog = [];
let allAssetPrices = {}; // For holding real-time prices
var browser, page; // Browser and page for UI interaction

// Generate API authorization for CoinEx
function createAuthorization(method, requestPath, bodyJson, timestamp) {
    const text = method + requestPath + bodyJson + timestamp + SECRET_KEY;
    return crypto.createHash("sha256").update(text).digest("hex").toUpperCase();
}

// Generate unique client IDs
function S4() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
}

function id() {
    return (S4() + S4() + S4() + S4() + S4() + S4() + S4() + S4());
}

// Axios instance for API calls
const axios = Axios.create({
    baseURL: "https://api.coinex.com/",
    headers: { "User-Agent": "Mozilla/5.0", post: { "Content-Type": "application/json" } },
    timeout: 10000,
    proxy: { host: "127.0.0.1", port: 8082 },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
});

// Save JSON data to file
function saveData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`JSON database updated successfully: ${filePath}`);
    } catch (error) {
        console.error(`Error saving data to ${filePath}:`, error.message);
    }
}

// Load JSON data from file
function loadData(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            return fileContent.trim() ? JSON.parse(fileContent) : []; // Return parsed JSON or empty array
        } else {
            return []; // Return empty array if file does not exist
        }
    } catch (error) {
        console.error(`Error loading data from ${filePath}:`, error.message);
        return [];
    }
}

// Fetch all asset prices and store them globally
async function fetchAllAssetPrices() {
    try {
        console.log("Fetching all asset prices...");
        const response = await axios.get(
            'https://www.coinex.com/res/quotes/assets?sort_type=circulation_usd&offset=0&limit=8000'
        );
        const assets = response.data.data.data;
        allAssetPrices = assets.reduce((acc, asset) => {
            acc[asset.asset] = Number(asset.price_usd);
            return acc;
        }, {});
        console.log("Successfully fetched all asset prices.");
    } catch (error) {
        console.error("Error fetching asset prices:", error.message);
        allAssetPrices = {}; // Reset prices to avoid stale data
    }
}

// Get the real-time price for a given coin
async function getFinalPrice(coin) {
    return allAssetPrices[coin] || null; // Return the price if available, else null
}

// Update percent remaining and real-time prices for all buy offers
async function updatePercentRemaining() {
    console.log("Updating percent remaining for all buy offers...");
    buyOffers = loadData(localDatabase); // Load buy offers from JSON
    for (const offer of buyOffers) {
        const currentPrice = await getFinalPrice(offer.name);
        if (currentPrice) {
            const percentRemaining = Math.abs(((offer.price - currentPrice) / offer.price) * 100);
            offer.percentRemaining = percentRemaining.toFixed(2);
            offer.currentPrice = currentPrice;
        } else {
            offer.currentPrice = "Error fetching price";
        }
    }
    await updateTable(buyOffers); // Dynamically update the table with new data
}

// Dynamically update the HTML table based on buy offers
async function updateTable(buyOffers) {
    buyOffers = loadData(localDatabase); // Load buy offers from JSON

    // Filter out "success" records
    buyOffers = buyOffers.filter(offer => offer.status !== "success");

    // Refresh current price and percent remaining before rendering the table
    for (const offer of buyOffers) {
        const currentPrice = await getFinalPrice(offer.name);
        if (currentPrice) {
            offer.percentRemaining = Math.abs(((offer.price - currentPrice) / offer.price) * 100).toFixed(2);
            offer.currentPrice = currentPrice; // Update with the latest price
        } else {
            offer.currentPrice = "Error fetching price";
        }
    }

    // Sort buy offers by percentRemaining (low to high)
    buyOffers.sort((a, b) => parseFloat(a.percentRemaining) - parseFloat(b.percentRemaining));

    await page.evaluate(buyOffers => {
        const tableBody = document.querySelector('#buy-orders tbody');
        tableBody.innerHTML = ''; // Clear existing rows
        buyOffers.forEach(offer => {
            const newRow = document.createElement('tr');
            newRow.innerHTML = `
                <td>${offer.name}</td>
                <td>${offer.price}</td>
                <td>${offer.currentPrice || "Fetching..."}</td>
                <td>${offer.percentRemaining || "100%"}%</td>
                <td>${offer.status}</td>
                <td>${offer.money}</td>
                <td>${(offer.money / offer.price).toFixed(2)}</td>
                <td>${offer.profit || 3}%</td>
                <td><button class="cancel-btn buy-cancel-btn" data-coin="${offer.name}" data-id="${offer.stop_id}" ${offer.status !== 'pending' ? 'style="display:none"' : ''}>Cancel</button></td>
            `;
            tableBody.appendChild(newRow);
        });

        // Attach cancel button event listeners for BUY orders
        document.querySelectorAll('.buy-cancel-btn').forEach(button => {
            button.addEventListener('click', async (event) => {
                const coin = event.target.getAttribute('data-coin');
                const stopId = event.target.getAttribute('data-id');
                console.log(`Buy Cancel button clicked: Coin: ${coin}, Stop ID: ${stopId}`);
                if (window.cancelStopOrder) {
                    await window.cancelStopOrder(coin, stopId);
                } else {
                    console.error("cancelStopOrder function not defined!");
                }
            });
        });
    }, buyOffers);
}



async function sellforce3(coin, damount) {
    const timestamp = Date.now();

    // Find and cancel the existing pending sell order for the coin
    const sellOrder = sellOrders.find(order => order.name === coin && order.status === "pending");
    if (sellOrder) {
        console.log(`Canceling existing pending sell order for ${coin}. Order ID: ${sellOrder.order_id}`);
        try {
            const cancelResult = await cancelSellOrder({ coin, orderId: sellOrder.order_id });
            if (cancelResult !== "ok") {
                console.error(`Failed to cancel sell order for ${coin}. Result: ${cancelResult}`);
                return 0; // Abort if unable to cancel the order
            } else {
                console.log(`Sell order for ${coin} successfully canceled.`);
                // Remove the canceled sell record from the sellOrders array
                sellOrders = sellOrders.filter(order => order.order_id !== sellOrder.order_id);
                saveData(sellDatabase, sellOrders); // Save updated sell orders
            }
        } catch (error) {
            console.error(`Error canceling sell order for ${coin}: ${error.message}`);
            return 0; // Abort if an error occurs during cancellation
        }
    } else {
        console.log(`No pending sell order found for ${coin}. Proceeding with sellforce.`);
    }

    // Place a market sell order for the given amount
    const data = JSON.stringify({
        market: coin + "USDT",
        market_type: "SPOT",
        side: "sell",
        type: "market",
        amount: damount,
    });

    try {
        const res2 = await axios.post("/v2/spot/order", data, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": createAuthorization("POST", "/v2/spot/order", data, timestamp),
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        console.log("sellforce3 placed market order:\n", JSON.stringify(res2.data, null, 2));

        const code = parseInt(res2.data.code);
        if (code === 0) {
            const filledValue = parseFloat(res2.data.data.filled_value);

            // Update the sell record to "sellforce"
            const matchingSellOrder = sellOrders.find(order => order.name === coin && order.status === "pending");
            if (matchingSellOrder) {
                matchingSellOrder.status = "sellforce"; // Update status to sellforce
                saveData(sellDatabase, sellOrders); // Save updated sell orders
                console.log(`Sell order status updated to "sellforce" for ${coin}.`);
            }

            // Log profit to the profit log (without `status` field)
            const matchingBuyOrder = buyOffers.find(buy => buy.name === coin && buy.status === "success");
            if (matchingBuyOrder) {
                const buyValue = matchingBuyOrder.price * damount;
                const profit = filledValue - buyValue;

                profitLog.push({
                    coin: coin,
                    amount: damount,
                    buyPrice: matchingBuyOrder.price,
                    sellPrice: filledValue / damount,
                    profit: profit.toFixed(2),
                });
                saveData(profitDatabase, profitLog);
                console.log(`Profit logged for ${coin}: ${profit.toFixed(2)} USDT.`);

                // Update the profit log table
                await updateTableProfit();
            }

            return filledValue;
        } else {
            console.error(`Sellforce failed for ${coin}: ${res2.data.message}`);
            return 0;
        }
    } catch (error) {
        console.error(`Error in sellforce3 for ${coin}: ${error.message}`);
        return 0;
    }
}




// Dynamically update the Sell Orders table
async function updateTableSell() {
    sellOrders = loadData(sellDatabase); // Load sell orders from JSON

    // Filter out "success" records
    sellOrders = sellOrders.filter(order => order.status !== "success");

    for (const order of sellOrders) {
        const currentPrice = await getFinalPrice(order.name); // Fetch current price for the coin
        if (currentPrice) {
            const percentRemaining = Math.abs(((order.price - currentPrice) / order.price) * 100);
            order.currentPrice = currentPrice;
            order.percentRemaining = percentRemaining.toFixed(2);
            order.currentValue = (currentPrice * order.amount).toFixed(2); // Calculate current value
        } else {
            order.currentPrice = "Error fetching price";
            order.percentRemaining = "Error";
            order.currentValue = "Error"; // Set error if current price can't be fetched
        }
    }

    // Sort sell orders by percentRemaining (low to high)
    sellOrders.sort((a, b) => parseFloat(a.percentRemaining) - parseFloat(b.percentRemaining));

    saveData(sellDatabase, sellOrders); // Save updated sell orders back to JSON

    await page.evaluate(sellOrders => {
        const tableBody = document.querySelector('#sell-orders tbody');
        tableBody.innerHTML = ''; // Clear existing rows

        sellOrders.forEach(order => {
            const newRow = document.createElement('tr');
            newRow.innerHTML = `
                <td>${order.name}</td>
                <td>${order.price}</td>
                <td>${order.currentPrice || "Fetching..."}</td>
                <td>${order.percentRemaining || "Pending..."}%</td>
                <td>${order.status}</td>
                <td>${order.amount}</td>
                <td>${(order.amount * order.price).toFixed(2)}</td>
                <td>${order.currentValue || "Calculating..."}</td>
                <td>
                    <button class="cancel-btn sell-cancel-btn" data-coin="${order.name}" data-id="${order.order_id}" ${order.status !== 'pending' ? 'style="display:none"' : ''}>Cancel</button>
                    <button class="sellforce-btn" data-coin="${order.name}" data-amount="${order.amount}" ${order.status !== 'pending' ? 'style="display:none"' : ''}>Sellforce</button>
                </td>
            `;
            tableBody.appendChild(newRow);
        });
    }, sellOrders);
}




// Submit a new BUY offer
async function submitBuyOffer({ coinName, price, money, profit }) {
    console.log(`Processing new BUY offer: ${coinName} | Price: ${price} | Money: ${money} | Profit: ${profit || 3}%`);
    try {
        const cid = id(); // Generate unique client ID once
        console.log(`Generated CID for BUY offer: ${cid}`);

        const stopId = await putMarketOrder(coinName, money, price, 'buy', cid); // Pass CID to putMarketOrder

        // Add the new BUY offer to the global buyOffers array
        buyOffers = loadData(localDatabase);
        buyOffers.push({
            name: coinName,
            price,
            money,
            status: 'pending',
            profit: profit || 3,
            stop_id: stopId,
            cid, // Save the same CID
        });
        saveData(localDatabase, buyOffers); // Save to JSON

        console.log("New BUY offer added successfully:", { name: coinName, price, money, profit: profit || 3, stop_id: stopId, cid });

        // Update the table dynamically
        await updateTable(buyOffers);
    } catch (error) {
        console.error("Error submitting BUY offer:", error.message);
        await page.evaluate(() => alert("Error submitting BUY offer. Please try again."));
    }
}
// Handle a finished BUY order by placing a SELL order
async function processBuyOrder(order) {
    const { market, amount, filled_amount, price, client_id } = order;

    // Find the matching buy order with a "pending" status in the JSON database
    const matchingBuyOrder = buyOffers.find(buy => buy.cid === client_id && buy.status === "pending");
    if (!matchingBuyOrder) {
        console.error(`No matching BUY order found with client_id: ${client_id} and status "pending".`);
        return;
    }

    const profitPercent = matchingBuyOrder.profit || 3; // Default to 3% profit if not defined
    const sellPrice = price * (1 + profitPercent / 100);
    const coin = market.replace("USDT", ""); // Extract coin name
    const sellCid = id(); // Generate unique client ID for the sell order

    // Place the SELL order
    const sellOrderId = await putSellOrder(coin, filled_amount, sellPrice, sellCid);

    // Update the status of the matching buy order to "success"
    matchingBuyOrder.status = "success";
    saveData(localDatabase, buyOffers); // Save the updated buy-offers.json

    // Save the new SELL order in sell-orders.json
    sellOrders.push({
        name: coin,
        price: sellPrice,
        amount: filled_amount,
        status: "pending",
        cid: sellCid,
        order_id: sellOrderId,
    });
    saveData(sellDatabase, sellOrders);

    // Log the executed buy order for debugging purposes
    const debugData = loadData('./public/debug_executed_orders.json') || [];
    debugData.push({
        type: "buy",
        order_id: order.order_id,
        market: market,
        amount: filled_amount,
        price: price,
        status: "success",
        timestamp: Date.now(),
    });
    saveData('./public/debug_executed_orders.json', debugData);

    console.log(`Updated BUY order status to "success" and placed SELL order for ${coin}. SELL Order ID: ${sellOrderId}`);
}



// Handle a finished SELL order and calculate profit
function processSellOrder(order) {
    const { client_id, amount, filled_value } = order;

    const matchingSellOrder = sellOrders.find(sell => sell.cid === client_id && sell.status === "pending");

    if (matchingSellOrder) {
        // Update the status of the matching sell order to "success"
        matchingSellOrder.status = "success";
        saveData(sellDatabase, sellOrders); // Save updated sell orders

        // Log the executed sell order for debugging purposes
        const debugData = loadData('./public/debug_executed_orders.json') || [];
        debugData.push({
            type: "sell",
            order_id: order.order_id,
            market: matchingSellOrder.name,
            amount: amount,
            price: filled_value / amount,
            total_value: filled_value,
            status: "success",
            timestamp: Date.now(),
        });
        saveData('./public/debug_executed_orders.json', debugData);

        console.log(`Updated SELL order status to "success" for ${matchingSellOrder.name}.`);
    } else {
        console.error(`No matching SELL order found for client_id: ${client_id}`);
    }

    const matchingBuyOrder = buyOffers.find(buy => buy.cid === client_id && buy.status === "success");

    if (matchingBuyOrder) {
        // Calculate profit
        const buyValue = matchingBuyOrder.price * amount;
        const profit = parseFloat(filled_value) - buyValue;

        // Log profit and update Profit Log
        profitLog.push({
            coin: matchingBuyOrder.name,
            amount: amount,
            buyPrice: matchingBuyOrder.price,
            sellPrice: filled_value / amount,
            profit: profit.toFixed(2),
            status: "success",
        });
        saveData(profitDatabase, profitLog);

        console.log(`Profit logged for ${matchingBuyOrder.name}: ${profit.toFixed(2)} USDT`);
    } else {
        console.error(`No matching BUY order found for client_id: ${client_id}`);
    }
}



// Place a SELL order on CoinEx
async function putSellOrder(coin, amount, limit, cid) {
    const timestamp = Date.now();
    const data = JSON.stringify({
        market: `${coin}USDT`,
        market_type: "SPOT",
        side: "sell",
        type: "limit", // Correctly use limit order
        amount: amount,
        client_id: cid,
        price: limit, // Ensure price is included for limit order
        is_hide: false,
    });

    console.log(`Submitting sell order with CID: ${cid}`);
    const authHeader = createAuthorization("POST", "/v2/spot/order", data, timestamp);

    try {
        const res = await axios.post("/v2/spot/order", data, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": authHeader,
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        if (res.data.code === 0 && res.data.data.order_id) {
            console.log(`Successfully placed SELL order. Order ID: ${res.data.data.order_id}`);
            return res.data.data.order_id;
        } else {
            throw new Error(`Unexpected response: ${JSON.stringify(res.data)}`);
        }
    } catch (error) {
        console.error("Error placing sell order:", error.message);
        throw error;
    }
}

// Cancel a stop-limit BUY order
async function cancelStopOrder(coin, stopId) {
    const timestamp = Date.now();
    const data = JSON.stringify({
        market: `${coin}USDT`,
        market_type: "SPOT",
        stop_id: parseInt(stopId),
    });

    console.log(`Canceling buy order: Coin: ${coin}, Stop ID: ${stopId}`);
    const authHeader = createAuthorization("POST", "/v2/spot/cancel-stop-order", data, timestamp);

    try {
        const res = await axios.post("/v2/spot/cancel-stop-order", data, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": authHeader,
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        if (res.data.code === 0 && res.data.message === "OK") {
            console.log(`Buy order canceled successfully: Stop ID ${stopId}`);
            return "ok";
        } else {
            console.error(`Cancel buy order failed: ${res.data.message}`);
            return res.data.message;
        }
    } catch (error) {
        console.error("Error canceling buy order:", error.message);
        return "error";
    }
}

// Cancel a SELL order
async function cancelSellOrder({ coin, orderId }) {
    const timestamp = Date.now();
    const data = JSON.stringify({
        market: `${coin}USDT`,
        market_type: "SPOT",
        order_id: parseInt(orderId),
    });

    console.log(`Canceling sell order: Coin: ${coin}, Order ID: ${orderId}`);
    const res = await axios.post("/v2/spot/cancel-order", data, {
        headers: {
            "X-COINEX-KEY": ACCESS_ID,
            "X-COINEX-SIGN": createAuthorization("POST", "/v2/spot/cancel-order", data, timestamp),
            "X-COINEX-TIMESTAMP": timestamp,
        },
    });

    if (res.data.code === 0 && res.data.message === "OK") {
        console.log(`Sell order canceled successfully: Order ID ${orderId}`);
        return "ok";
    } else {
        console.error(`Cancel sell order failed: ${res.data.message}`);
        return res.data.message;
    }
}

// Fetch finished orders from CoinEx API
let refreshCount = 0; // Initialize refresh count in memory

async function fetchFinishedOrders() {
    const timestamp = Date.now();
    const requestPath = "/v2/spot/finished-order?market_type=SPOT";

    try {
        const res = await axios.get(requestPath, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": createAuthorization("GET", requestPath, "", timestamp),
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        // Increment the refresh count
        refreshCount++;
        console.log(`Refresh Count: ${refreshCount}`);

        // Update the refresh count in the HTML
        await page.evaluate(refreshCount => {
            document.getElementById("refreshCount").textContent = refreshCount;
        }, refreshCount);

        if (res.data.code === 0) {
            console.log("Fetched finished orders:", res.data.data);
            return res.data.data; // List of finished orders
        } else {
            console.error("Failed to fetch finished orders:", res.data.message);
            return [];
        }
    } catch (error) {
        console.error("Error fetching finished orders:", error.message);
        return [];
    }
}


// Dynamically update the Profit Log table
async function updateTableProfit() {
    profitLog = loadData(profitDatabase); // Load profit log data from JSON

    await page.evaluate(profitLog => {
        const tableBody = document.querySelector('#profit-log tbody');
        tableBody.innerHTML = ''; // Clear existing rows

        profitLog.forEach(log => {
            const newRow = document.createElement('tr');
            newRow.innerHTML = `
                <td>${log.coin}</td>
                <td>${log.amount}</td>
                <td>${log.buyPrice}</td>
                <td>${log.sellPrice}</td>
                <td>${log.profit}</td>
            `;
            tableBody.appendChild(newRow);
        });
    }, profitLog);

    console.log("Profit log table updated successfully.");
}


// Process finished orders by type (BUY or SELL)
async function processFinishedOrders() {
    console.log("Processing finished orders...");
    const finishedOrders = await fetchFinishedOrders(); // Fetch finished orders from server

    // Load existing debug data or start with an empty array
    let debugExecutedOrders = loadData('./public/debug_executed_orders.json') || [];

    for (const order of finishedOrders) {
        if (order.side === "buy") {
            console.log(`Processing BUY order for ${order.market}...`);
            await processBuyOrder(order); // Handle the buy order
        } else if (order.side === "sell") {
            console.log(`Processing SELL order for ${order.market}...`);
            processSellOrder(order); // Handle the sell order
        }
    }

    // Save debug data to JSON file after processing
    saveData('./public/debug_executed_orders.json', debugExecutedOrders);

    console.log("Debug JSON updated with executed orders.");

    // Update tables after processing orders
    await updateTable(buyOffers); // Refresh buy table
    await updateTableSell(); // Refresh sell table
    await updateTableProfit(); // Refresh profit log table

    console.log("Finished orders processed. Tables updated successfully.");
}




async function putMarketOrder(coin, money, limit, side, cid) {
    const timestamp = Date.now();
    const data = JSON.stringify({
        market: `${coin}USDT`,
        market_type: "SPOT",
        side: side,
        type: "market",
        amount: money,
        ccy: "USDT",
        client_id: cid, // Use the CID passed as a parameter
        trigger_price: limit,
        is_hide: false,
    });

    console.log(`Submitting market order with CID: ${cid}`);
    const authHeader = createAuthorization("POST", "/v2/spot/stop-order", data, timestamp);

    try {
        const res = await axios.post("/v2/spot/stop-order", data, {
            headers: {
                "X-COINEX-KEY": ACCESS_ID,
                "X-COINEX-SIGN": authHeader,
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        if (res.data.code === 0 && res.data.data.stop_id) {
            console.log(`Market order placed successfully: Stop ID ${res.data.data.stop_id}`);
            return res.data.data.stop_id;
        } else {
            throw new Error(`Unexpected response: ${JSON.stringify(res.data)}`);
        }
    } catch (error) {
        console.error("Error placing market order:", error.message);
        throw error;
    }
}


// Periodically fetch and update asset prices
async function startPeriodicUpdates() {
    setInterval(async () => {
        console.log("Starting periodic updates...");

        // Step 1: Fetch updated asset prices
        await fetchAllAssetPrices();

        // Step 2: Update table data dynamically with new prices
        await updatePercentRemaining(); // Updates buy table with current prices and percentages
        await updateTableSell();       // Updates sell table with current prices and values
        await updateTableProfit();     // Updates profit log table dynamically
    }, 60000); // Update every 60 seconds
}


// Main function to set up the browser, periodic updates, and start syncing
async function main() {
    console.log("Initializing the script...");

    // Step 1: Set up the browser
    await setupBrowser();

    // Step 2: Start periodic updates for asset prices and buy table
    console.log("Starting periodic updates...");
    startPeriodicUpdates();

    // Step 3: Fetch finished orders once at startup
    console.log("Fetching finished orders once during startup...");
    await processFinishedOrders();

    // Step 4: Begin syncing finished orders (every 5 minutes)
    console.log("Starting periodic sync for finished orders...");
    setInterval(processFinishedOrders, 300000); // Sync every 5 minutes

    console.log("Script initialization complete.");
}

// Set up the browser and load the HTML interface
async function setupBrowser() {
    const htmlFilePath = path.resolve(__dirname, 'public', 'trade.html'); // Path to the HTML file
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf8'); // Load the HTML content

    console.log("Launching browser...");
    browser = await chromium.launch({
        headless: false,
        executablePath: path.resolve(__dirname, "C:\\Program Files\\Google\\Chrome\\Application", "chrome.exe"), // Adjust as needed
    });
    page = await browser.newPage();
    await page.setContent(htmlContent); // Load HTML interface into the browser

    console.log("Fetching initial asset prices...");
    await fetchAllAssetPrices(); // Fetch prices before rendering anything

    console.log("Populating table with buy offers...");
    buyOffers = loadData(localDatabase); // Load buy offers from the local JSON database

    // Calculate and update current price and percent remaining for each buy offer
    for (const offer of buyOffers) {
        const currentPrice = await getFinalPrice(offer.name); // Get the current price of the coin
        if (currentPrice) {
            const percentRemaining = Math.abs(((offer.price - currentPrice) / offer.price) * 100);
            offer.percentRemaining = percentRemaining.toFixed(2);
            offer.currentPrice = currentPrice;
        } else {
            offer.currentPrice = "Error fetching price";
        }
    }
    saveData(localDatabase, buyOffers); // Save the updated buy offers back to the JSON file
    await updateTable(buyOffers); // Render the buy table dynamically with accurate data

    console.log("Attaching exposed functions...");
    await page.exposeFunction('submitBuyOffer', async ({ coinName, price, money, profit }) => {
        console.log(`submitBuyOffer triggered: Coin: ${coinName} | Price: ${price} | Money: ${money} | Profit: ${profit || 3}`);
        await submitBuyOffer({ coinName, price, money, profit });
    });

    await page.exposeFunction('cancelStopOrder', async (coin, stopId) => {
        console.log(`cancelStopOrder triggered: Coin: ${coin} | Stop ID: ${stopId}`);
        const result = await cancelStopOrder(coin, stopId);

        if (result === "ok") {
            // Load and filter buyOffers to remove the canceled offer
            buyOffers = buyOffers.filter(offer => offer.stop_id != stopId);
            saveData(localDatabase, buyOffers);
            console.log(`Order with Stop ID ${stopId} successfully removed from JSON database.`);
            await updateTable(buyOffers); // Update the buy table dynamically
        } else {
            console.error(`Failed to cancel order: ${result}`);
        }
    });

    await page.exposeFunction('cancelSellOrder', async ({ coin, orderId }) => {
        console.log(`cancelSellOrder triggered: Coin: ${coin} | Order ID: ${orderId}`);
        const result = await cancelSellOrder({ coin, orderId });

        if (result === "ok") {
            // Load and filter sellOrders to remove the canceled offer
            sellOrders = sellOrders.filter(order => order.order_id != orderId);
            saveData(sellDatabase, sellOrders);
            console.log(`Sell order with Order ID ${orderId} successfully removed from JSON database.`);
            await updateTableSell(); // Update the sell table dynamically
        } else {
            console.error(`Failed to cancel sell order: ${result}`);
        }
    });

    await page.exposeFunction('sellforce3', async (coin, amount) => {
        console.log(`sellforce3 called: Coin: ${coin}, Amount: ${amount}`);
        return await sellforce3(coin, amount);
    });


    console.log("Adding button event listeners...");
    await page.evaluate(() => {
        // Open the dialog for a new BUY offer
        document.getElementById("new-buy-button").addEventListener("click", () => {
            const dialog = document.getElementById("buy-offer-dialog");
            dialog.style.display = "block";
        });

        // Submit a new BUY offer
        document.getElementById("submit-buy-offer").addEventListener("click", async () => {
            const coinName = document.getElementById("coin-name").value;
            const price = parseFloat(document.getElementById("price").value);
            const money = parseFloat(document.getElementById("money").value);
            const profit = parseFloat(document.getElementById("profit").value) || 3;

            console.log(`Submit BUY offer clicked: Coin: ${coinName} | Price: ${price} | Money: ${money} | Profit: ${profit}`);
            if (coinName && price && money) {
                await window.submitBuyOffer({ coinName, price, money, profit });
            } else {
                alert('Please fill out all fields correctly.');
            }

            // Close the dialog after submission
            const dialog = document.getElementById("buy-offer-dialog");
            dialog.style.display = "none";
        });

        // Cancel the dialog for new BUY offers
        document.getElementById("cancel-buy-offer").addEventListener("click", () => {
            const dialog = document.getElementById("buy-offer-dialog");
            dialog.style.display = "none";
        });
    });

    console.log("Browser setup completed.");
}

// Start the main function
main();
