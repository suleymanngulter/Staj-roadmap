const fs = require("fs");
const path = require("path");
const { generateUsers } = require("./lib/seed");
const {
  DB_PATH,
  openDb,
  setupSchema,
  insertBatchTransaction,
  insertIndividual,
  selectAll,
  selectByAge,
  updateAllAges,
  deleteByIdGreaterThan,
  closeDb,
} = require("./lib/db");

const RUNTIME = `Bun ${Bun.version}`;
const COUNT = Number(process.env.COUNT) || 10000;
const RUNS = Number(process.env.RUNS) || 20;
const DELETE_AFTER_ID = Math.floor(COUNT * 0.75);
const DIR = __dirname;
const OUT_DIR = path.join(DIR, "output");

const OPS = [
  { key: "insertTx", label: `INSERT (transaction, ${COUNT} satır)` },
  { key: "insertSingle", label: "INSERT (tekil, autocommit)" },
  { key: "selectAll", label: "SELECT *" },
  { key: "selectWhere", label: "SELECT WHERE age > 30" },
  { key: "updateAll", label: "UPDATE age = age + 1" },
  { key: "deleteHalf", label: `DELETE id > ${DELETE_AFTER_ID}` },
];

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function timeMs(fn) {
  const start = Date.now();
  fn();
  return Date.now() - start;
}

function avg(runs, key) {
  const values = runs.map((r) => r[key]);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function runOperationSuite(users) {
  let db;
  const result = {};

  db = openDb();
  setupSchema(db);
  result.insertTx = timeMs(() => insertBatchTransaction(db, users));
  closeDb(db);

  db = openDb();
  setupSchema(db);
  result.insertSingle = timeMs(() => insertIndividual(db, users));
  closeDb(db);

  db = openDb();
  setupSchema(db);
  insertBatchTransaction(db, users);
  result.selectAll = timeMs(() => selectAll(db));
  closeDb(db);

  db = openDb();
  setupSchema(db);
  insertBatchTransaction(db, users);
  result.selectWhere = timeMs(() => selectByAge(db, 30));
  closeDb(db);

  db = openDb();
  setupSchema(db);
  insertBatchTransaction(db, users);
  result.updateAll = timeMs(() => updateAllAges(db));
  closeDb(db);

  db = openDb();
  setupSchema(db);
  insertBatchTransaction(db, users);
  result.deleteHalf = timeMs(() => deleteByIdGreaterThan(db, DELETE_AFTER_ID));
  closeDb(db);

  return result;
}

function formatRunLine(i, run) {
  const parts = OPS.map((op) => `${op.key} ${run[op.key]} ms`);
  return `Koşu ${String(i).padStart(2)} | ${parts.join(" | ")}`;
}

function buildSummary(runs) {
  const lines = [
    `SQLite Benchmark Sonuçları`,
    `Runtime : ${RUNTIME}`,
    `Driver  : bun:sqlite`,
    `Tarih   : ${new Date().toISOString()}`,
    `COUNT   : ${COUNT} kullanıcı (id, username, name, surname, age)`,
    `DB      : ${DB_PATH} (paylaşımlı dosya, her işlem öncesi sıfırlanır)`,
    `RUNS    : ${RUNS}`,
    ``,
    `--- Koşu bazlı süreler (ms) ---`,
  ];

  for (let i = 0; i < RUNS; i++) {
    lines.push(formatRunLine(i + 1, runs[i]));
  }

  lines.push(``, `--- Aritmetik ortalama (${RUNS} koşu, ms) ---`);
  for (const op of OPS) {
    lines.push(`  ${op.label.padEnd(32)}: ${avg(runs, op.key).toFixed(1)} ms`);
  }

  const totalAvg = OPS.reduce((sum, op) => sum + avg(runs, op.key), 0);
  lines.push(``, `  ${"TOPLAM (tüm işlemler)".padEnd(32)}: ${totalAvg.toFixed(1)} ms`);

  return { lines, totals: Object.fromEntries(OPS.map((op) => [op.key, avg(runs, op.key)])) };
}

function main() {
  ensureOutDir();
  const users = generateUsers(COUNT);
  const runs = [];

  console.log(
    `Runtime: ${RUNTIME}\n` +
      `Driver: bun:sqlite\n` +
      `COUNT=${COUNT}, RUNS=${RUNS}\nDB=${DB_PATH}\n`
  );

  for (let i = 1; i <= RUNS; i++) {
    const run = runOperationSuite(users);
    runs.push(run);
    console.log(formatRunLine(i, run));
  }

  const { lines, totals } = buildSummary(runs);

  console.log(`\n--- Ortalama ---`);
  for (const op of OPS) {
    console.log(`  ${op.label}: ${totals[op.key].toFixed(1)} ms`);
  }

  const resultsPath = path.join(OUT_DIR, "results.txt");
  fs.writeFileSync(resultsPath, lines.join("\n") + "\n");
  console.log(`\nSonuçlar yazıldı: ${resultsPath}`);
}

main();
