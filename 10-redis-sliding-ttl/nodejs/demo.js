const { REDIS_URL, TTL_SEC, createRedis, set, get, ttlMs } = require("./cache");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (ms) => (ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "doldu");

async function touch(redis, key, label) {
  const value = await get(redis, key);
  const remaining = await ttlMs(redis, key);
  console.log(`  ${label}: ${value ?? "(yok)"} — kalan TTL: ${fmt(remaining)}`);
  return value;
}

async function main() {
  const redis = createRedis();
  const key = "cache:session:demo";

  await redis.del(key);

  console.log(`Redis: ${REDIS_URL}`);
  console.log(`TTL  : ${TTL_SEC}s (her okumada yeniden başlar)\n`);

  console.log("--- Yaz ---\n");
  await set(redis, key, "kullanici-verisi");
  console.log(`  key yazıldı, TTL=${TTL_SEC}s\n`);

  await sleep(2000);
  console.log("--- 2s sonra oku (sliding) ---\n");
  await touch(redis, key, "okuma 1");

  await sleep(2000);
  console.log("\n--- 2s sonra tekrar oku ---\n");
  await touch(redis, key, "okuma 2");

  console.log(`\n--- ${TTL_SEC}s erişim yok ---\n`);
  await sleep(TTL_SEC * 1000 + 500);

  console.log("--- Süre dolduktan sonra oku ---\n");
  await touch(redis, key, "okuma 3");

  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
