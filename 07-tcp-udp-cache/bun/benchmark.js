const fs = require("fs");
const path = require("path");
const {
  COUNT,
  REQUESTS,
  RUNS,
  CONCURRENCY,
  INVALID_RATIO,
  TCP_PORT,
  UDP_PORT,
  REDIS_URL,
  RABBITMQ_URL,
} = require("./lib/config");
const { generateUserIds, pickValidUserId, pickInvalidUserId } = require("./lib/seed");
const {
  createRedis,
  seedRedis,
  createRabbit,
  purgeQueue,
  getQueueDepth,
  closeRedis,
  closeRabbit,
} = require("./lib/clients");
const { createHandler } = require("./lib/handler");
const { createTcpServer, closeTcpServer } = require("./lib/tcp-server");
const { createUdpServer, closeUdpServer } = require("./lib/udp-server");
const { tcpRequest, udpRequest, runPool, summarize } = require("./lib/load-client");

const RUNTIME = `Bun ${Bun.version}`;
const DIR = __dirname;
const OUT_DIR = path.join(DIR, "output");

const OPS = [
  { key: "tcpAccept", label: `TCP kabul (cache hit → RabbitMQ, ${REQUESTS} istek)` },
  { key: "tcpReject", label: `TCP red (cache miss, ${REQUESTS} istek)` },
  { key: "udpAccept", label: `UDP kabul (cache hit → RabbitMQ, ${REQUESTS} istek)` },
  { key: "udpReject", label: `UDP red (cache miss, ${REQUESTS} istek)` },
  { key: "tcpMixed", label: `TCP karışık (%${Math.round(INVALID_RATIO * 100)} red, ${REQUESTS} istek)` },
  { key: "udpMixed", label: `UDP karışık (%${Math.round(INVALID_RATIO * 100)} red, ${REQUESTS} istek)` },
];

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function buildUserList(mode, validIds) {
  const list = [];
  for (let i = 0; i < REQUESTS; i++) {
    if (mode === "accept") {
      list.push(pickValidUserId(validIds, i));
    } else if (mode === "reject") {
      list.push(pickInvalidUserId(validIds, i));
    } else {
      const invalid = i % Math.round(1 / INVALID_RATIO) === 0;
      list.push(
        invalid ? pickInvalidUserId(validIds, i) : pickValidUserId(validIds, i)
      );
    }
  }
  return list;
}

function avg(runs, key, field) {
  const values = runs.map((r) => r[key][field]);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function runScenario(mode, transport, validIds) {
  const users = buildUserList(mode, validIds);
  const requestFn =
    transport === "tcp"
      ? (userId) => tcpRequest(userId, TCP_PORT)
      : (userId) => udpRequest(userId, UDP_PORT);

  const start = Date.now();
  const results = await runPool(users, requestFn, CONCURRENCY);
  const wallMs = Date.now() - start;
  const stats = summarize(results);

  return {
    ...stats,
    wallMs,
    rps: (stats.count / wallMs) * 1000,
  };
}

async function startServers(redis, channel) {
  const handler = createHandler(redis, channel);
  const tcpServer = await createTcpServer(TCP_PORT, handler);
  const udpServer = await createUdpServer(UDP_PORT, handler);
  return { tcpServer, udpServer };
}

async function stopServers(servers) {
  await closeTcpServer(servers.tcpServer);
  await closeUdpServer(servers.udpServer);
}

async function runOperationSuite(validIds, redis, channel) {
  const servers = await startServers(redis, channel);
  const result = {};

  try {
    await purgeQueue(channel);
    result.tcpAccept = await runScenario("accept", "tcp", validIds);

    await purgeQueue(channel);
    result.tcpReject = await runScenario("reject", "tcp", validIds);

    await purgeQueue(channel);
    result.udpAccept = await runScenario("accept", "udp", validIds);

    await purgeQueue(channel);
    result.udpReject = await runScenario("reject", "udp", validIds);

    await purgeQueue(channel);
    result.tcpMixed = await runScenario("mixed", "tcp", validIds);

    await purgeQueue(channel);
    result.udpMixed = await runScenario("mixed", "udp", validIds);
  } finally {
    await stopServers(servers);
  }

  return result;
}

function formatRunLine(i, run) {
  const parts = OPS.map((op) => {
    const s = run[op.key];
    return `${op.key} wall=${s.wallMs}ms rps=${s.rps.toFixed(0)} p50=${s.p50Ms.toFixed(1)}`;
  });
  return `Koşu ${String(i).padStart(2)} | ${parts.join(" | ")}`;
}

function buildSummary(runs) {
  const lines = [
    `TCP/UDP → Redis → RabbitMQ Benchmark Sonuçları`,
    `Runtime     : ${RUNTIME}`,
    `Tarih       : ${new Date().toISOString()}`,
    `Redis       : ${REDIS_URL}`,
    `RabbitMQ    : ${RABBITMQ_URL}`,
    `COUNT       : ${COUNT} kullanıcı (Redis cache seed)`,
    `REQUESTS    : ${REQUESTS} istek / senaryo`,
    `CONCURRENCY : ${CONCURRENCY}`,
    `RUNS        : ${RUNS}`,
    ``,
    `Akış: TCP/UDP JSON {userId} → Redis EXISTS → varsa RabbitMQ publish, yoksa REJECT`,
    ``,
    `--- Koşu bazlı (wall ms, rps, p50 ms) ---`,
  ];

  for (let i = 0; i < RUNS; i++) {
    lines.push(formatRunLine(i + 1, runs[i]));
  }

  lines.push(``, `--- Aritmetik ortalama (${RUNS} koşu) ---`);
  for (const op of OPS) {
    const wall = avg(runs, op.key, "wallMs");
    const rps = avg(runs, op.key, "rps");
    const p50 = avg(runs, op.key, "p50Ms");
    const p99 = avg(runs, op.key, "p99Ms");
    lines.push(
      `  ${op.label}`,
      `    wall: ${wall.toFixed(1)} ms | rps: ${rps.toFixed(0)} | p50: ${p50.toFixed(1)} ms | p99: ${p99.toFixed(1)} ms`
    );
  }

  return { lines };
}

async function main() {
  ensureOutDir();
  const validIds = generateUserIds(COUNT);

  console.log(
    `Runtime: ${RUNTIME}\n` +
      `Redis=${REDIS_URL}\nRabbitMQ=${RABBITMQ_URL}\n` +
      `COUNT=${COUNT}, REQUESTS=${REQUESTS}, CONCURRENCY=${CONCURRENCY}, RUNS=${RUNS}\n`
  );

  const redis = await createRedis();
  const rabbit = await createRabbit();

  try {
    console.log(`Redis'e ${COUNT} kullanıcı seed ediliyor...`);
    await seedRedis(redis, validIds);
    const depth = await getQueueDepth(rabbit.channel);
    console.log(`Kuyruk hazır (mesaj: ${depth})\n`);

    const runs = [];
    for (let i = 1; i <= RUNS; i++) {
      const run = await runOperationSuite(validIds, redis, rabbit.channel);
      runs.push(run);
      console.log(formatRunLine(i, run));
    }

    const { lines } = buildSummary(runs);
    const resultsPath = path.join(OUT_DIR, "results.txt");
    fs.writeFileSync(resultsPath, lines.join("\n") + "\n");
    console.log(`\nSonuçlar yazıldı: ${resultsPath}`);
  } finally {
    await closeRedis(redis);
    await closeRabbit(rabbit);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
