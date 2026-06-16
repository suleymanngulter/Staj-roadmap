
// node 02-shared-memory/fixed.js

const {
  Worker,
  isMainThread,
  workerData,
} = require("worker_threads");

const WORKER_COUNT = 4;
const INCREMENTS = 200000;

if (isMainThread) {
  // ANA THREAD
  const sharedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(sharedBuffer);
  view[0] = 0;

  const workers = [];
  for (let i = 0; i < WORKER_COUNT; i++) {
    workers.push(
      new Promise((resolve, reject) => {
        const w = new Worker(__filename, {
          workerData: { sharedBuffer, increments: INCREMENTS },
        });
        w.on("error", reject);
        w.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("worker exit " + code))
        );
      })
    );
  }

  Promise.all(workers).then(() => {
    const expected = WORKER_COUNT * INCREMENTS;
    const actual = view[0];
    console.log("Beklenen bakiye:", expected);
    console.log(
      "Gerçek bakiye:   ",
      actual,
      actual === expected ? "(doğru)" : "<-- hala yanlış"
    );
  });
} else {
  // --- WORKER THREAD ---
  const view = new Int32Array(workerData.sharedBuffer);
  for (let i = 0; i < workerData.increments; i++) {
    // ATOMİK: oku-+1-yaz bölünemez tek işlem. Yarış yok, kayıp yok.
    Atomics.add(view, 0, 1);
  }
}
