var money = 266;
async function sendInput(coin) {
    let seecoins = localStorage.getItem("seecoins") || "";

    localStorage.setItem("seecoins", seecoins + "," + coin);
    document.title = "";
    //document.getElementById("result").innerText = "";
    //const coin = document.getElementById("coin").value;
    //const money = document.getElementById("money").value;
    const response = await fetch("/process", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ coin, money }),
    });
    const data = await response.json();
    document.title = data.result;
}
var intsee = setInterval(seecheck, 1000);
function seecheck() {
    clearInterval(intsee);
    let seecoins = localStorage.getItem("seecoins") || "";
    var sc = seecoins.split(",");
    sc.forEach(coin => {
        if (coin.trim().length > 0) {
            document.querySelectorAll("tr").forEach(row => {
                if (row.textContent.includes(coin)) {
                    row.cells[0].style.backgroundColor = "red";
                }
            });
        }
    });


    document.querySelectorAll("tr").forEach(row => {
        if (Number(row.cells[6].innerText.split('%')[0]) > 0) {
            row.cells[6].style.backgroundColor = "green";
            row.cells[6].style.color = "white";
        }
    });

    intsee = setInterval(seecheck, 1000);
}