
// node 04-libuv-threadpool/bench.js

const crypto = require("crypto");

const TASKS = Number(process.env.TASKS || 8);
const ITERATIONS = 300_000; // pbkdf2 tur sayısı — işi bilerek ağırlaştırır
const poolSize = process.env.UV_THREADPOOL_SIZE || "4 (varsayılan)";

function hashOnce(i) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(`password-${i}`, "salt", ITERATIONS, 64, "sha512", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  const startedAt = Date.now();
  await Promise.all(Array.from({ length: TASKS }, (_, i) => hashOnce(i)));
  const ms = Date.now() - startedAt;

  console.log(
    `UV_THREADPOOL_SIZE=${String(poolSize).padEnd(14)} | ` +
      `${TASKS} görev | süre: ${ms} ms`
  );
}

main();
