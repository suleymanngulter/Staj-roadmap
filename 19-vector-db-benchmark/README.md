# Vector DB Benchmark — MongoDB Atlas, ChromaDB, Pinecone, pgvector

384 boyutlu **5.000** vektör ve **100** sorgu ile dört vektör veritabanını karşılaştırır.

**Önemli:** Bu benchmark motor hızından çok **LOCAL vs CLOUD mimarisini** gösterir.
Rapor bunu açıkça belirtir; query gecikmelerini doğrudan kıyaslamayın.

| Backend | Konum | Gereksinim |
|---------|-------|------------|
| ChromaDB | LOCAL (127.0.0.1) | `docker compose` (8000) |
| PostgreSQL pgvector | LOCAL | `docker compose` (5433) |
| MongoDB Atlas Vector | CLOUD | Atlas URI + Vector Search |
| Pinecone | CLOUD | API key + serverless |

## Çalıştırma

```bash
cd 19-vector-db-benchmark
docker compose up -d

cd nodejs
cp .env.example .env
npm install
npm start
```

Sonuçlar: terminal + `nodejs/output/result.txt`

## Metrikler

| Metrik | Açıklama |
|--------|----------|
| Load ms | Yalnızca vektör yükleme (insert/upsert) |
| Index ms | İndeks oluşturma / Atlas READY bekleme (Mongo ayrı sütun) |
| Query med / p95 | `QUERY_RUNS` tur × 100 sorgu |
| Recall@10 | Brute-force cosine ground truth ile ANN doğruluğu |

**Karşılaştırılabilir metrikler:** Query med/p95 ve Recall@10. Index ms üretimde tek seferlik (amortize) kurulum maliyetidir; bulut backend'leri arasında doğrudan kıyaslanmamalıdır.

## Index ms nasıl okunmalı?

- **MongoDB Atlas:** Her koşuda `col.drop()` — koleksiyon ve search index sıfırlanır, `mongot` indeksi yeniden inşa edilir.
- **Pinecone:** `ns.deleteAll()` — yalnızca vektörler silinir; index dokunulmaz (warm).
- **Sonuç:** Index ms sütunu farklı temizlik seviyelerinden kaynaklanan bir test artefaktıdır. Üretimde bu maliyet bir kez ödenir; asıl karşılaştırma **Query med/p95** ve **Recall@10** üzerinden yapılmalıdır.

## Ortam değişkenleri

| Değişken | Varsayılan |
|----------|------------|
| `CHROMA_SEARCH_EF` / `CHROMA_PROBE_EF` | `300` / `100` |
| `QUERY_RUNS` | `3` (sorgu turu) |
| `MULTI_RUNS` | `1` — `npm run benchmark:multi` → 3 tam koşu, load/index min–max |
| `MONGODB_NUM_CANDIDATES` | `100` |
| `MONGODB_TIER` | `(belirtilmedi)` — raporda gösterilir |
| `PG_HNSW_M` / `PG_HNSW_EF` / `PG_HNSW_EF_SEARCH` | `16` / `64` / `300` |
| `PG_FORCE_HNSW` | `1` — seqscan kapalı, gerçek HNSW ANN |
| `PINECONE_RECREATE_INDEX` | `0` — `1` = Mongo ile cold index parity |
| `PINECONE_CLOUD` / `PINECONE_REGION` | `aws` / `us-east-1` |

## Metodoloji notları

1. **LOCAL vs CLOUD:** Chroma/pgvector localhost; Atlas/Pinecone internet RTT içerir.
2. **Mongo indexMs:** `mongot` indeksinin READY olması beklenir — ham insert değildir.
3. **Recall@10:** ANN parametreleri backend'ler arası tam eşit değil; recall farkı okunmalı.
4. **Chroma search_ef:** `hnsw:search_ef` metadata — düşük varsayılan düşük recall (pgvector `ef_search` ile aynı kategori).
5. **pgvector tuzağı:** Küçük tabloda yüksek `ef_search` planner'ı Sort/SeqScan'e iter; `PG_FORCE_HNSW=1` bunu engeller.
6. **Pinecone vs Mongo temizlik:** Mongo `col.drop()` (koleksiyon+index); Pinecone `deleteAll()` (yalnızca vektör). `PINECONE_RECREATE_INDEX=1` ile cold index parity.
7. **Index ms:** Tek seferlik kurulum maliyeti; karşılaştırma Query med/p95 + Recall@10 ile yapılır.
8. **CLOUD varyans:** `npm run benchmark:multi` (MULTI_RUNS=3) → load/index/query medyan (min–max).
9. Adil motor kıyası için tüm servisler aynı bölgedeki bir VM'den veya tamamı self-hosted olmalıdır.
