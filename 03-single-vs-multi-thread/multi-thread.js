
// node 03-single-vs-multi-thread/multi-thread.js

const {
  Worker,
  isMainThread,
  workerData,
  parentPort,
} = require("worker_threads");
const { countPrimes } = require("./cpu-task");

const RANGE = 5_000_000;
const CHUNKS = 4;
const chunkSize = RANGE / CHUNKS;

if (isMainThread) {
  main();
} else {
  // --- WORKER THREAD (ayrı giriş noktası; main() burada çağrılmaz) ---
  const { start, end } = workerData;
  const count = countPrimes(start, end);
  parentPort.postMessage(count);
}

function main() {
  let beats = 0;
  const heartbeat = setInterval(() => {
    beats++;
    console.log(`   [heartbeat] event loop hala canlı (#${beats})`);
  }, 100);

  console.log("MULTI THREAD: iş 4 Worker'a paylaştırılıyor...");
  const startedAt = Date.now();

  const tasks = [];
  for (let i = 0; i < CHUNKS; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    tasks.push(
      new Promise((resolve, reject) => {
        const w = new Worker(__filename, { workerData: { start, end } });
        w.on("message", resolve);
        w.on("error", reject);
        w.on("exit", (code) => {
          if (code !== 0) reject(new Error("worker exit " + code));
        });
      })
    );
  }

  Promise.all(tasks).then((counts) => {
    const total = counts.reduce((a, b) => a + b, 0);
    const ms = Date.now() - startedAt;
    clearInterval(heartbeat);

    console.log(`\nToplam asal sayı: ${total}`);
    console.log(`Süre: ${ms} ms`);
    console.log(`Bu süre boyunca çalışabilen heartbeat sayısı: ${beats}`);
    console.log(
      "Not: heartbeat çalışmaya devam etti çünkü ağır iş Worker'larda, ana event loop boştu."
    );
  });
}
