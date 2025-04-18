const axios = require('axios');
const prompt = require('prompt-sync')();
const fs = require('fs');

// Function to get the coin name from the user
async function getCoinName() {
    const coinName = prompt('Enter the coin name (e.g., BTC): ').trim();
    if (!coinName) {
        console.error('Error: No coin name entered. Please provide a valid coin name.');
        process.exit(1); // Exit the script if no input is given
    }
    return coinName.toUpperCase();
}

// Function to fetch the current system time
async function getSystemTime() {
    console.log('Fetching system time...');
    const response = await axios.get('https://www.coinex.com/res/system/time');
    console.log('Successfully fetched system time:', response.data.data.current_timestamp);
    return response.data.data.current_timestamp; // Return the current system timestamp
}

// Function to fetch 5-minute K-line data for the past 24 hours
async function fetch5mKlines(coin, sysTime) {
    console.log(`Fetching 5-minute K-line data for ${coin}...`);
    const interval = 300; // 5-minute interval
    const startTime = sysTime - (24 * 60 * 60); // Last 24 hours
    const url = `https://www.coinex.com/res/market/kline?market=${coin}USDT&start_time=${startTime}&end_time=${sysTime}&interval=${interval}`;
    const response = await axios.get(url);
    console.log(`Successfully fetched 5-minute K-line data for ${coin}.`);
    return response.data.data; // Return the K-line data
}

// Function to save min and max prices to a file
function saveMinMaxToFile(klines) {
    const minMaxPrices = klines.map(kline => `${parseFloat(kline[3]).toFixed(6)} ${parseFloat(kline[2]).toFixed(6)}`).join('\n');
    const fileName = 'min_max_prices.txt';
    fs.writeFileSync(fileName, minMaxPrices);
    console.log(`Min and max prices saved to file: ${fileName}`);
}

// Step 1: Analyze dump points with potential for short pumps
function detectDumpPoints(klines, pumpThreshold = 2.5) {
    const dumpPoints = [];

    for (let i = 0; i < klines.length - 1; i++) {
        const currentLow = parseFloat(klines[i][3]); // Current candle's low price
        let nextHigh = currentLow; // Start tracking from the current low
        let foundNextDump = false;

        // Find the highest price until the next dump occurs
        for (let j = i + 1; j < klines.length; j++) {
            const high = parseFloat(klines[j][2]); // High price of subsequent candles
            const low = parseFloat(klines[j][3]); // Low price of subsequent candles

            if (high > nextHigh) {
                nextHigh = high; // Update peak price
            }

            // Check if a new dump is detected or we reach the end of the dataset
            const dropPercent = ((nextHigh - low) / nextHigh) * 100;
            if (dropPercent >= pumpThreshold || j === klines.length - 1) {
                foundNextDump = true; // Consider this as a valid dump point
                break;
            }
        }

        // Calculate the recovery percentage from the current low to the next high
        const recovery = ((nextHigh - currentLow) / currentLow) * 100;

        // If recovery meets the threshold, log this as a dump point
        if (recovery >= pumpThreshold && foundNextDump) {
            dumpPoints.push({
                timestamp: klines[i][0],
                dumpLow: currentLow,
                recoveryHigh: nextHigh,
                recoveryPercent: recovery
            });
        }
    }

    return dumpPoints;
}


// Step 2: Predict Next Dump Point
function predictNextDump(dumpPoints, klines) {
    const lastLowPrice = parseFloat(klines[klines.length - 1][3]); // Most recent low price

    if (!dumpPoints.length) {
        console.log("No dump points detected. Using the most recent low price as prediction.");
        return {
            avgRecoveryPercent: null,
            predictedDumpPoint: lastLowPrice
        };
    }

    // Find the minimum dump point from all detected dumps
    const minDumpLow = Math.min(...dumpPoints.map(point => point.dumpLow));

    // Calculate historical recovery averages
    const validRecoveries = dumpPoints.filter(point => point.recoveryPercent > 0); // Only valid recoveries
    const avgRecoveryPercent = validRecoveries.length
        ? validRecoveries.reduce((sum, point) => sum + point.recoveryPercent, 0) / validRecoveries.length
        : null;

    // If no recoveries, fallback to the min dump point
    if (avgRecoveryPercent === null) {
        console.log("No valid recoveries found. Using the minimum detected dump point for prediction.");
        return {
            avgRecoveryPercent: null,
            predictedDumpPoint: minDumpLow * 0.92 // Decrease by ~8% as a fallback
        };
    }

    // Predict the next dump point based on the average recovery percent and minimum dump point
    const predictedDumpPoint = minDumpLow * (1 - avgRecoveryPercent / 100);

    return {
        avgRecoveryPercent,
        predictedDumpPoint
    };
}

// Main function to handle the process
async function main() {
    const coin = await getCoinName(); // Get the coin name from the user
    const sysTime = await getSystemTime(); // Get the current system time
    const klines = await fetch5mKlines(coin, sysTime); // Fetch the 5-minute K-line data

    // Step 3: Save min and max prices to a file
    saveMinMaxToFile(klines);

    // Step 4: Detect good dump points
    const dumpPoints = detectDumpPoints(klines, 2.5); // Look for recovery of 2.5% or more
    console.log("\n--- Detected Dump Points with Recovery ---");
    dumpPoints.forEach(point => {
        console.log(`Timestamp: ${point.timestamp}, Dump Low: ${point.dumpLow.toFixed(4)}, Recovery High: ${point.recoveryHigh.toFixed(4)}, Recovery: ${point.recoveryPercent.toFixed(2)}%`);
    });

    // Step 5: Predict the next dump point
    const prediction = predictNextDump(dumpPoints, klines); // Enhanced prediction logic
    console.log("\n--- Prediction ---");
    console.log(`Average Recovery Percent: ${prediction.avgRecoveryPercent ? prediction.avgRecoveryPercent.toFixed(2) : "N/A"}%`);
    console.log(`Predicted Next Dump Point: ${prediction.predictedDumpPoint.toFixed(4)}`);
}

main();
