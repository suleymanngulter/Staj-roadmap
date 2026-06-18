# TCP/UDP → Redis → RabbitMQ Benchmark — Node.js vs Bun

Gelen TCP/UDP verisi Redis cache'te kullanıcı doğrulamasından geçer; cache'te
varsa RabbitMQ kuyruğuna yayınlanır, yoksa reddedilir.

## Akış

```
İstemci ──TCP/UDP──► Sunucu ──EXISTS user:{id}──► Redis
                              │
                    cache hit │ cache miss
                              ▼              ▼
                         RabbitMQ         REJECT
                         (publish)        (yanıt)
```

## Klasör yapısı

```
07-tcp-udp-cache/
  docker-compose.yml   — Redis + RabbitMQ
  nodejs/              — Node.js sunucu + yük testi
  bun/                 — Bun sunucu + yük testi
```

## Önkoşul: altyapı

```bash
cd 07-tcp-udp-cache
docker compose up -d
```

Redis: `127.0.0.1:6379`  
RabbitMQ: `127.0.0.1:5672` (yönetim UI: `http://localhost:15672`, guest/guest)

## Protokol

Her istek UTF-8 JSON (TCP'de satır sonu `\n`):

```json
{"userId":"user_00001"}
```

Yanıtlar:

| Durum | TCP/UDP yanıtı |
|-------|----------------|
| Cache hit + RabbitMQ publish | `OK` |
| Kullanıcı cache'te yok | `REJECT not_in_cache` |
| Geçersiz JSON | `REJECT invalid_json` |

## Ölçülen senaryolar

Her koşuda 6 senaryo sırayla çalışır (`REQUESTS` istek, `CONCURRENCY` paralellik):

| Senaryo | Açıklama |
|---------|----------|
| `tcpAccept` | Tüm istekler cache'teki kullanıcılar |
| `tcpReject` | Tüm istekler cache dışı kullanıcılar |
| `udpAccept` | UDP, cache hit |
| `udpReject` | UDP, cache miss |
| `tcpMixed` | %80 kabul / %20 red (INVALID_RATIO) |
| `udpMixed` | UDP karışık |

Metrikler: wall süre (ms), req/s, p50/p99 gecikme (ms).

## Kurulum ve çalıştırma

```bash
# Node.js
cd nodejs && npm install && npm run bench

# Bun
cd bun && bun install && bun run bench
```

### Parametreler

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `COUNT` | 10000 | Redis'e seed edilen kullanıcı sayısı |
| `REQUESTS` | 5000 | Senaryo başına istek |
| `CONCURRENCY` | 100 | Eşzamanlı istemci |
| `RUNS` | 20 | Tekrar sayısı |
| `INVALID_RATIO` | 0.2 | Karışık senaryoda red oranı |
| `TCP_PORT` | 17007 | TCP dinleme portu |
| `UDP_PORT` | 17008 | UDP dinleme portu |
| `REDIS_URL` | redis://127.0.0.1:6379 | |
| `RABBITMQ_URL` | amqp://guest:guest@127.0.0.1:5672 | |

```bash
COUNT=10000 REQUESTS=5000 RUNS=5 npm run bench    # nodejs/
COUNT=10000 REQUESTS=5000 RUNS=5 bun run bench    # bun/
```

## Çıktı

`output/results.txt` — koşu bazlı süreler ve ortalamalar.

Karşılaştırma raporu: `compare-report.txt` (her iki benchmark sonrası).

> **Not:** Node.js ve Bun aynı Redis/RabbitMQ örneğini paylaşır; benchmark'ları
> sırayla çalıştırın. Hızlı deneme için `RUNS=3 REQUESTS=1000` kullanın.
