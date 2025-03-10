import requests
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

# Disable SSL warnings
from requests.packages.urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

# Function to fetch K-lines data from CoinEx
def get_klines(coin, interval, start_time, end_time, proxies=None):
    url = f"https://www.coinex.com/res/market/kline?market={coin}USDT&start_time={start_time}&end_time={end_time}&interval={interval}"
    print(f"[INFO] Fetching K-lines data from CoinEx: {url}")
    try:
        response = requests.get(url, proxies=proxies, verify=False)
        response.raise_for_status()
        data = response.json()
        if data["code"] == 0:  # Successful response
            print(f"[INFO] Fetched {len(data['data'])} entries.")
            return data["data"]
        else:
            print(f"[ERROR] API Error: {data['message']}")
            return None
    except Exception as e:
        print(f"[ERROR] Failed to fetch data: {str(e)}")
        return None

# Function to get current system time
def get_system_time(proxies=None):
    url = "https://www.coinex.com/res/system/time"
    print("[INFO] Fetching system time from CoinEx.")
    try:
        response = requests.get(url, proxies=proxies, verify=False)
        response.raise_for_status()
        data = response.json()
        if data["code"] == 0:
            print(f"[INFO] System time: {data['data']['current_timestamp']}")
            return data["data"]["current_timestamp"]
        else:
            print(f"[ERROR] API Error: {data['message']}")
            return None
    except Exception as e:
        print(f"[ERROR] Failed to fetch system time: {str(e)}")
        return None

# Prompt the user for input
def user_inputs():
    coin = input("Enter the coin name (e.g., BTC, ETH): ").upper()
    print("\nChoose a trading interval:")
    print("1. 5 minutes")
    print("2. 15 minutes")
    print("3. 1 hour")
    print("4. 1 day")
    interval_map = {1: "300", 2: "900", 3: "3600", 4: "86400"}
    try:
        interval_choice = int(input("Enter your choice (1-4): "))
        interval = interval_map.get(interval_choice, "300")  # Default to 5 minutes
    except ValueError:
        print("[WARNING] Invalid choice. Defaulting to 5 minutes.")
        interval = "300"

    years = int(input("\nEnter the number of years to predict ahead: "))
    future_days = years * 365  # Convert years to days
    print(f"[INFO] Predicting {years} years ahead ({future_days} days).")
    return coin, interval, future_days

# Process data and perform predictions
def process_and_predict_klines(klines, future_days):
    print("[INFO] Processing fetched K-lines data.")
    columns = ["timestamp", "open", "close", "high", "low", "volume", "turnover"]
    df = pd.DataFrame(klines, columns=columns)

    # Reduce dataset by sampling every 5th row
    print("[INFO] Reducing dataset by sampling...")
    df = df.iloc[::5]

    # Process timestamps
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="s")
    df.set_index("timestamp", inplace=True)
    df = df.astype(float)
    df["days_since_start"] = (df.index - df.index[0]).days

    # Logarithmic regression
    print("[INFO] Performing logarithmic regression...")
    x = np.log1p(df["days_since_start"]).values.reshape(-1, 1)
    y = df["close"].values.reshape(-1, 1)
    coef = np.polyfit(np.log1p(df["days_since_start"]), df["close"], 1)
    a, b = coef[0], coef[1]  # Slope and intercept
    df["regression"] = a * np.log1p(df["days_since_start"]) + b
    print(f"[INFO] Logarithmic Regression Equation: y = {a:.2f} * ln(x) + {b:.2f}")

    # Future predictions (every 5 days for efficiency)
    print(f"[INFO] Generating future predictions for {future_days} days (every 5 days).")
    future_x = np.log1p(df["days_since_start"].max() + np.arange(1, future_days + 1, 5))  # Predict every 5 days
    future_predictions = a * future_x + b
    future_dates = pd.date_range(df.index[-1] + pd.Timedelta(days=1), periods=len(future_x), freq="5D")
    future_df = pd.DataFrame({"timestamp": future_dates, "predicted_close": future_predictions})
    future_df.set_index("timestamp", inplace=True)

    # Debugging prediction data
    print(f"[DEBUG] Future Dates Range: {future_dates.min()} to {future_dates.max()}")
    print(f"[DEBUG] Future Predictions (Sample):\n{future_df.head()}")

    # Plotting
    print("[INFO] Plotting results.")
    plt.figure(figsize=(12, 6))
    plt.plot(df.index, df["close"], label="Actual Prices", color="blue")
    plt.plot(df.index, df["regression"], label="Logarithmic Regression", linestyle="--", color="orange")
    plt.plot(future_df.index, future_df["predicted_close"], label="Future Predictions", linestyle=":", color="green")
    plt.xlabel("Date")
    plt.ylabel("Price (USDT)")
    plt.title(f"Logarithmic Regression and {future_days // 365} Years of Predictions")
    plt.legend()
    plt.grid()
    plt.show()

    return df, future_df

# Main function
def main():
    # User inputs
    coin, interval, future_days = user_inputs()

    # Fetch system time
    system_time = get_system_time()
    if not system_time:
        print("[ERROR] Could not fetch system time. Exiting.")
        return

    # Fetch K-lines data
    start_time = system_time - (86400 * 365 * 5)  # Fetch only the last 5 years for efficiency
    klines = get_klines(coin, interval, start_time, system_time)
    if not klines:
        print("[ERROR] Could not fetch K-lines data. Exiting.")
        return

    # Process and predict
    process_and_predict_klines(klines, future_days)

if __name__ == "__main__":
    main()
