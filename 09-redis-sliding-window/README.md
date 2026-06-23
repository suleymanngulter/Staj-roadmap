# Redis Sliding Time Window — Rate Limiter

Son N milisaniye içindeki istek sayısını **kayan pencere (sliding window)** ile
sınırlayan yalın bir Redis örneği.

> Cache TTL'i erişimde yenilemek için `10-redis-sliding-ttl` klasörüne bakın.

## Akış

```
İstek gelir
    │
    ▼
ZREMRANGEBYSCORE  →  pencere dışındaki kayıtları sil
    │
    ▼
ZADD (şimdi)      →  bu isteği ekle
    │
    ▼
ZCARD > limit?    →  evet: ZREM + RED / hayır: İZİN
```

Redis **sorted set (ZSET)** kullanılır: her isteğin skoru zaman damgasıdır.
Lua script ile adımlar atomik çalışır.

## Klasör yapısı

```
09-redis-sliding-window/
  docker-compose.yml
  nodejs/
    limiter.js   — sliding window mantığı
    demo.js      — uçtan uca demo
```

## Önkoşul

```bash
cd 09-redis-sliding-window
docker compose up -d
```

Redis: `127.0.0.1:6379`

## Çalıştırma

```bash
cd nodejs
npm install
npm run demo
```

## Parametreler

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `WINDOW_MS` | 10000 | Kayan pencere süresi (ms) |
| `LIMIT` | 5 | Pencere içindeki max istek |
| `REDIS_URL` | redis://127.0.0.1:6379 | |

```bash
WINDOW_MS=5000 LIMIT=3 npm run demo
```
