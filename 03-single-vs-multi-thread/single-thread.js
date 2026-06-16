
// node 03-single-vs-multi-thread/single-thread.js

const { countPrimes } = require("./cpu-task");

const RANGE = 5_000_000;
const CHUNKS = 4;
const chunkSize = RANGE / CHUNKS;

function main() {
  let beats = 0;
  const heartbeat = setInterval(() => {
    beats++;
    console.log(`   [heartbeat] event loop hala canlı (#${beats})`);
  }, 100);

  console.log("SINGLE THREAD: iş ana thread'de sırayla çalışıyor...");
  const startedAt = Date.now();

  let total = 0;
  for (let i = 0; i < CHUNKS; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    total += countPrimes(start, end);
  }

  const ms = Date.now() - startedAt;
  clearInterval(heartbeat);

  console.log(`\nToplam asal sayı: ${total}`);
  console.log(`Süre: ${ms} ms`);
  console.log(`Bu süre boyunca çalışabilen heartbeat sayısı: ${beats}`);
  console.log(
    "Not: heartbeat neredeyse hiç çalışamadı çünkü event loop bloklandı."
  );
}

main();
