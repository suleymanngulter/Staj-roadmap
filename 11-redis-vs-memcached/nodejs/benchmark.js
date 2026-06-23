const fs = require("fs");
const path = require("path");
const { generateEntries } = require("./lib/data");
const {
  REDIS_URL,
  MEMCACHED_URL,
  TTL_SEC,
  createRedis,
  createMemcached,
  memCall,
  memGetMulti,
  flushRedis,
  flushMemcached,
} = require("./lib/clients");

const COUNT = Number(process.env.COUNT) || 10_000;
const RUNS = Number(process.env.RUNS) || 10;
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE) || 500;
const GET_CHUNK_SIZE = Number(process.env.GET_CHUNK_SIZE) || 500;
const OUT_DIR = path.join(__dirname, "output");

const OPS = [
  { key: "setSeq", label: `SET (tekil, ${COUNT} key)` },
  { key: "getSeq", label: `GET (tekil, ${COUNT} key)` },
  { key: "setBulk", label: `SET (toplu, ${COUNT} key)` },
  { key: "getBulk", label: `GET (toplu, ${COUNT} key)` },
];

async function timeMs(fn) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

async function redisSetSeq(redis, entries) {
  for (const { key, value } of entries) {
    await redis.set(key, value, "EX", TTL_SEC);
  }
}

async function redisGetSeq(redis, entries) {
  for (const { key } of entries) {
    await redis.get(key);
  }
}

async function redisSetBulk(redis, entries) {
  const pipe = redis.pipeline();
  for (const { key, value } of entries) {
    pipe.set(key, value, "EX", TTL_SEC);
  }
  await pipe.exec();
}

async function redisGetBulk(redis, entries) {
  await redis.mget(entries.map((e) => e.key));
}

async function memSetSeq(client, entries) {
  for (const { key, value } of entries) {
    await memCall(client, "set", key, value, TTL_SEC);
  }
}

async function memGetSeq(client, entries) {
  for (const { key } of entries) {
    await memCall(client, "get", key);
  }
}

async function memSetBulk(client, entries) {
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(({ key, value }) => memCall(client, "set", key, value, TTL_SEC)),
    );
  }
}

async function memGetBulk(client, entries) {
  const keys = entries.map((e) => e.key);
  const chunkSize = GET_CHUNK_SIZE <= 0 ? keys.length : GET_CHUNK_SIZE;

  for (let i = 0; i < keys.length; i += chunkSize) {
    await memGetMulti(client, keys.slice(i, i + chunkSize));
  }
}

async function runRedisSuite(entries) {
  const redis = createRedis();
  await flushRedis(redis);

  const result = {};
  result.setSeq = await timeMs(() => redisSetSeq(redis, entries));
  result.getSeq = await timeMs(() => redisGetSeq(redis, entries));

  await flushRedis(redis);
  result.setBulk = await timeMs(() => redisSetBulk(redis, entries));
  result.getBulk = await timeMs(() => redisGetBulk(redis, entries));

  await redis.quit();
  return result;
}

async function runMemcachedSuite(entries) {
  const client = createMemcached();
  await flushMemcached(client);

  const result = {};
  result.setSeq = await timeMs(() => memSetSeq(client, entries));
  result.getSeq = await timeMs(() => memGetSeq(client, entries));

  await flushMemcached(client);
  result.setBulk = await timeMs(() => memSetBulk(client, entries));
  result.getBulk = await timeMs(() => memGetBulk(client, entries));

  client.end();
  return result;
}

function avg(runs, key) {
  return runs.reduce((sum, r) => sum + r[key], 0) / runs.length;
}

function ratio(redisMs, memMs) {
  if (memMs === 0) return "-";
  const r = redisMs / memMs;
  return r >= 1 ? `Redis ${r.toFixed(2)}x yavaş` : `Memcached ${(1 / r).toFixed(2)}x yavaş`;
}

function formatRunLine(i, redisRun, memRun) {
  const parts = OPS.map(
    (op) => `${op.key} redis=${redisRun[op.key]} mem=${memRun[op.key]} ms`,
  );
  return `Koşu ${String(i).padStart(2)} | ${parts.join(" | ")}`;
}

function buildSummary(redisRuns, memRuns) {
  const lines = [
    "Redis vs Memcached Benchmark",
    `Tarih     : ${new Date().toISOString()}`,
    `COUNT     : ${COUNT} key (JSON user objesi)`,
    `RUNS      : ${RUNS}`,
    `TTL_SEC   : ${TTL_SEC}`,
    `CHUNK_SIZE: ${CHUNK_SIZE} (Memcached toplu SET paralel chunk)`,
    `GET_CHUNK  : ${GET_CHUNK_SIZE <= 0 ? COUNT : GET_CHUNK_SIZE} (Memcached getMulti chunk; 0 = tek çağrı)`,
    `Redis     : ${REDIS_URL} (toplu SET = pipeline, toplu GET = tek MGET)`,
    `Memcached : ${MEMCACHED_URL} (toplu SET = paralel chunk, toplu GET = getMulti chunk)`,
    `Not       : Koşular sıralı; localhost, tek client, küçük JSON value (~70 B)`,
    "",
    "--- Koşu bazlı süreler (ms) ---",
  ];

  for (let i = 0; i < RUNS; i++) {
    lines.push(formatRunLine(i + 1, redisRuns[i], memRuns[i]));
  }

  lines.push("", `--- Ortalama (${RUNS} koşu, ms) ---`);
  for (const op of OPS) {
    const r = avg(redisRuns, op.key);
    const m = avg(memRuns, op.key);
    lines.push(
      `  ${op.label.padEnd(28)}: Redis ${r.toFixed(1).padStart(8)} | Memcached ${m.toFixed(1).padStart(8)} | ${ratio(r, m)}`,
    );
  }

  return lines;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entries = generateEntries(COUNT);
  const redisRuns = [];
  const memRuns = [];

  console.log(
    `COUNT=${COUNT}, RUNS=${RUNS}, CHUNK_SIZE=${CHUNK_SIZE}, GET_CHUNK_SIZE=${GET_CHUNK_SIZE}\n` +
      `Redis     : ${REDIS_URL}\n` +
      `Memcached : ${MEMCACHED_URL}\n`,
  );

  for (let i = 1; i <= RUNS; i++) {
    const redisRun = await runRedisSuite(entries);
    const memRun = await runMemcachedSuite(entries);
    redisRuns.push(redisRun);
    memRuns.push(memRun);
    console.log(formatRunLine(i, redisRun, memRun));
  }

  const lines = buildSummary(redisRuns, memRuns);
  console.log("\n--- Ortalama ---");
  for (const line of lines.slice(lines.indexOf(`--- Ortalama (${RUNS} koşu, ms) ---`) + 1)) {
    if (line.startsWith("  ")) console.log(line);
  }

  const outPath = path.join(OUT_DIR, "results.txt");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nSonuçlar: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
