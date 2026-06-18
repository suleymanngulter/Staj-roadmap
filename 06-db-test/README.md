# SQLite Benchmark — Node.js vs Bun

10000 kullanıcı kaydı üzerinde SQLite işlem hızlarını karşılaştırır.

## Klasör yapısı

```
06-db-test/
  nodejs/   — better-sqlite3
  bun/      — bun:sqlite (yerleşik)
```

## Şema

```sql
users (id, username, name, surname, age)
```

Seed: deterministik 10000 kayıt (`user_00001` … `user_10000`).

## Ölçülen işlemler

Her koşuda her işlem **ayrı** veritabanında ölçülür (dosya her seferinde silinip yeniden oluşturulur):

| İşlem | Açıklama |
|-------|----------|
| `insertTx` | 10000 satır, tek transaction |
| `insertSingle` | 10000 tekil INSERT (autocommit) |
| `selectAll` | `SELECT *` (önce seed) |
| `selectWhere` | `WHERE age > 30` (index) |
| `updateAll` | `age = age + 1` |
| `deleteHalf` | `id > 7500` (COUNT=10000 için, %75 eşiği) |

## Veritabanı dosyası

Node.js ve Bun **aynı dosyayı** kullanır:

```
06-db-test/bench.db
```

`DB_PATH` ortam değişkeni ile özelleştirilebilir. Tek dosya (`bench.db`), journal_mode=DELETE.

## Kurulum ve çalıştırma

```bash
# Node.js
cd nodejs && npm install && npm run bench

# Bun
cd bun && bun run bench
```

### Parametreler

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `COUNT`  | 10000      | Seed kayıt sayısı |
| `RUNS`   | 20         | Tekrar sayısı |

```bash
COUNT=10000 RUNS=20 npm run bench    # nodejs/
COUNT=10000 RUNS=20 bun run bench    # bun/
```

## Çıktı

`output/results.txt` — koşu bazlı süreler ve ortalamalar.

Karşılaştırma raporu: `compare-report.txt` (her iki benchmark sonrası).

> Varsayılan: `COUNT=10000`, `RUNS=20`. Farklı değerler için ortam değişkeni
> verin; `results.txt` başlığındaki COUNT satırından doğrulayın.

## Driver notu

Node.js `better-sqlite3` (native addon), Bun `bun:sqlite` (yerleşik) kullanır.
Bu, gerçek dünyadaki “Node ekosistemi vs Bun” karşılaştırmasıdır.
