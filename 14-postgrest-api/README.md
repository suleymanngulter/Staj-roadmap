# PostgREST — Veritabanı = REST API

Node.js backend yazmadan PostgreSQL tablolarını HTTP API olarak açar.
Supabase'in kalbindeki fikrin açık kaynak karşılığı: **PostgREST**.

## Nasıl çalışır?

| HTTP | SQL | Örnek |
|------|-----|-------|
| GET | SELECT | `/urunler` |
| POST | INSERT | JSON body |
| PATCH | UPDATE | `?id=eq.1` |
| DELETE | DELETE | RLS ile kısıtlanır |

Filtre: `GET /urunler?fiyat=gt.5000` → `WHERE fiyat > 5000`

Güvenlik: **Row Level Security (RLS)** — kurallar tabloda; DELETE politikası yok → reddedilir.

## Klasör yapısı

```
14-postgrest-api/
  docker-compose.yml    — PostgreSQL + PostgREST
  docker/init.sql       — api.urunler + RLS
  nodejs/
    demo.js             — curl yerine fetch ile test
```

## Çalıştırma

```bash
cd 14-postgrest-api
docker compose up -d

cd nodejs && npm run demo
```

API: http://127.0.0.1:3000  
OpenAPI: http://127.0.0.1:3000/ (root)

## Manuel curl

```bash
curl http://127.0.0.1:3000/urunler
curl "http://127.0.0.1:3000/urunler?fiyat=gt.5000"
curl -X POST http://127.0.0.1:3000/urunler \
  -H "Content-Type: application/json" \
  -d '{"ad":"Mouse","fiyat":450,"kategori":"elektronik"}'
curl -X DELETE "http://127.0.0.1:3000/urunler?id=eq.1"
# → RLS: permission denied
```

## Roller

| Rol | Açıklama |
|-----|----------|
| `authenticator` | PostgREST bağlantı kullanıcısı |
| `web_anon` | Her isteğin çalıştığı rol (RLS burada uygulanır) |

Gerçek projede JWT ile kullanıcı rolü değiştirilir; bu demo `web_anon` ile yalın kalır.
