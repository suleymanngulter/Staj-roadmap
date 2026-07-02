/**
 * Vector DB karşılaştırması — metodoloji bilinçli, tek dosya.
 * LOCAL vs CLOUD gecikmeleri doğrudan kıyaslanmaz; recall@10 ile ANN doğruluğu ölçülür.
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { Client: PgClient } = require("pg");
const pgvector = require("pgvector/pg");
const { ChromaClient } = require("chromadb");
const { MongoClient } = require("mongodb");
const { Pinecone } = require("@pinecone-database/pinecone");

require("dotenv").config();

// --- Yapılandırma ---
const DIM = 384;
const N_VECTORS = 5_000;
const N_QUERIES = 100;
const TOP_K = 10;
const SEED = 42;
const BATCH = 500;
const QUERY_RUNS = Number(process.env.QUERY_RUNS) || 3;
const MULTI_RUNS = Number(process.env.MULTI_RUNS) || 1;

const CHROMA_HOST = process.env.CHROMA_HOST || "127.0.0.1";
const CHROMA_PORT = Number(process.env.CHROMA_PORT) || 8000;
const CHROMA_SEARCH_EF = Number(process.env.CHROMA_SEARCH_EF) || 300;
const CHROMA_PROBE_EF = Number(process.env.CHROMA_PROBE_EF) || 100;

const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "vector_bench";
const MONGODB_COLL = process.env.MONGODB_COLL || "embeddings";
const MONGODB_INDEX = process.env.MONGODB_INDEX || "vector_index";
const MONGODB_NUM_CANDIDATES = Number(process.env.MONGODB_NUM_CANDIDATES) || 100;
const MONGODB_TIER = process.env.MONGODB_TIER || "(belirtilmedi)";
const MONGODB_AUTO_EMBED = process.env.MONGODB_AUTO_EMBED !== "0";
const MONGODB_TEXT_FIELD = process.env.MONGODB_TEXT_FIELD || "text";
const MONGODB_EMBED_MODEL = process.env.MONGODB_EMBED_MODEL || "voyage-4-lite";
const MONGODB_AUTO_EMBED_N_QUERIES = MONGODB_AUTO_EMBED
  ? Number(process.env.MONGODB_AUTO_EMBED_N_QUERIES) || 10
  : N_QUERIES;
const MONGODB_EMBED_QUERY_DELAY_MS = Number(process.env.MONGODB_EMBED_QUERY_DELAY_MS) || 0;

const PINECONE_API_KEY = process.env.PINECONE_API_KEY || "";
const PINECONE_INDEX = process.env.PINECONE_INDEX || "vector-bench-384";
const PINECONE_CLOUD = process.env.PINECONE_CLOUD || "aws";
const PINECONE_REGION = process.env.PINECONE_REGION || "us-east-1";

const PG_DSN =
  process.env.PG_DSN ||
  "postgresql://postgres:postgres@127.0.0.1:5433/vector_bench";
const PG_HNSW_M = Number(process.env.PG_HNSW_M) || 16;
const PG_HNSW_EF = Number(process.env.PG_HNSW_EF) || 64;
const PG_HNSW_EF_SEARCH = Number(process.env.PG_HNSW_EF_SEARCH) || 300;
const PG_FORCE_HNSW = process.env.PG_FORCE_HNSW !== "0";

const PINECONE_RECREATE_INDEX = process.env.PINECONE_RECREATE_INDEX === "1";

const MONGO_LABEL = "MongoDB Atlas Vector";

function buildLimitations(autoEmbedPilot) {
  return [
    "=== SINIRLAMALAR — METODOLOJİ ===",
    "Bu benchmark LOCAL (127.0.0.1) ile CLOUD (internet) gecikmelerini AYNI tabloda gösterir;",
    "query ms farkının çoğu ağ RTT'sidir — saf motor hızı DEĞİLDİR. LOCAL ve CLOUD ayrı okunmalı.",
    "Insert: veri yükleme ve indeks oluşturma AYRI sütunlarda (Mongo Atlas index bekleme dahil).",
    `Recall@${TOP_K}: brute-force cosine ground truth (yalnızca ana tablo backend'leri); ANN parametreleri farklı olabilir.`,
    `pgvector: PG_FORCE_HNSW=1 → seqscan kapalı (küçük tabloda Sort=exact recall tuzağı).`,
    `Chroma: hnsw:search_ef metadata ile ayarlanır (varsayılan düşük → düşük recall).`,
    `Pinecone indexMs: varsayılan warm; Mongo manuel modda her koşuda index yeniler — PINECONE_RECREATE_INDEX=1 cold parity.`,
    "Mongo manuel testi col.drop() ile koleksiyon+index sıfırlar; Pinecone yalnızca ns.deleteAll() (vektörler) — index dokunulmaz.",
    autoEmbedPilot
      ? `MongoDB autoEmbed: ana karşılaştırma tablosunda YOK — aşağıda ayrı pilot bölüm (farklı veri + GT; ücretsiz Voyage rate limit).`
      : "MongoDB: manuel 384-dim vektör — pg/Chroma/Pinecone ile aynı cosine ground truth.",
    `Sorgu: ${QUERY_RUNS} tam tur × ${N_QUERIES} sorgu → medyan + p95.`,
    MULTI_RUNS > 1
      ? `Load/Index/Query: ${MULTI_RUNS} tam script koşusu → medyan (min–max) — CLOUD RTT varyansı dahil.`
      : `Load/Index: tek script koşusu — CLOUD için MULTI_RUNS=3 önerilir.`,
    "",
    "=== INDEX MS NASIL OKUNMALI ===",
    "Index ms sütunu, bulut servislerinin farklı temizlik/hazırlık adımlarından kaynaklanan bir test artefaktıdır;",
    "karşılaştırılabilir değildir. Üretimde bu maliyet tek seferlik ve amortize edilir;",
    "sistemler arası asıl karşılaştırma Query med/p95 ve Recall@10 üzerinden yapılmalıdır.",
  ].join("\n");
}

const OUT = path.join(__dirname, "..", "output", "result.txt");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createRng(seed) {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function unitVector(rng, dim) {
  const v = Array.from({ length: dim }, () => randn(rng));
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function makeData() {
  const rng = createRng(SEED);
  const vectors = Array.from({ length: N_VECTORS }, () => unitVector(rng, DIM));
  const queries = Array.from({ length: N_QUERIES }, () => unitVector(rng, DIM));
  const ids = vectors.map((_, i) => String(i));
  return { vectors, queries, ids };
}

/** Mongo autoEmbed: 50 kategori × 100 doküman; sorgu metni kategori hedefler */
function makeMongoTextData() {
  const nCats = 50;
  const topics = Array.from(
    { length: nCats },
    (_, c) =>
      `topic cluster ${c} ${["wireless sensors", "marine biology", "urban planning", "quantum optics", "medieval history"][c % 5]}`
  );
  const docs = Array.from({ length: N_VECTORS }, (_, i) => {
    const cat = i % nCats;
    return {
      text: `${topics[cat]} — document ${i} discusses ${topics[cat]} in detail for semantic retrieval benchmark.`,
    };
  });
  const queries = [];
  const groundTruth = [];
  for (let q = 0; q < N_QUERIES; q++) {
    const cat = q % nCats;
    queries.push(`Find documents about ${topics[cat]}`);
    const ids = [];
    for (let i = cat; i < N_VECTORS; i += nCats) ids.push(String(i));
    groundTruth.push(ids.slice(0, TOP_K));
  }
  return { docs, queries, groundTruth };
}

function cosineDot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Brute-force ground truth (unit vektörler → dot = cosine) */
function bruteForceTopK(vectors, query, k) {
  const scored = vectors.map((v, i) => ({ id: String(i), score: cosineDot(v, query) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.id);
}

function recallAtK(retrieved, truth) {
  const truthSet = new Set(truth);
  return retrieved.filter((id) => truthSet.has(id)).length / truth.length;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(nums, p) {
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

async function measureQueries(queries, groundTruth, queryFn, opts = {}) {
  const throttleBetweenMs = opts.throttleBetweenMs ?? 0;
  const latencies = [];
  let recallSum = 0;
  let throttleWaitMs = 0;

  for (let run = 0; run < QUERY_RUNS; run++) {
    for (let qi = 0; qi < queries.length; qi++) {
      if (throttleBetweenMs > 0 && (run > 0 || qi > 0)) {
        await sleep(throttleBetweenMs);
        throttleWaitMs += throttleBetweenMs;
      }
      const t0 = performance.now();
      const retrieved = await queryFn(queries[qi]);
      latencies.push(performance.now() - t0);
      if (run === 0) recallSum += recallAtK(retrieved, groundTruth[qi]);
    }
  }

  return {
    queryMed: median(latencies),
    queryP95: percentile(latencies, 95),
    recall: recallSum / queries.length,
    throttleWaitMs,
  };
}

async function connectPg() {
  let lastErr;
  for (let i = 0; i < 15; i++) {
    try {
      const client = new PgClient({ connectionString: PG_DSN });
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      await sleep(2000);
    }
  }
  throw lastErr;
}

async function connectChroma() {
  let lastErr;
  for (let i = 0; i < 15; i++) {
    try {
      const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
      await client.heartbeat();
      return client;
    } catch (err) {
      lastErr = err;
      await sleep(2000);
    }
  }
  throw lastErr;
}

function chromaMetadata(searchEf) {
  return { "hnsw:space": "cosine", "hnsw:search_ef": searchEf };
}

async function chromaInsertAll(col, vectors, ids) {
  for (let i = 0; i < N_VECTORS; i += BATCH) {
    const j = Math.min(i + BATCH, N_VECTORS);
    await col.add({ ids: ids.slice(i, j), embeddings: vectors.slice(i, j) });
  }
}

async function chromaCreateLoaded(client, name, vectors, ids, searchEf) {
  try {
    await client.deleteCollection({ name });
  } catch {
    /* yok */
  }
  const col = await client.createCollection({
    name,
    metadata: chromaMetadata(searchEf),
    embeddingFunction: null,
  });
  const t0 = performance.now();
  await chromaInsertAll(col, vectors, ids);
  return { col, loadMs: performance.now() - t0 };
}

function chromaAppliedEf(col) {
  const raw = col.metadata?.["hnsw:search_ef"];
  return raw != null ? Number(raw) : null;
}

/** Sunucudan persist edilmiş metadata (client cache değil) */
async function chromaServerSearchEf(client, name) {
  const fetched = await client.getCollection({ name, embeddingFunction: null });
  return chromaAppliedEf(fetched);
}

async function chromaRecallProbe(client, vectors, queries, ids, groundTruth, probeEf) {
  const { col } = await chromaCreateLoaded(client, "bench_probe", vectors, ids, probeEf);
  let sum = 0;
  for (let i = 0; i < queries.length; i++) {
    const res = await col.query({ queryEmbeddings: [queries[i]], nResults: TOP_K });
    sum += recallAtK(res.ids[0], groundTruth[i]);
  }
  try {
    await client.deleteCollection({ name: "bench_probe" });
  } catch {
    /* */
  }
  return sum / queries.length;
}

async function benchChroma(vectors, queries, ids, groundTruth) {
  const client = await connectChroma();
  const { col, loadMs } = await chromaCreateLoaded(client, "bench", vectors, ids, CHROMA_SEARCH_EF);

  const applied = await chromaServerSearchEf(client, "bench");
  const chromaDiag = {
    configured: CHROMA_SEARCH_EF,
    applied,
    metadataSource: "getCollection (sunucu)",
  };

  const { queryMed, queryP95, recall } = await measureQueries(queries, groundTruth, async (q) => {
    const res = await col.query({ queryEmbeddings: [q], nResults: TOP_K });
    return res.ids[0];
  });

  const recallAtProbeEf = await chromaRecallProbe(
    client, vectors, queries, ids, groundTruth, CHROMA_PROBE_EF
  );

  return {
    deploy: "LOCAL",
    loadMs,
    indexMs: 0,
    annParams: `HNSW cosine search_ef=${applied ?? CHROMA_SEARCH_EF}`,
    queryMed,
    queryP95,
    recall,
    chromaDiag,
    recallAtProbeEf,
    note: `probe@ef${CHROMA_PROBE_EF}=${(recallAtProbeEf * 100).toFixed(1)}% — search_ef runtime değiştirilemez, ayrı koleksiyon`,
    annVerify: "✓ getCollection metadata + probe (create-time search_ef; runtime SET yok)",
  };
}

async function diagnosePgvector(client, sampleQuery) {
  const show = await client.query("SHOW hnsw.ef_search");
  const efSearch = Number(Object.values(show.rows[0])[0]);
  const { rows } = await client.query(
    "EXPLAIN SELECT id FROM embeddings ORDER BY vec <=> $1::vector LIMIT $2",
    [pgvector.toSql(sampleQuery), TOP_K]
  );
  const plan = rows.map((r) => r["QUERY PLAN"]).join(" ");
  let planMode = "unknown";
  if (plan.includes("Index Scan")) planMode = "HNSW";
  else if (plan.includes("Sort") || plan.includes("Seq Scan")) planMode = "EXACT";
  return { efSearch, planMode, planSnippet: plan.slice(0, 140) };
}

/** ef_search karşılaştırması — tüm sorgu seti (ana ölçüm sonrası çalıştırılır) */
async function pgRecallProbe(client, queries, groundTruth, efSearch) {
  await client.query(`SET hnsw.ef_search = ${efSearch}`);
  if (PG_FORCE_HNSW) await client.query("SET enable_seqscan = off");
  let sum = 0;
  for (let i = 0; i < queries.length; i++) {
    const { rows } = await client.query(
      "SELECT id FROM embeddings ORDER BY vec <=> $1::vector LIMIT $2",
      [pgvector.toSql(queries[i]), TOP_K]
    );
    sum += recallAtK(rows.map((r) => String(r.id)), groundTruth[i]);
  }
  return sum / queries.length;
}

async function benchPgvector(vectors, queries, groundTruth) {
  const client = await connectPg();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pgvector.registerTypes(client);
  await client.query("DROP TABLE IF EXISTS embeddings");
  await client.query(`CREATE TABLE embeddings (id int PRIMARY KEY, vec vector(${DIM}))`);

  const loadT0 = performance.now();
  for (let i = 0; i < N_VECTORS; i += BATCH) {
    const j = Math.min(i + BATCH, N_VECTORS);
    const parts = [];
    const params = [];
    let p = 1;
    for (let k = i; k < j; k++) {
      parts.push(`($${p}, $${p + 1}::vector)`);
      params.push(k, pgvector.toSql(vectors[k]));
      p += 2;
    }
    await client.query(`INSERT INTO embeddings (id, vec) VALUES ${parts.join(",")}`, params);
  }
  const loadMs = performance.now() - loadT0;

  const indexT0 = performance.now();
  await client.query(
    `CREATE INDEX embeddings_hnsw_idx ON embeddings USING hnsw (vec vector_cosine_ops)
     WITH (m = ${PG_HNSW_M}, ef_construction = ${PG_HNSW_EF})`
  );
  const indexMs = performance.now() - indexT0;

  await client.query(`SET hnsw.ef_search = ${PG_HNSW_EF_SEARCH}`);
  if (PG_FORCE_HNSW) await client.query("SET enable_seqscan = off");

  const pgDiag = await diagnosePgvector(client, queries[0]);
  pgDiag.configured = PG_HNSW_EF_SEARCH;

  const { queryMed, queryP95, recall } = await measureQueries(queries, groundTruth, async (q) => {
    const { rows } = await client.query(
      "SELECT id FROM embeddings ORDER BY vec <=> $1::vector LIMIT $2",
      [pgvector.toSql(q), TOP_K]
    );
    return rows.map((r) => String(r.id));
  });

  const recallAtEf100 = await pgRecallProbe(client, queries, groundTruth, 100);
  await client.query(`SET hnsw.ef_search = ${PG_HNSW_EF_SEARCH}`);
  if (PG_FORCE_HNSW) await client.query("SET enable_seqscan = off");

  await client.end();
  const efOk = pgDiag.efSearch === PG_HNSW_EF_SEARCH;
  return {
    deploy: "LOCAL",
    loadMs,
    indexMs,
    annParams: `HNSW m=${PG_HNSW_M} ef=${PG_HNSW_EF} ef_search=${pgDiag.efSearch} plan=${pgDiag.planMode}`,
    queryMed,
    queryP95,
    recall,
    note: efOk
      ? `probe@ef100=${(recallAtEf100 * 100).toFixed(1)}% (${queries.length} sorgu, ana ölçümden sonra)`
      : `UYARI: .env ef_search=${PG_HNSW_EF_SEARCH} ama SHOW=${pgDiag.efSearch}`,
    pgDiag,
    recallAtEf100,
    annVerify: "✓ SHOW hnsw.ef_search + EXPLAIN + runtime ef probe (aynı tablo)",
  };
}

async function waitMongoIndex(col, name, timeoutMs = MONGODB_AUTO_EMBED ? 600_000 : 180_000) {
  const t0 = performance.now();
  const deadline = Date.now() + timeoutMs;
  let firstSeenMs = null;
  let lastStatus = null;

  while (Date.now() < deadline) {
    for await (const idx of col.listSearchIndexes()) {
      if (idx.name !== name) continue;
      if (firstSeenMs == null) firstSeenMs = performance.now() - t0;
      lastStatus = idx.status;
      if (idx.status === "READY") {
        const readyMs = performance.now() - t0;
        return {
          readyMs,
          firstSeenMs,
          readyPollAfterFirstSeenMs: firstSeenMs != null ? readyMs - firstSeenMs : readyMs,
          lastStatus,
        };
      }
    }
    await sleep(2000);
  }
  throw new Error(`Atlas search index '${name}' READY olmadı (son durum: ${lastStatus ?? "yok"})`);
}

async function mongoVectorSearch(col, vectorStage, stats, retries = 6) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const docs = await col.aggregate([vectorStage, { $project: { _id: 1 } }]).toArray();
      return docs.map((d) => String(d._id));
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const rateLimited = msg.includes("429") || msg.includes("Rate limit");
      if (!rateLimited || attempt === retries - 1) throw err;
      const waitMs = 65_000 * (attempt + 1);
      stats.rateLimitWaitMs += waitMs;
      stats.rateLimitRetries += 1;
      console.warn(`  MongoDB autoEmbed rate limit — ${waitMs / 1000}s bekleniyor (${attempt + 1}/${retries})`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function benchMongodb(vectors, queries, groundTruth, mongoText) {
  if (!MONGODB_URI) throw new Error("MONGODB_URI tanımlı değil (Atlas gerekli)");

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  const col = client.db(MONGODB_DB).collection(MONGODB_COLL);
  await col.drop().catch(() => {});

  const loadT0 = performance.now();
  if (MONGODB_AUTO_EMBED) {
    for (let i = 0; i < N_VECTORS; i += BATCH) {
      const docs = [];
      for (let k = i; k < Math.min(i + BATCH, N_VECTORS); k++) {
        docs.push({ _id: k, [MONGODB_TEXT_FIELD]: mongoText.docs[k].text });
      }
      await col.insertMany(docs);
    }
  } else {
    for (let i = 0; i < N_VECTORS; i += BATCH) {
      const docs = [];
      for (let k = i; k < Math.min(i + BATCH, N_VECTORS); k++) {
        docs.push({ _id: k, embedding: vectors[k] });
      }
      await col.insertMany(docs);
    }
  }
  const loadMs = performance.now() - loadT0;

  const indexT0 = performance.now();
  await col.createSearchIndex({
    name: MONGODB_INDEX,
    type: "vectorSearch",
    definition: MONGODB_AUTO_EMBED
      ? {
          fields: [
            {
              type: "autoEmbed",
              modality: "text",
              path: MONGODB_TEXT_FIELD,
              model: MONGODB_EMBED_MODEL,
            },
          ],
        }
      : {
          fields: [{ type: "vector", path: "embedding", numDimensions: DIM, similarity: "cosine" }],
        },
  });
  const indexDefineMs = performance.now() - indexT0;
  const indexWait = await waitMongoIndex(col, MONGODB_INDEX);
  const indexMs = indexDefineMs + indexWait.readyMs;

  const queryList = MONGODB_AUTO_EMBED ? mongoText.queries.slice(0, MONGODB_AUTO_EMBED_N_QUERIES) : queries;
  const truth = MONGODB_AUTO_EMBED
    ? mongoText.groundTruth.slice(0, MONGODB_AUTO_EMBED_N_QUERIES)
    : groundTruth;

  const queryStats = { rateLimitWaitMs: 0, rateLimitRetries: 0 };
  const throttleBetweenMs = MONGODB_AUTO_EMBED ? MONGODB_EMBED_QUERY_DELAY_MS : 0;
  const { queryMed, queryP95, recall, throttleWaitMs } = await measureQueries(
    queryList,
    truth,
    async (q) => {
      const vectorStage = MONGODB_AUTO_EMBED
        ? {
            $vectorSearch: {
              index: MONGODB_INDEX,
              path: MONGODB_TEXT_FIELD,
              query: { text: q },
              numCandidates: MONGODB_NUM_CANDIDATES,
              limit: TOP_K,
            },
          }
        : {
            $vectorSearch: {
              index: MONGODB_INDEX,
              path: "embedding",
              queryVector: q,
              numCandidates: MONGODB_NUM_CANDIDATES,
              limit: TOP_K,
            },
          };
      return mongoVectorSearch(col, vectorStage, queryStats);
    },
    { throttleBetweenMs }
  );

  await client.close();
  return {
    deploy: "CLOUD",
    pilotMode: MONGODB_AUTO_EMBED,
    loadMs,
    indexMs,
    indexDefineMs,
    indexReadyWaitMs: indexWait.readyMs,
    indexFirstSeenMs: indexWait.firstSeenMs,
    indexReadyPollAfterFirstSeenMs: indexWait.readyPollAfterFirstSeenMs,
    annParams: MONGODB_AUTO_EMBED
      ? `autoEmbed ${MONGODB_EMBED_MODEL} numCandidates=${MONGODB_NUM_CANDIDATES} tier=${MONGODB_TIER}`
      : `numCandidates=${MONGODB_NUM_CANDIDATES} tier=${MONGODB_TIER}`,
    queryMed,
    queryP95,
    recall,
    queryStats,
    throttleWaitMs,
    pilotQueryCount: queryList.length,
    note: MONGODB_AUTO_EMBED
      ? null
      : "indexMs = col.drop() sonrası mongot READY (koleksiyon+index sıfırlanır)",
    annVerify: MONGODB_AUTO_EMBED
      ? null
      : "△ Atlas HNSW parametrelerini expose etmez; yalnızca numCandidates ayarlanır",
  };
}

async function benchPinecone(vectors, queries, ids, groundTruth) {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY tanımlı değil");

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  let existing = (await pc.listIndexes()).indexes?.map((i) => i.name) || [];

  let indexMs = 0;
  let indexNote = "warm index (önceki koşudan)";

  if (PINECONE_RECREATE_INDEX && existing.includes(PINECONE_INDEX)) {
    const delT0 = performance.now();
    await pc.deleteIndex(PINECONE_INDEX);
    while ((await pc.listIndexes()).indexes?.some((i) => i.name === PINECONE_INDEX)) {
      await sleep(2000);
    }
    indexMs += performance.now() - delT0;
    existing = [];
    indexNote = "cold — index silindi + yeniden oluşturuldu";
  }

  if (!existing.includes(PINECONE_INDEX)) {
    const indexT0 = performance.now();
    await pc.createIndex({
      name: PINECONE_INDEX,
      dimension: DIM,
      metric: "cosine",
      spec: { serverless: { cloud: PINECONE_CLOUD, region: PINECONE_REGION } },
    });
    while (!(await pc.describeIndex(PINECONE_INDEX)).status?.ready) await sleep(1000);
    indexMs += performance.now() - indexT0;
    if (!PINECONE_RECREATE_INDEX) indexNote = "yeni index oluşturuldu";
  }

  const index = pc.index(PINECONE_INDEX);
  const ns = index.namespace("bench");
  try {
    await ns.deleteAll();
  } catch {
    /* boş namespace */
  }

  const loadT0 = performance.now();
  for (let i = 0; i < N_VECTORS; i += BATCH) {
    const j = Math.min(i + BATCH, N_VECTORS);
    const records = [];
    for (let k = i; k < j; k++) records.push({ id: ids[k], values: vectors[k] });
    await ns.upsert(records);
  }
  const loadMs = performance.now() - loadT0;

  const { queryMed, queryP95, recall } = await measureQueries(queries, groundTruth, async (q) => {
    const res = await ns.query({ vector: q, topK: TOP_K });
    return (res.matches || []).map((m) => m.id);
  });

  return {
    deploy: "CLOUD",
    loadMs,
    indexMs,
    annParams: `serverless ${PINECONE_CLOUD}/${PINECONE_REGION} (varsayılan ANN)`,
    queryMed,
    queryP95,
    recall,
    note: PINECONE_RECREATE_INDEX
      ? indexNote
      : indexMs > 0
        ? indexNote
        : "warm index — yalnızca ns.deleteAll(); index dokunulmaz",
    annVerify: "△ Search breadth servis tarafından yönetilir; kullanıcı probe yapamaz",
  };
}

async function runOne(label, fn) {
  try {
    const r = await fn();
    return { backend: label, status: "OK", ...r };
  } catch (err) {
    return {
      backend: label,
      deploy: "—",
      loadMs: null,
      indexMs: null,
      queryMed: null,
      queryP95: null,
      recall: null,
      annParams: "—",
      status: `ATLANDI — ${err.message}`,
    };
  }
}

function fmtNum(v, w) {
  if (v == null) return "—".padStart(w);
  if (typeof v === "number" && v <= 1 && v >= 0 && w < 10) {
    return `${(v * 100).toFixed(1)}%`.padStart(w);
  }
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).padStart(w);
}

function fmtMsSpread(medianVal, spread) {
  if (medianVal == null) return "—";
  if (!spread) return fmtNum(medianVal, 10).trim();
  return `${medianVal.toFixed(0)} (${spread})`;
}

function spreadRange(values) {
  if (values.length <= 1) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `${min.toFixed(0)}–${max.toFixed(0)}`;
}

function mergeMultiRuns(allRuns) {
  const backends = allRuns[0].map((r) => r.backend);
  return backends.map((backend) => {
    const samples = allRuns
      .map((run) => run.find((r) => r.backend === backend))
      .filter((r) => r && r.status === "OK");
    const failed = allRuns.map((run) => run.find((r) => r.backend === backend)).find((r) => r?.status !== "OK");
    if (!samples.length) return failed || allRuns[0].find((r) => r.backend === backend);

    const pick = (key) => samples.map((s) => s[key]).filter((v) => v != null);
    const last = samples[samples.length - 1];
    return {
      ...last,
      loadMs: median(pick("loadMs")),
      indexMs: median(pick("indexMs")),
      queryMed: median(pick("queryMed")),
      queryP95: median(pick("queryP95")),
      recall: median(pick("recall")),
      loadSpread: spreadRange(pick("loadMs")),
      indexSpread: spreadRange(pick("indexMs")),
      queryMedSpread: spreadRange(pick("queryMed")),
      queryP95Spread: spreadRange(pick("queryP95")),
      multiRuns: samples.length,
    };
  });
}

function partitionRows(rows) {
  const mongoIsPilot = (r) => r.backend === MONGO_LABEL && (r.pilotMode || MONGODB_AUTO_EMBED);
  const pilot = rows.find(mongoIsPilot);
  const comparable = rows.filter((r) => !mongoIsPilot(r));
  return { comparable, pilot };
}

function appendLoadIndexTable(lines, rows, w, sep) {
  lines.push(
    "YÜKLEME + İNDEKS",
    sep,
    [
      "Backend".padEnd(w.name),
      "Konum".padEnd(w.dep),
      "Load ms".padStart(w.load),
      "Index ms".padStart(w.idx),
      `Recall@${TOP_K}`.padStart(w.rec),
      "ANN / ortam",
    ].join(" | "),
    sep
  );

  for (const r of rows) {
    if (r.status !== "OK") {
      lines.push(`${r.backend.padEnd(w.name)} | ${r.status}`);
      continue;
    }
    lines.push(
      [
        r.backend.padEnd(w.name),
        r.deploy.padEnd(w.dep),
        (r.loadSpread ? fmtMsSpread(r.loadMs, r.loadSpread) : fmtNum(r.loadMs, w.load)).padStart(w.load),
        (r.indexSpread ? fmtMsSpread(r.indexMs, r.indexSpread) : fmtNum(r.indexMs, w.idx)).padStart(w.idx),
        fmtNum(r.recall, w.rec),
        r.annParams,
      ].join(" | ")
    );
    if (r.note && r.backend !== "PostgreSQL pgvector" && r.backend !== "ChromaDB") {
      lines.push(`  Not: ${r.note}`);
    }
  }
}

function appendQueryTable(lines, rows, w, sep) {
  lines.push("", "SORGU GECİKMESİ (LOCAL vs CLOUD ayrı yorumlanmalı)", sep);
  lines.push(
    [
      "Backend".padEnd(w.name),
      "Konum".padEnd(w.dep),
      "Query med".padStart(w.qmed),
      "Query p95".padStart(w.qp95),
      `Recall@${TOP_K}`.padStart(w.rec),
    ].join(" | ")
  );
  lines.push(sep);

  for (const r of rows) {
    if (r.status !== "OK") continue;
    const qMed = r.queryMedSpread
      ? fmtMsSpread(r.queryMed, r.queryMedSpread)
      : fmtNum(r.queryMed, w.qmed).trim();
    const qP95 = r.queryP95Spread
      ? fmtMsSpread(r.queryP95, r.queryP95Spread)
      : fmtNum(r.queryP95, w.qp95).trim();
    lines.push(
      [
        r.backend.padEnd(w.name),
        r.deploy.padEnd(w.dep),
        qMed.padStart(w.qmed),
        qP95.padStart(w.qp95),
        fmtNum(r.recall, w.rec),
      ].join(" | ")
    );
  }
}

function appendQuerySummary(lines, comparable) {
  const local = comparable.filter((r) => r.deploy === "LOCAL" && r.status === "OK");
  const cloud = comparable.filter((r) => r.deploy === "CLOUD" && r.status === "OK");
  if (!local.length || !cloud.length) return;

  lines.push(
    "",
    "ÖZET (ana tablo — autoEmbed pilot hariç): Query ms — LOCAL ort. medyan ~" +
      fmtNum(median(local.map((r) => r.queryMed)), 6).trim() +
      " | CLOUD ort. medyan ~" +
      fmtNum(median(cloud.map((r) => r.queryMed)), 6).trim() +
      " (ağ RTT farkı beklenir; yalnızca manuel vektör backend'leri)"
  );
}

function buildMongoPilotSection(pilot, w, sep) {
  const throttlePerGap = MONGODB_EMBED_QUERY_DELAY_MS;
  const queryCount = pilot?.pilotQueryCount ?? MONGODB_AUTO_EMBED_N_QUERIES;
  const throttleGaps =
    throttlePerGap > 0 ? Math.max(0, QUERY_RUNS * queryCount - 1) : 0;

  const lines = [
    "",
    "=== MONGODB ATLAS AUTOMATED EMBEDDING — AYRI PİLOT (ANA TABLOYA DAHİL DEĞİL) ===",
    "Üretim performansını yansıtmaz; farklı veri seti + kategori GT. Query med/p95 yalnızca Atlas çağrı süresidir.",
    "MONGODB_EMBED_QUERY_DELAY_MS varsa sorgular arası önleyici bekleme — query metriklerine DAHİL DEĞİLDİR.",
    "",
    "Veri seti (ana benchmark'tan FARKLI):",
    `  • ${N_VECTORS.toLocaleString()} sentetik metin belgesi (50 kategori × ${N_VECTORS / 50} doc/id); Gauss birim vektörü DEĞİL`,
    "  • Sorgu: doğal dil metni (Voyage autoEmbed); GT: kategori-id eşlemesi — cosine brute-force GT değil",
    `  • Sorgu örneklemi: ${MONGODB_AUTO_EMBED_N_QUERIES} / ${N_QUERIES} × ${QUERY_RUNS} tur — istatistiksel olarak sınırlı`,
    `  • Model: ${MONGODB_EMBED_MODEL} | tier: ${MONGODB_TIER}`,
    "",
  ];

  if (!pilot || pilot.status !== "OK") {
    const reason = pilot?.status ?? "MongoDB koşusu yok";
    lines.push(`Pilot sonucu: ${reason}`);
    return lines.join("\n");
  }

  lines.push(
    "PİLOT METRİKLER (query = yalnızca Atlas $vectorSearch süresi)",
    sep,
    [
      "Load ms".padStart(w.load),
      "Index READY ms".padStart(w.idx),
      "Query net med".padStart(w.qmed),
      "Query net p95".padStart(w.qp95),
      `Recall@${TOP_K}`.padStart(w.rec),
    ].join(" | "),
    sep,
    [
      fmtNum(pilot.loadMs, w.load).trim().padStart(w.load),
      fmtNum(pilot.indexReadyWaitMs ?? pilot.indexMs, w.idx).trim().padStart(w.idx),
      fmtNum(pilot.queryMed, w.qmed).trim().padStart(w.qmed),
      fmtNum(pilot.queryP95, w.qp95).trim().padStart(w.qp95),
      fmtNum(pilot.recall, w.rec),
    ].join(" | "),
    "",
    "İNDEKS HAZIRLIK (Atlas API embedding ile mongot READY süresini ayırmaz):",
    `  createSearchIndex çağrısı          : ${pilot.indexDefineMs?.toFixed(1) ?? "—"} ms`,
    `  İlk indeks kaydı görülme           : ${pilot.indexFirstSeenMs?.toFixed(1) ?? "—"} ms`,
    `  READY olana kadar toplam bekleme   : ${(pilot.indexReadyWaitMs ?? pilot.indexMs)?.toFixed(1) ?? "—"} ms`,
    `  İlk kayıttan READY'ye kadar bekleme: ${pilot.indexReadyPollAfterFirstSeenMs?.toFixed(1) ?? "—"} ms`,
    "",
    "SORGU THROTTLE / RATE LIMIT (query metriklerinden ayrı):",
    `  MONGODB_EMBED_QUERY_DELAY_MS       : ${throttlePerGap} (sorgular arası; ölçüme dahil değil)`,
    `  Önleyici throttle toplamı          : ${((pilot.throttleWaitMs ?? 0) / 1000).toFixed(1)} s (${throttleGaps} ara bekleme)`,
    `  Voyage 429 backoff toplamı         : ${((pilot.queryStats?.rateLimitWaitMs ?? 0) / 1000).toFixed(1)} s (${pilot.queryStats?.rateLimitRetries ?? 0} retry)`,
    "",
    `Recall@${TOP_K} düşükse: kategori-tabanlı GT ile semantik arama uyumsuzluğu olabilir — ana tablo recall'ü ile kıyaslamayın.`
  );

  return lines.join("\n");
}

function buildReport(rows) {
  const w = { name: 26, dep: 6, load: 10, idx: 10, qmed: 10, qp95: 10, rec: 8 };
  const sep = "-".repeat(95);
  const { comparable, pilot } = partitionRows(rows);
  const autoEmbedPilot = Boolean(pilot);

  const lines = [
    "Vector DB Benchmark — metodoloji bilinçli karşılaştırma",
    "=".repeat(95),
    `Ana tablo veri: ${N_VECTORS.toLocaleString()} Gauss birim vektör × ${DIM} | ${N_QUERIES} sorgu × ${QUERY_RUNS} tur | Top-K=${TOP_K}`,
    `Script koşusu: ${MULTI_RUNS}× | Tarih: ${new Date().toISOString()}`,
    "",
    buildLimitations(autoEmbedPilot),
    "",
  ];

  appendLoadIndexTable(lines, comparable, w, sep);
  appendQueryTable(lines, comparable, w, sep);
  appendQuerySummary(lines, comparable);

  const pg = comparable.find((r) => r.backend === "PostgreSQL pgvector" && r.pgDiag);
  if (pg) {
    lines.push(
      "",
      "PGVECTOR TEŞHİS",
      sep,
      `  Yapılandırma ef_search  : ${pg.pgDiag.configured}`,
      `  SHOW hnsw.ef_search     : ${pg.pgDiag.efSearch}${pg.pgDiag.efSearch !== pg.pgDiag.configured ? "  ← UYARI: .env ile uyuşmuyor" : ""}`,
      `  EXPLAIN plan modu      : ${pg.pgDiag.planMode} (EXACT=Sort/SeqScan → recall %100, ANN değil)`,
      `  Plan                   : ${pg.pgDiag.planSnippet}`,
      `  Ana ölçüm recall@${TOP_K}  : ${(pg.recall * 100).toFixed(1)}% (ef_search=${pg.pgDiag.efSearch})`,
      `  Probe recall@${TOP_K}@ef100: ${(pg.recallAtEf100 * 100).toFixed(1)}% (${N_QUERIES} sorgu; ef_search↑ → recall↑ beklenir)`,
      `  ${pg.note}`
    );
  }

  const ch = comparable.find((r) => r.backend === "ChromaDB" && r.chromaDiag);
  if (ch) {
    const applied = ch.chromaDiag.applied;
    const efOk = applied == null || applied === CHROMA_SEARCH_EF;
    lines.push(
      "",
      "CHROMADB TEŞHİS",
      sep,
      `  Yapılandırma search_ef  : ${ch.chromaDiag.configured}`,
      `  Sunucu metadata (${ch.chromaDiag.metadataSource}): hnsw:search_ef=${applied ?? "?"}${
        !efOk ? "  ← UYARI: .env ile uyuşmuyor" : ""
      }`,
      `  Probe yöntemi           : Ayrı koleksiyon — search_ef yalnızca create-time ayarlanır (pgvector SET gibi runtime yok)`,
      `  Ana ölçüm recall@${TOP_K}  : ${(ch.recall * 100).toFixed(1)}% (search_ef=${applied ?? CHROMA_SEARCH_EF})`,
      `  Probe recall@${TOP_K}@ef${CHROMA_PROBE_EF}: ${(ch.recallAtProbeEf * 100).toFixed(1)}% (${N_QUERIES} sorgu; search_ef↑ → recall↑ beklenir)`,
      `  ${ch.note}`
    );
  }

  lines.push("", "ANN PARAMETRE DOĞRULAMA (ana tablo)", sep);
  for (const r of comparable) {
    if (r.status !== "OK" || !r.annVerify) continue;
    lines.push(`  ${r.backend.padEnd(26)} ${r.annVerify}`);
  }

  if (autoEmbedPilot) {
    lines.push(buildMongoPilotSection(pilot, w, sep));
  }

  return lines.join("\n");
}

async function runSuite(vectors, queries, ids, groundTruth, mongoText) {
  return [
    await runOne("ChromaDB", () => benchChroma(vectors, queries, ids, groundTruth)),
    await runOne("PostgreSQL pgvector", () => benchPgvector(vectors, queries, groundTruth)),
    await runOne("MongoDB Atlas Vector", () => benchMongodb(vectors, queries, groundTruth, mongoText)),
    await runOne("Pinecone", () => benchPinecone(vectors, queries, ids, groundTruth)),
  ];
}

async function main() {
  const { vectors, queries, ids } = makeData();
  const mongoText = MONGODB_AUTO_EMBED ? makeMongoTextData() : null;
  console.log(`Ground truth hesaplanıyor (${N_QUERIES} sorgu, brute-force)...`);
  const groundTruth = queries.map((q) => bruteForceTopK(vectors, q, TOP_K));
  console.log(`Veri hazır: ${N_VECTORS} vektör, ${N_QUERIES} sorgu, ${QUERY_RUNS} tur`);
  if (MONGODB_AUTO_EMBED) {
    console.log(
      `MongoDB autoEmbed: ayrı pilot bölüm (${MONGODB_EMBED_MODEL}, ${MONGODB_AUTO_EMBED_N_QUERIES} metin sorgusu)`
    );
  }
  console.log(
    `ANN: pg ef_search=${PG_HNSW_EF_SEARCH} | Chroma search_ef=${CHROMA_SEARCH_EF} | script×${MULTI_RUNS}\n`
  );

  const allRuns = [];
  for (let i = 0; i < MULTI_RUNS; i++) {
    if (MULTI_RUNS > 1) console.log(`\n── Script koşusu ${i + 1}/${MULTI_RUNS} ──`);
    allRuns.push(await runSuite(vectors, queries, ids, groundTruth, mongoText));
  }

  const rows = MULTI_RUNS > 1 ? mergeMultiRuns(allRuns) : allRuns[0];

  const report = buildReport(rows);
  console.log(report);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${report}\n`, "utf8");
  console.log(`\nRapor: ${OUT}`);

  process.exit(rows.every((r) => r.status !== "OK") ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
