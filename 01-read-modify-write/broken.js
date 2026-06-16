
// node 01-read-modify-write/broken.js

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(max = 50) {
  return sleep(Math.floor(Math.random() * max));
}


let balance = 0;

async function readBalance() {
  await randomDelay();
  return balance;
}

async function writeBalance(value) {
  await randomDelay();
  balance = value;
}

async function add(amount) {
  const current = await readBalance(); // oku
  const next = current + amount;        // değiştir
  await writeBalance(next);             // yaz
}

async function main() {
  balance = 0;

  // 5 işlem aynı anda +50 yapmaya çalışıyor. Beklenen: 250
  await Promise.all([add(50), add(50), add(50), add(50), add(50)]);

  console.log("Beklenen bakiye: 250");
  console.log("Gerçek bakiye:  ", balance, balance === 250 ? "tesadüf" : "race condition");
}

main();
