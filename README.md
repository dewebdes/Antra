<p align="center">
  <img src="https://github.com/dewebdes/Antra/blob/main/public/Antra.png" alt="Partizan Logo" width="100" height="100">
<br>
<strong align="center"># Antra</strong>

_"Antra," inspired by an ancient tale, represents the mystical serpent symbolizing wisdom, bravery, and inner strength. In this legend, Antra was a magical snake that illuminated the paths of heroes in search of hidden treasures during the darkness of night. It stood as a beacon, transforming obscurity into light and unveiling concealed mysteries. The name "Antra" became synonymous with enlightenment and decoding secrets, embodying the power of transformation and creation wherever it ventured._

This project takes its inspiration from Antra, serving as a guiding tool for uncovering insights, analyzing data, and making informed decisions in the world of cryptocurrency markets.

---

## Overview

The **Antra Toolkit** is a comprehensive collection of scripts and tools developed to analyze, predict, and optimize crypto market trends. With features ranging from proxy management to logarithmic regression analysis, Antra provides a robust, data-driven solution for market exploration and decision-making.

---

## Features

### **1. proxy24m.py**

- **Purpose**: Manages request proxies using 240 worker nodes, employing MITM (Man-in-the-Middle) techniques for handling large-scale requests efficiently.
- **Use Case**: Enables the seamless routing of requests through multiple proxies to avoid rate limits or network bottlenecks.

### **2. redproxy2.js**

- **Purpose**: Acts as a specialized proxy handler tailored for cl-workers, ensuring reliable and secure request routing.
- **Use Case**: Supports the ecosystem of scripts reliant on proxy-based operations for enhanced network stability.

### **3. fetchCoinData.js**

- **Purpose**: Fetches continuous kline (candlestick) data for all coins, saving it for subsequent analytical use.
- **Use Case**: Serves as the backbone for collecting historical and real-time data crucial for market analysis.

### **4. signal.js**

- **Purpose**: Conducts deep market analysis, ranking coins based on potential pump factors and generating HTML reports.
- **Additional Features**:
  - Sorts coins based on multiple factors like volume, rank, and price fluctuations.
  - Evaluates market execution strategies.
  - Outputs data in a detailed, color-coded HTML log.
- **Use Case**: Perfect for identifying coins with promising market opportunities.

### **5. apiconnect.js**

- **Purpose**: Enhances the HTML logs generated by `signal.js` with dynamic interactivity, enabling users to highlight and interact with specific coins.
- **Use Case**: Provides seamless backend communication for live updates and user interaction.

### **6. api.js**

- **Purpose**: Independently evaluates the potential of a coin's market execution based on provided funds and transaction thresholds.
- **Use Case**: A standalone tool for gauging whether a market is worth exploring for investments.

### **7. pond.js**

- **Purpose**: Analyzes a coin’s behavior using Fibonacci retracements and historical kline data to determine trends and key price points.
- **Use Case**: Suitable for traders seeking detailed Fibonacci analysis and trend insights.

### **8. fibonacci_alert.js**

- **Purpose**: Extends the functionalities of `pond.js` by:
  - Adding real-time HTML log updates.
  - Generating audio alerts for significant price movements (e.g., critical dump points).
  - Streamlining data visualization with a cleaner UI.
- **Use Case**: Ideal for real-time monitoring of price trends with actionable alerts.

### **9. coin_vs_btc.js**

- **Purpose**: Compares the pump/dump behavior of multiple coins against BTC, ranking them based on their likelihood of pumping.
- **Additional Features**:
  - Outputs a ranked HTML log.
  - Adds a "Pump Day" column for quick reference on days with significant opportunities.
- **Use Case**: Designed for comparative analysis of coin performance relative to BTC trends.

### **10. btc_price_estimator.js**

- **Purpose**: Predicts a coin's price when BTC reaches a specified target price, analyzing their historical correlation and change rates.
- **Use Case**: Assists in projecting future prices based on Bitcoin’s market movements.

### **11. klines_trend_analysis.py**

- **Purpose**: Uses logarithmic regression models to predict long-term price trends for cryptocurrencies based on historical data.
- **Use Case**: Enables long-term strategizing for investors by forecasting prices over extended periods.

---

## Getting Started

### Prerequisites

Before running any scripts, make sure to set up the required environment and proxy.

### **MITM Proxy Setup**

Most scripts rely on a proxy server for handling requests. Follow these steps to set it up:

1. **Install MITM Proxy Server**:

   - On Windows, download and install the MITM proxy server from [mitmproxy.org](https://mitmproxy.org/).

2. **Install Python MITM Package**:

   ```bash
   py -m pip install mitmproxy
   ```

3. **Start the MITM Proxy Server**:

   - Run the following command to start the server:
     ```bash
     & "C:\Program Files\mitmproxy\bin\mitmweb.exe" --set block_global=false --ssl-insecure --listen-port 8082 -s proxy24m.py
     ```
   - This command:
     - Disables global blocking.
     - Ignores SSL certificates.
     - Sets the proxy listening port to `8082`.
     - Loads the `proxy24m.py` script to handle proxy operations.

4. **Verify Proxy Setup**:
   - Ensure your proxy is active and running before executing any scripts.

---

### Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/dewebdes/antra.git
   cd antra
   ```

2. Install the required dependencies:

   ```bash
   npm install
   ```

3. Set up Python environment (if using `klines_trend_analysis.py`):
   ```bash
   pip install -r requirements.txt
   ```

---

## Running the Tools

Each tool is designed for a specific purpose. Here’s how you can execute them:

### Scripts:

- **Start fetching kline data (default):**
  ```bash
  npm run fetch-data
  ```
- **Run market analysis (`signal.js`):**
  ```bash
  npm run run-signal
  ```
- **Evaluate market potential for specific funds:**
  ```bash
  npm run run-api
  ```
- **Analyze trends with Fibonacci (`pond.js`):**
  ```bash
  npm run run-pond
  ```
- **Monitor prices with alerts:**
  ```bash
  npm run run-fibonacci-alert
  ```
- **Compare coins vs BTC trends:**
  ```bash
  npm run run-coin-vs-btc
  ```
- **Estimate coin price at BTC target:**
  ```bash
  npm run run-btc-estimator
  ```
- **Perform long-term trend analysis:**
  ```bash
  npm run run-trend-analysis
  ```

---

## The Spirit of Antra

"Antra" is not just a toolkit; it’s a guiding light for navigating the often shadowy and unpredictable cryptocurrency landscape. Inspired by the mythical serpent that turned darkness into light, this project embodies the same mission—to uncover hidden opportunities and transform data into actionable insights.

With Antra, every analysis is a step toward enlightenment in the complex world of digital markets.

---

## Methodology (<a href="https://www.youtube.com/channel/UCpzaAyoepAWcNI6HdoFewHg">Watch on YOUTUBE</a>)
<a href="https://www.youtube.com/watch?v=BO3cYEXkIcY">
<img src="https://github.com/dewebdes/Antra/blob/main/mindmap.png" alt="trade hacking mindmap" />
</a>

## Contributions

Contributions are welcome! Feel free to submit issues or create pull requests to enhance Antra’s capabilities further.
