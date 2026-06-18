const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const { createCounterPdf } = require("./lib/create-counter-pdf");
const { mergePdfs } = require("./lib/merge-pdfs");

const RUNTIME = `Node.js ${process.version}`;
const COUNT = Number(process.env.COUNT) || 2000;
const WORKERS = Number(process.env.WORKERS) || 8;
const RUNS = Number(process.env.RUNS) || 20;
const DIR = __dirname;
const OUT_DIR = path.join(DIR, "output");
const WORKER_SCRIPT = path.join(DIR, "worker.js");

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function avg(runs, key) {
  const values = runs.map((r) => r[key]).filter((v) => v != null);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function totalMs({ genMs, mergeMs }) {
  return genMs + (mergeMs ?? 0);
}

function createWorkerPool(size) {
  const workers = Array.from({ length: size }, () => new Worker(WORKER_SCRIPT));

  function dispatch(worker, from, to) {
    return new Promise((resolve, reject) => {
      const onMessage = (msg) => {
        cleanup();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.buffers);
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        worker.off("message", onMessage);
        worker.off("error", onError);
      };

      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.postMessage({ from, to });
    });
  }

  return {
    workers,
    dispatch,
    terminate() {
      return Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

function chunkRanges(count, workerCount) {
  const chunkSize = Math.ceil(count / workerCount);
  const ranges = [];
  for (let i = 0; i < workerCount; i++) {
    const from = i * chunkSize + 1;
    const to = Math.min((i + 1) * chunkSize, count);
    if (from > count) break;
    ranges.push({ from, to });
  }
  return ranges;
}

async function runSingleThread(writePdf) {
  const genStart = Date.now();
  const buffers = [];

  for (let n = 1; n <= COUNT; n++) {
    buffers.push(await createCounterPdf(n));
  }
  const genMs = Date.now() - genStart;

  let mergeMs = null;
  if (writePdf) {
    const mergeStart = Date.now();
    const merged = await mergePdfs(buffers);
    mergeMs = Date.now() - mergeStart;
    fs.writeFileSync(path.join(OUT_DIR, "merged-single-thread.pdf"), merged);
  }

  return { genMs, mergeMs, buffers: writePdf ? null : undefined };
}

async function runMultiThread(pool, writePdf) {
  const ranges = chunkRanges(COUNT, pool.workers.length);
  const genStart = Date.now();

  const chunks = await Promise.all(
    ranges.map((range, i) => pool.dispatch(pool.workers[i], range.from, range.to))
  );
  const genMs = Date.now() - genStart;
  const buffers = chunks.flat();

  let mergeMs = null;
  if (writePdf) {
    const mergeStart = Date.now();
    const merged = await mergePdfs(buffers);
    mergeMs = Date.now() - mergeStart;
    fs.writeFileSync(path.join(OUT_DIR, "merged-multi-thread.pdf"), merged);
  }

  return { genMs, mergeMs };
}

function formatRunLine(i, single, multi) {
  const fmtMerge = (ms) => (ms == null ? "—" : `${ms} ms`);
  return (
    `Koşu ${String(i).padStart(2)} | ` +
    `single: üretim ${single.genMs} ms, merge ${fmtMerge(single.mergeMs)}, toplam ${totalMs(single)} ms | ` +
    `multi:  üretim ${multi.genMs} ms, merge ${fmtMerge(multi.mergeMs)}, toplam ${totalMs(multi)} ms`
  );
}

function buildSummary(singleRuns, multiRuns) {
  const singleAvg = {
    genMs: avg(singleRuns, "genMs"),
    mergeMs: avg(singleRuns, "mergeMs"),
  };
  const multiAvg = {
    genMs: avg(multiRuns, "genMs"),
    mergeMs: avg(multiRuns, "mergeMs"),
  };

  const lastSingleMerge = singleRuns[singleRuns.length - 1].mergeMs ?? 0;
  const lastMultiMerge = multiRuns[multiRuns.length - 1].mergeMs ?? 0;
  const genSpeedup = singleAvg.genMs / multiAvg.genMs;
  const totalWithLastMerge =
    (singleAvg.genMs + lastSingleMerge) / (multiAvg.genMs + lastMultiMerge);

  const lines = [
    `PDF Benchmark Sonuçları (ağır içerik)`,
    `Runtime : ${RUNTIME}`,
    `Tarih   : ${new Date().toISOString()}`,
    `COUNT   : ${COUNT}`,
    `WORKERS : ${WORKERS} (worker pool — koşular arası yeniden kullanım)`,
    `RUNS    : ${RUNS}`,
    `PDF     : 3 sayfa (başlık + lorem + tablo + grafik), belge başına farklı içerik`,
    `Not     : Merge yalnızca son koşuda ölçülür (${COUNT} belge birleştirme çok ağır)`,
    ``,
    `--- Koşu bazlı süreler ---`,
  ];

  for (let i = 0; i < RUNS; i++) {
    lines.push(formatRunLine(i + 1, singleRuns[i], multiRuns[i]));
  }

  lines.push(
    ``,
    `--- Aritmetik ortalama (${RUNS} koşu, üretim) ---`,
    `SINGLE-THREAD`,
    `  Üretim (ort.) : ${singleAvg.genMs.toFixed(1)} ms`,
    `  Merge (son)   : ${lastSingleMerge} ms`,
  );

  if (RUNS > 1) {
    lines.push(`  Üretim (son)  : ${singleRuns[singleRuns.length - 1].genMs} ms`);
  }

  lines.push(
    ``,
    `MULTI-THREAD (${WORKERS} worker, pool)`,
    `  Üretim (ort.) : ${multiAvg.genMs.toFixed(1)} ms`,
    `  Merge (son)   : ${lastMultiMerge} ms`
  );

  if (RUNS > 1) {
    lines.push(`  Üretim (son)  : ${multiRuns[multiRuns.length - 1].genMs} ms`);
  }

  lines.push(
    ``,
    `--- Hızlanma ---`,
    `Üretim (ortalama)     : ${genSpeedup.toFixed(2)}x`,
    `Toplam (ort. üretim + son merge) : ${totalWithLastMerge.toFixed(2)}x`,
    ``,
    `PDF çıktıları: ${OUT_DIR}/`,
    `  merged-single-thread.pdf`,
    `  merged-multi-thread.pdf`
  );

  return { lines, genSpeedup, singleAvg, multiAvg };
}

async function main() {
  ensureOutDir();
  const pool = createWorkerPool(WORKERS);

  console.log(
    `Runtime: ${RUNTIME}\n` +
      `COUNT=${COUNT}, WORKERS=${WORKERS} (pool), RUNS=${RUNS}\n` +
      `PDF: 3 sayfa, lorem + tablo + grafik\n`
  );

  const singleRuns = [];
  const multiRuns = [];

  try {
    for (let i = 1; i <= RUNS; i++) {
      const writePdf = i === RUNS;
      const singleFirst = i % 2 === 1;

      let single;
      let multi;

      if (singleFirst) {
        single = await runSingleThread(writePdf);
        multi = await runMultiThread(pool, writePdf);
      } else {
        multi = await runMultiThread(pool, writePdf);
        single = await runSingleThread(writePdf);
      }

      singleRuns.push(single);
      multiRuns.push(multi);
      console.log(formatRunLine(i, single, multi));
    }
  } finally {
    await pool.terminate();
  }

  const { lines, genSpeedup } = buildSummary(singleRuns, multiRuns);

  const summaryStart = lines.findIndex((l) => l.startsWith("--- Aritmetik ortalama"));
  console.log(`\n${lines.slice(summaryStart).join("\n")}`);

  const resultsPath = path.join(OUT_DIR, "results.txt");
  fs.writeFileSync(resultsPath, lines.join("\n") + "\n");
  console.log(`\nSonuçlar yazıldı: ${resultsPath}`);
  console.log(`Üretim hızlanması (multi kazanımı): ${genSpeedup.toFixed(2)}x`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
