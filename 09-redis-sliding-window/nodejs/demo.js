const { REDIS_URL, WINDOW_MS, LIMIT, createRedis, allow } = require("./limiter");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(redis, key, n) {
  const ok = await allow(redis, key);
  console.log(`  istek ${n}: ${ok ? "İZİN" : "RED"}`);
  return ok;
}

async function main() {
  const redis = createRedis();
  const key = "rate:demo-user";

  await redis.del(key);

  console.log(`Redis : ${REDIS_URL}`);
  console.log(`Pencere: son ${WINDOW_MS}ms`);
  console.log(`Limit  : ${LIMIT} istek\n`);

  console.log("--- Hızlı 8 istek (limit aşılır) ---\n");
  for (let i = 1; i <= 8; i++) {
    await hit(redis, key, i);
  }

  console.log(`\n--- ${WINDOW_MS}ms bekle (pencere kayar) ---\n`);
  await sleep(WINDOW_MS + 200);

  console.log("--- Tekrar 3 istek (yeni pencere) ---\n");
  for (let i = 1; i <= 3; i++) {
    await hit(redis, key, i);
  }

  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
