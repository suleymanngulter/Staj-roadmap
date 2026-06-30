# MongoDB — Normal Index vs Sparse Index

Büyük veri setinde (`users` koleksiyonu) `vipCouponCode` alanının yalnızca **%5**'inde
bulunması senaryosuyla normal ve sparse indeksin **sorgu süresi** ile **depolama**
farkını ölçer.

## Mimari

```
nodejs/src/
  database.js      — MongoDB bağlantısı (native driver)
  seeder.js        — 2M+ sahte kullanıcı (bulkWrite batch)
  indexManager.js  — createNormalIndex / createSparseIndex / drop
  benchmark.js     — tekrarlı ölçüm + explain + collStats
  tests.js         — sparse/null/boş string + negatif sorgu testleri
  server.js        — Express CRUD API
```

## Sparse vs Normal

| | Normal indeks | Sparse indeks |
|---|---------------|---------------|
| Alan yok | null girişi indekslenir | İndekse girmez |
| `null` / `""` set | İndekste yer alır | İndekste yer alır (alan var sayılır) |
| Boyut (~2M, %5 VIP) | Büyük | Küçük |
| Sorgu | IXSCAN | IXSCAN |

**unique neden yok?** `users` içinde aynı kampanya kodunu (TEST_CODE) birden fazla
kullanıcı paylaşabilir. Tekil kupon tanımı için ayrı `coupons` koleksiyonunda
`{ unique: true, sparse: true }` kullanın.

## Çalıştırma

```bash
cd 15-mongodb-sparse-index && docker compose up -d
cd nodejs && cp .env.example .env && npm install

npm run seed          # varsayılan 2M kayıt
npm run benchmark     # 5 tekrar, pozitif + negatif sorgu → output/result.txt
npm test              # sparse kenar durumları
npm start             # API :3015
```

## Benchmark metodolojisi

- **Süre:** İstemci tarafında `BENCHMARK_RUNS` (varsayılan 5) tekrar; ortalama + medyan.
  `executionTimeMillis` tek ölçümde 0ms gösterebildiği için kullanılmıyor.
- **İndeks boyutu:** `collStats.indexSizes["vipCouponCode_1"]` — yalnızca B-tree footprint (byte).
  `storageSize` veya `totalIndexSize` değil.
- **Negatif sorgu:** Var olmayan kod ile IXSCAN doğrulaması (COLLSCAN olmamalı).

## 2M kayıt sonuçları

`SEED_COUNT=2000000` + `npm run benchmark` (5 tekrar, bu ortam):

```
Koleksiyon: 2,000,000 kayıt | TEST_CODE eşleşen: 4,000
İndeks boyutu: collStats.indexSizes (B-tree footprint, byte)

Pozitif sorgu (vipCouponCode = TEST_CODE):
Senaryo      Ort(ms)  Med(ms)    Döküman      Key     Stage  İndeks MB
İndeks yok     444.71   443.08    2000000        0  COLLSCAN         —
Normal          21.65    19.26       4000     4000    IXSCAN       9.56
Sparse          20.31    18.92       4000     4000    IXSCAN       1.68

Negatif sorgu (___NONEXISTENT_VIP___ — kayıt yok):
Senaryo      Ort(ms)  Med(ms)    Döküman      Key     Stage
İndeks yok     452.64   455.44    2000000        0  COLLSCAN
Normal           0.85     0.83          0        0    IXSCAN
Sparse           0.66     0.72          0        0    IXSCAN
```

Özet: sparse indeks **~5.7× daha küçük** (9.56 vs 1.68 MB); pozitif sorguda COLLSCAN
~444ms → IXSCAN ~20ms. Negatif sorguda da IXSCAN (COLLSCAN yok).

## API — vipCouponCode kuralları

- Boş string (`""`) **reddedilir** — sparse indeksi kirletir.
- Kupon kaldırmak: `PUT` body'de `"vipCouponCode": null` → `$unset` (alan tamamen silinir).

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `SEED_COUNT` | 2000000 | Tohumlanacak kullanıcı |
| `BATCH_SIZE` | 10000 | bulkWrite batch |
| `BENCHMARK_RUNS` | 5 | Sorgu tekrar sayısı |
| `BENCHMARK_QUERY_CODE` | TEST_CODE | Pozitif sorgu |
| `BENCHMARK_NEGATIVE_CODE` | ___NONEXISTENT_VIP___ | Negatif sorgu |
| `PORT` | 3015 | Express |
