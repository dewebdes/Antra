const ACCESS_ID = "xxx"; // your access id
const SECRET_KEY = "xxx"; // your secret key


const { chromium } = require('playwright');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const port = 3000;

const chromePath = path.resolve(__dirname, 'C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe');



const crypto = require("crypto");
function createAuthorization(method, request_path, body_json, timestamp) {
    var text = method + request_path + body_json + timestamp + SECRET_KEY;
    console.log(text);
    return crypto
        .createHash("sha256")
        .update(text)
        .digest("hex")
        .toUpperCase();
}

const Axios = require("axios");
const axios = Axios.create({
    baseURL: "https://api.coinex.com/",
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36",
        post: {
            "Content-Type": "application/json",
        },
    },
    timeout: 10000,
});





app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.post('/process', async (req, res) => {
    const coin = req.body.coin;
    const money = req.body.money;
    const result = await processRiskCalculation(coin, money);
    res.send({ result });
});

async function processRiskCalculation(coin, money) {

    timetamp = Date.now();
    const res = await axios.get("/v2/spot/deals?market=" + coin + "USDT", {
        headers: {
            "X-COINEX-KEY": ACCESS_ID,
            "X-COINEX-SIGN": createAuthorization("GET", "/v2/spot/deals", "", timetamp),
            "X-COINEX-TIMESTAMP": timetamp,
        }
    });
    //console.log(res);
    // console.log(JSON.stringify(res.data.data[0]));
    var counter = 0;
    for (var i = 0; i <= res.data.data.length - 1; i++) {
        var mon = parseInt(parseFloat(res.data.data[i].amount) * parseFloat(res.data.data[i].price));
        //console.log(money);
        if (mon >= money) {
            counter++;
        }
    }
    console.log(counter);
    //return ({ coin: name, per: counter });
    if (counter < 5) {
        return 'bad';
    } else {
        return 'good';
    }

    // Your async risk calculation logic here
    //return `Risk calculation for ${coin} with ${money} money processed`;
}

app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);

    // Open the HTML file in Playwright with the visible browser
    const browser = await chromium.launch({
        headless: false, // This will make the browser visible
        executablePath: chromePath // Use the specified Chrome path
    });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/api.html`);
});
