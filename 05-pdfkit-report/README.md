# PDF Benchmark — Node.js vs Bun vs Deno

Aynı iş yükünü üç runtime'da karşılaştırır: **seri** (tek thread) vs **paralel** (worker pool).

Her klasör bağımsızdır; aynı PDF içeriği (3 sayfa, lorem + tablo + grafik) ve aynı ölçüm mantığı kullanılır.

## Klasör yapısı

```
05-pdfkit-report/
  nodejs/   — Node.js + worker_threads
  bun/      — Bun + worker_threads
  deno/     — Deno + Web Workers (ESM)
```

## Kurulum

```bash
# Node.js
cd nodejs && npm install

# Bun
cd bun && bun install

# Deno — ek kurulum gerekmez (npm: import ile paketler indirilir)
cd deno && deno task bench --help  # ilk çalıştırmada bağımlılıklar cache'lenir
```

## Çalıştırma

```bash
# Node.js
cd nodejs && npm run bench

# Bun
cd bun && bun run bench

# Deno
cd deno && deno task bench
```

### Parametreler (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `COUNT`  | 2000       | Üretilecek PDF sayısı |
| `WORKERS`| 8          | Worker pool boyutu |
| `RUNS`   | 20         | Tekrar sayısı |

```bash
COUNT=400 WORKERS=8 RUNS=5 npm run bench          # nodejs/
COUNT=400 WORKERS=8 RUNS=5 bun run bench        # bun/
COUNT=400 WORKERS=8 RUNS=5 deno task bench      # deno/
```

## Çıktılar

Her runtime kendi `output/` klasörüne yazar:

- `results.txt` — tüm koşu süreleri ve özet
- `merged-single-thread.pdf` — son koşuda birleştirilmiş seri çıktı
- `merged-multi-thread.pdf` — son koşuda birleştirilmiş paralel çıktı

`results.txt` içindeki `Runtime` satırı hangi ortamda ölçüldüğünü gösterir.

## Runtime farkları

| | Node.js | Bun | Deno |
|---|---------|-----|------|
| Worker API | `worker_threads` | `worker_threads` | Web `Worker` (ESM) |
| Modül | CommonJS | CommonJS | ESM |
| Paketler | npm | npm (bun install) | `npm:` import map |

Ölçüm adil kalması için her üçünde de aynı `pdfkit` + `pdf-lib` sürümleri ve aynı benchmark döngüsü kullanılır.
