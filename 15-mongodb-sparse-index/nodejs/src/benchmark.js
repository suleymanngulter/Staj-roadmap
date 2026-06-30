const fs = require("fs");
const path = require("path");
const {
  dropVipIndex,
  createNormalIndex,
  createSparseIndex,
  INDEX_NAME,
} = require("./indexManager");
const { getUsersCollection, close } = require("./database");

const QUERY_CODE = process.env.BENCHMARK_QUERY_CODE || "TEST_CODE";
const NEGATIVE_CODE = process.env.BENCHMARK_NEGATIVE_CODE || "___NONEXISTENT_VIP___";
const RUNS = Number(process.env.BENCHMARK_RUNS) || 5;

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function winningStage(plan) {
  const p = plan?.queryPlanner?.winningPlan;
  if (!p) return "?";
  if (p.inputStage?.stage === "IXSCAN" || p.stage === "IXSCAN") return "IXSCAN";
  if (p.stage === "COLLSCAN") return "COLLSCAN";
  return p.inputStage?.stage ?? p.stage ?? "?";
}

/**
 * explain("executionStats") — plan ve taranan döküman/key sayısı (tek ölçüm yeterli).
 * Süre için executionTimeMillis yerine istemci tarafında tekrarlı ölçüm kullanıyoruz;
 * executionTimeMillis tek sorguda 0ms gösterebilir (çözünürlük + OS cache).
 */
async function explainOnce(col, code) {
  const explained = await col.find({ vipCouponCode: code }).explain("executionStats");
  const stats = explained.executionStats;
  return {
    docsExamined: stats.totalDocsExamined ?? 0,
    keysExamined: stats.totalKeysExamined ?? 0,
    stage: winningStage(explained),
  };
}

/** Her senaryoda ısınma + RUNS kez gerçek find; medyan/ort ms raporla. */
async function measureQueryRepeated(col, code) {
  await col.find({ vipCouponCode: code }).limit(1).toArray();

  const timings = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await col.find({ vipCouponCode: code }).toArray();
    timings.push(performance.now() - t0);
  }

  timings.sort((a, b) => a - b);
  const plan = await explainOnce(col, code);

  return {
    msAvg: avg(timings),
    msMedian: median(timings),
    msMin: timings[0],
    msMax: timings[timings.length - 1],
    ...plan,
  };
}

/**
 * collStats.indexSizes — yalnızca B-tree indeks yapısının bellek/disk ayak izi (byte).
 * storageSize veya totalIndexSize DEĞİL; doğrudan indexSizes["vipCouponCode_1"].
 */
async function measureIndexSize(col) {
  const stats = await col.db.command({ collStats: col.collectionName });
  const bytes = stats.indexSizes?.[INDEX_NAME] ?? 0;
  return {
    bytes,
    mb: bytes / (1024 * 1024),
    source: `collStats.indexSizes["${INDEX_NAME}"]`,
  };
}

async function runScenario(label, setupIndex) {
  await dropVipIndex();
  if (setupIndex) await setupIndex();

  const col = await getUsersCollection();
  const positive = await measureQueryRepeated(col, QUERY_CODE);
  const negative = await measureQueryRepeated(col, NEGATIVE_CODE);
  const index = await measureIndexSize(col);

  return {
    label,
    positive,
    negative,
    indexBytes: index.bytes,
    indexMb: index.mb,
    indexSource: index.source,
  };
}

function fmtMs(n) {
  return n.toFixed(2);
}

function buildConclusions(rows, total) {
  const normal = rows.find((r) => r.label === "Normal");
  const sparse = rows.find((r) => r.label === "Sparse");
  const none = rows.find((r) => r.label === "İndeks yok");
  const ratio =
    normal && sparse && sparse.indexMb > 0
      ? (normal.indexMb / sparse.indexMb).toFixed(1)
      : "—";

  return `
--- Çıkarımlar ---

1. Sorgu performansı (pozitif)
   İndeks olmadan COLLSCAN tüm koleksiyonu tarar (${none?.positive.docsExamined.toLocaleString()} döküman,
   medyan ~${fmtMs(none?.positive.msMedian ?? 0)} ms). Normal ve sparse indeksler IXSCAN kullanır;
   taranan döküman sayısı eşleşen kayıtlarla sınırlı kalır (~${sparse?.positive.docsExamined.toLocaleString()}).
   Bu ölçekte okuma hızları birbirine yakındır (normal medyan ${fmtMs(normal?.positive.msMedian ?? 0)} ms,
   sparse medyan ${fmtMs(sparse?.positive.msMedian ?? 0)} ms).

2. Depolama (indexSizes)
   Normal indeks: ${normal?.indexMb.toFixed(2) ?? "—"} MB — alanı olmayan ~%95 döküman için null girişi tutar.
   Sparse indeks: ${sparse?.indexMb.toFixed(2) ?? "—"} MB — yalnızca vipCouponCode alanı olan ~%5 dökümanı indeksler.
   Oran: sparse yaklaşık ${ratio}× daha küçük (RAM/disk ve yazma maliyeti düşer).

3. Negatif sorgu (kayıt yok)
   Var olmayan kodla arama: indeks varken IXSCAN, COLLSCAN değil.
   Eşleşme olmasa bile B-tree üzerinde arama yapılır; koleksiyon taranmaz.

4. Sparse indeks ne zaman?
   Alan çoğu dökümanda yoksa (opsiyonel VIP, soft-delete flag, geçici kupon) sparse tercih edilir.
   null veya "" değer set edilirse alan "var" sayılır — API'de boş string reddedilir, kaldırmak için $unset kullanılır.

5. unique constraint
   users koleksiyonunda aynı kampanya kodunu birden fazla kullanıcı paylaşabilir; unique burada yok.
   Tekil kupon tanımı için ayrı coupons koleksiyonunda { unique: true, sparse: true } kullanılmalı.

6. Üretim kararı (${total.toLocaleString()} kayıt)
   Okuma hızı: her iki indeks tipi de yeterli → asıl fark depolama ve INSERT/UPDATE indeks maliyeti.
   %5 doluluk oranında sparse indeks belirgin tasarruf sağlar; normal indeks gereksiz ~${((normal?.indexMb ?? 0) - (sparse?.indexMb ?? 0)).toFixed(2)} MB harcar.
`;
}

function buildReport(rows, total, matchCount) {
  const lines = [];
  const push = (s = "") => lines.push(s);

  push("MongoDB Normal vs Sparse Index Benchmark");
  push(`Tarih          : ${new Date().toISOString()}`);
  push(`Koleksiyon     : users`);
  push(`Kayıt sayısı   : ${total.toLocaleString()}`);
  push(`VIP oranı      : ~%5 (vipCouponCode alanı yalnızca VIP kullanıcılarda)`);
  push(`Pozitif sorgu  : vipCouponCode = "${QUERY_CODE}" (${matchCount.toLocaleString()} eşleşen)`);
  push(`Negatif sorgu  : vipCouponCode = "${NEGATIVE_CODE}"`);
  push(`Tekrar (RUNS)  : ${RUNS} (ısınma + istemci tarafı ort/medyan ms)`);
  push(`İndeks boyutu  : collStats.indexSizes["vipCouponCode_1"] (B-tree footprint, byte)`);
  push("");

  push("--- Pozitif sorgu ---");
  push(
    [
      "Senaryo".padEnd(12),
      "Ort(ms)".padStart(8),
      "Med(ms)".padStart(8),
      "Döküman".padStart(10),
      "Key".padStart(8),
      "Stage".padStart(9),
      "İndeks MB".padStart(10),
    ].join(" | ")
  );
  for (const r of rows) {
    const p = r.positive;
    push(
      [
        r.label.padEnd(12),
        fmtMs(p.msAvg).padStart(8),
        fmtMs(p.msMedian).padStart(8),
        String(p.docsExamined).padStart(10),
        String(p.keysExamined).padStart(8),
        p.stage.padStart(9),
        r.indexBytes === 0 ? "—".padStart(10) : r.indexMb.toFixed(2).padStart(10),
      ].join(" | ")
    );
  }

  push("");
  push("--- Negatif sorgu (kayıt yok) ---");
  push(
    [
      "Senaryo".padEnd(12),
      "Ort(ms)".padStart(8),
      "Med(ms)".padStart(8),
      "Döküman".padStart(10),
      "Key".padStart(8),
      "Stage".padStart(9),
    ].join(" | ")
  );
  for (const r of rows) {
    const n = r.negative;
    push(
      [
        r.label.padEnd(12),
        fmtMs(n.msAvg).padStart(8),
        fmtMs(n.msMedian).padStart(8),
        String(n.docsExamined).padStart(10),
        String(n.keysExamined).padStart(8),
        n.stage.padStart(9),
      ].join(" | ")
    );
  }

  push(buildConclusions(rows, total));
  return lines.join("\n");
}

function writeReport(report) {
  const dir = path.join(__dirname, "..", "output");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "result.txt");
  fs.writeFileSync(file, report, "utf8");
  console.log(`\nRapor yazıldı: ${file}`);
}

function printTable(rows, total, matchCount) {
  const report = buildReport(rows, total, matchCount);
  console.log(report);
  writeReport(report);

  if (total < 500_000) {
    console.log("\n⚠ Uyarı: <500K kayıt — tam ölçek için SEED_COUNT=2000000 npm run seed");
  }
}

async function main() {
  const col = await getUsersCollection();
  const total = await col.estimatedDocumentCount();
  const matchCount = await col.countDocuments({ vipCouponCode: QUERY_CODE });

  if (total < 10_000) {
    console.warn(`Uyarı: sadece ${total} kayıt var. Önce npm run seed çalıştırın.`);
  }

  console.log("Benchmark başlıyor...");

  const rows = [];
  rows.push(await runScenario("İndeks yok", null));
  rows.push(await runScenario("Normal", createNormalIndex));
  rows.push(await runScenario("Sparse", createSparseIndex));

  printTable(rows, total, matchCount);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => close());
