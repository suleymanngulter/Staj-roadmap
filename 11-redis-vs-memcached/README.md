# Redis vs Memcached Benchmark

Aynı key/value iş yükünde Redis ve Memcached sürelerini karşılaştırır.

## Klasör yapısı

```
11-redis-vs-memcached/
  docker-compose.yml
  nodejs/
    lib/
      clients.js
      data.js
    benchmark.js
```

## Ölçülen işlemler

Her koşuda önce cache temizlenir (`FLUSHDB` / `flush`):

| İşlem | Redis | Memcached |
|-------|-------|-----------|
| `setSeq` | Tekil `SET` | Tekil `set` |
| `getSeq` | Tekil `GET` | Tekil `get` |
| `setBulk` | Pipeline `SET` | Paralel `set` (CHUNK_SIZE'lık gruplar) |
| `getBulk` | Tek `MGET` | `getMulti` (GET_CHUNK_SIZE'lık gruplar) |

Her koşuda önce Redis suite, ardından Memcached suite **sırayla** çalışır.

Varsayılan: 10000 key, TTL 300 sn, CHUNK_SIZE 500 (toplu SET), GET_CHUNK_SIZE 500 (toplu GET).

> `memcached` paketinde `get(array)` zaten `getMulti`'ye yönlenir. 10k key tek
> `getMulti` çağrısında Node sürücüsü yanıt parse'ında ~500 ms harcar (timeout
> değil). `GET_CHUNK_SIZE=0` ile tek çağrı modunu deneyebilirsin.

## Önkoşul

```bash
cd 11-redis-vs-memcached
docker compose up -d
```

Redis: `127.0.0.1:6379`  
Memcached: `127.0.0.1:11211`

## Çalıştırma

```bash
cd nodejs
npm install
npm run bench
```

## Parametreler

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `COUNT` | 10000 | Key sayısı |
| `RUNS` | 10 | Tekrar sayısı |
| `TTL_SEC` | 300 | Key ömrü (sn) |
| `REDIS_URL` | redis://127.0.0.1:6379 | |
| `MEMCACHED_URL` | 127.0.0.1:11211 | |
| `CHUNK_SIZE` | 500 | Memcached toplu SET paralel chunk |
| `GET_CHUNK_SIZE` | 500 | Memcached `getMulti` chunk (`0` = tüm key tek çağrı) |

```bash
COUNT=5000 RUNS=5 npm run bench
```

## Çıktı

`nodejs/output/results.txt` — koşu bazlı süreler ve ortalamalar.

## Sınırlar (sonuçları yorumlarken)

- **Localhost:** Ağ gecikmesi ~0 ms; uzak sunucuda round-trip maliyeti bulk avantajını büyütür.
- **Tek client:** Eşzamanlı yük testi değil; çoklu bağlantı farklı sonuç verir.
- **Küçük value:** ~70 B JSON; büyük payload'larda tablo değişebilir.
- **Toplu SET asimetrisi:** Redis pipeline vs Memcached paralel chunk — protokol farkı gerçek, ama tam simetrik değil.
- **Toplu GET:** Redis tek `MGET`; Memcached `getMulti` chunk (sürücü 10k tek çağrıda yavaş).
