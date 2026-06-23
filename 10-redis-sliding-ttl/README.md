# Redis Sliding TTL — Cache / Idle Timeout

Cache'teki veriyi belirli süre tutar; **erişim olursa süreyi baştan başlatır**.
Süre boyunca kimse okumazsa key silinir.

`09-redis-sliding-window` ile farkı: orada **istek sayısı** kayar, burada **ömür
süresi (TTL)** kayar.

## Akış

```
Yaz (SET EX)  →  TTL başlar
    │
    ▼
Okuma (GETEX)  →  değer döner + TTL yeniden başlar
    │
    ▼
TTL dolana kadar erişim yok  →  key silinir
```

## Klasör yapısı

```
10-redis-sliding-ttl/
  docker-compose.yml
  nodejs/
    cache.js   — SET + GETEX (sliding TTL)
    demo.js    — uçtan uca demo
```

## Önkoşul

```bash
cd 10-redis-sliding-ttl
docker compose up -d
```

Redis: `127.0.0.1:6379` (09 ile aynı port; tek Redis yeterli)

## Çalıştırma

```bash
cd nodejs
npm install
npm run demo
```

## Parametreler

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `TTL_SEC` | 5 | Her yazma/okumada verilen süre (sn) |
| `REDIS_URL` | redis://127.0.0.1:6379 | |

```bash
TTL_SEC=10 npm run demo
```

## 09 ile karşılaştırma

| | `09` sliding window | `10` sliding TTL |
|---|---|---|
| Soru | Son N sn'de kaç istek? | Veri ne kadar cache'te kalsın? |
| Redis | ZSET + Lua | STRING + GETEX |
| Erişim | Sayıma eklenir | TTL sıfırlanır |
