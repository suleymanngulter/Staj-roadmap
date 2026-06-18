# Node.js: Single/Multi-Thread, Race Condition'lar ve Eşzamanlılık

Bu repo, Node.js'in eşzamanlılık (concurrency) modelini **çalıştırılabilir
örneklerle** öğrenmek için hazırlandı. Şu soruların etrafında ilerliyoruz:

- Node.js single-thread mi, multi-thread mi?
- Race condition nedir, Node.js'te nasıl oluşur, nasıl önlenir?
- `worker_threads` ile multi-thread yapıda nasıl çalışırız?
- `Worker` vs `child_process` vs `cluster` vs `Promise` farkı nedir?

Race condition senaryolarının her birinin iki sürümü vardır:

- `broken.js` — race condition'ı oluşturan (hatalı) kod
- `fixed.js` — aynı problemin çözülmüş hali

> Konu anlatımı için `docs/Node JS Threads.pdf` dosyasına da bakabilirsiniz.

## Öğrenme hedefleri (özet)

| Konu | Nerede |
|------|--------|
| Async concurrency race (tek thread, `await` interleaving) | `01-read-modify-write` |
| Gerçek shared memory race (çoklu thread + `SharedArrayBuffer`) | `02-shared-memory` |
| Single-thread (event loop bloklanması) vs multi-thread (Worker ile paralel) | `03-single-vs-multi-thread` |
| libuv thread pool'u büyütmek (`UV_THREADPOOL_SIZE`) ve etkisini ölçmek | `04-libuv-threadpool` |
| pdfkit ile mock veriden PDF üretmek (stream tabanlı I/O) | `05-pdfkit-report` |
| SQLite işlem hızı (Node.js vs Bun) | `06-db-test` |
| Worker / child_process / cluster / Promise farkı | Aşağıdaki bölüm |
| Semafor, atomic operations (kavram) | `docs/` PDF + aşağıdaki notlar |

## Race condition nedir? (kısa)

JavaScript tek thread'lidir ama `async`/`await`, `Promise`, `setTimeout` ve
event callback'leri ile **eşzamanlılık (concurrency)** vardır. Bir işlem
`await`'te beklerken başka bir işlem araya girip **paylaşılan state'i**
değiştirebilir. Sonucun, işlemlerin **zamanlamasına/sırasına** bağlı olarak
değişmesine race condition denir.

## Çalıştırma

Senaryo 1–4 kurulum gerektirmez (sadece Node.js; v18+ önerilir). Senaryo 5
(pdfkit) ve Senaryo 6 (SQLite) için ilgili `nodejs/` klasöründe `npm install`.

```bash
# Tek bir senaryo:
node 01-read-modify-write/broken.js
node 01-read-modify-write/fixed.js

# Single vs multi-thread demosu:
node 03-single-vs-multi-thread/single-thread.js
node 03-single-vs-multi-thread/multi-thread.js

# libuv thread pool ölçümü (UV_THREADPOOL_SIZE etkisi):
node 04-libuv-threadpool/measure.js

# pdfkit benchmark (Senaryo 5 — önce nodejs/ içinde kurun)
cd 05-pdfkit-report/nodejs && npm install

# SQLite benchmark (Senaryo 6)
cd 06-db-test/nodejs && npm install && npm run bench
# Bun karşılaştırması:
cd 06-db-test/bun && bun run bench

# Hepsini bir arada:
node run-all.js
```

> Not: `broken` örnekler zamanlamaya bağlıdır. Gecikmeler rastgele olduğu için
> bazen tek seferde "doğru" sonuç çıkabilir; birkaç kez çalıştırınca hata
> belirginleşir. `fixed` örnekler her zaman doğru sonucu verir.

## Senaryolar

| # | Klasör | Problem | Çözüm |
|---|--------|---------|-------|
| 1 | `01-read-modify-write` | Paylaşılan değişkene eşzamanlı oku-değiştir-yaz; güncelleme kaybı (lost update) | Mutex / kilit ile kritik bölümü serileştirmek |
| 2 | `02-shared-memory` | Birden fazla Worker thread'i aynı `SharedArrayBuffer`'a atomik olmadan oku-değiştir-yaz yapıyor; **gerçek data race** (lost update) | `Atomics.add` ile atomik işlem |
| 3 | `03-single-vs-multi-thread` | Tek thread'de ağır CPU işi event loop'u **bloklar**; tek çekirdek kullanılır | İşi `worker_threads` ile çok çekirdeğe **paralel** dağıtmak |
| 4 | `04-libuv-threadpool` | libuv thread pool varsayılan 4 thread; ağır I/O (crypto/fs) işleri pool dolunca sıra bekler | `UV_THREADPOOL_SIZE` ile pool'u büyütmek (çekirdek sınırına kadar) |
| 5 | `05-pdfkit-report` | (race değil) pdfkit ile toplu PDF üretimi; seri vs worker pool benchmark (Node/Bun/Deno) | — |
| 6 | `06-db-test` | (race değil) SQLite CRUD hızı; 10000 user seed (Node better-sqlite3 vs Bun bun:sqlite) | — |

Dosyalar (Senaryo 3): `single-thread.js`, `multi-thread.js` (çalıştırılabilir), `cpu-task.js` (yardımcı modül, doğrudan çalıştırılmaz).

## Single-thread mi, multi-thread mi? (Senaryo 3)

Node.js'in JS execution modeli **varsayılan olarak single-thread**'dir: tüm
JS kodun **tek bir event loop** üzerinde çalışır. Ama bu "Node hiç thread
kullanmaz" demek değildir. Üç katman vardır:

```
┌─────────────────────────────────────────────────┐
│  1) Ana JS thread (event loop)                   │
│     async/await, Promise, setTimeout burada      │  ← "single-thread" denen bu
├─────────────────────────────────────────────────┤
│  2) libuv thread pool (C++ / OS thread'leri)     │
│     fs, crypto, dns, zlib... (default 4 thread)  │  ← arka plan, JS değil
│     UV_THREADPOOL_SIZE ile değiştirilebilir      │
├─────────────────────────────────────────────────┤
│  3) worker_threads (senin açtığın OS thread'leri)│
│     new Worker(...) → ayrı V8 isolate + loop     │  ← bilinçli multi-thread
└─────────────────────────────────────────────────┘
```

`03-single-vs-multi-thread` demosu bunu kanıtlar: aynı CPU-bound iş (asal sayma)

- **single-thread**: event loop bloklanır, "heartbeat" hiç çalışamaz, tek çekirdek.
- **multi-thread**: iş 4 Worker'a bölünür, event loop boş kalır (heartbeat çalışır),
  çok çekirdekli makinede belirgin hızlanma.

Yani Node **kendiliğinden** multi-thread olmaz; `worker_threads` ile **bilinçli
olarak** açarsın.

## libuv thread pool'u büyütmek (Senaryo 4)

Yukarıdaki 2. katman (libuv thread pool) **varsayılan 4 thread** ile gelir ve
şu C++ tarafı işler için kullanılır: **dosya sistemi (`fs`)**, **kriptografi
(`crypto`)**, **DNS (`dns.lookup`)**, **zlib**. (Ağ I/O — TCP/HTTP — bu pool'u
kullanmaz; OS'in epoll/kqueue/IOCP mekanizmasıyla yürür.)

Pool boyutu **`UV_THREADPOOL_SIZE`** ortam değişkeni ile değiştirilir (1–1024):

```bash
UV_THREADPOOL_SIZE=8 node app.js
```

Önemli: pool, ilk kullanımda **bir kez** oluşur; bu yüzden değer process
**başlamadan önce** verilmelidir. Kod içinden `process.env.UV_THREADPOOL_SIZE = ...`
genelde geç kalır.

`04-libuv-threadpool/measure.js` aynı 8 ağır `pbkdf2` işini farklı pool
boyutlarıyla (ayrı process'ler olarak) çalıştırıp süreyi ölçer. Örnek çıktı
(16 çekirdekli makine):

```
UV_THREADPOOL_SIZE=1   | 8 görev | süre: 1050 ms
UV_THREADPOOL_SIZE=2   | 8 görev | süre:  554 ms
UV_THREADPOOL_SIZE=4   | 8 görev | süre:  290 ms
UV_THREADPOOL_SIZE=8   | 8 görev | süre:  216 ms
```

Pool büyüdükçe işler daha çok paralelleşir ve süre kısalır. **Ama** sınır CPU
çekirdek sayısıdır: çekirdekten fazla thread, thread'ler çekirdek için sıraya
gireceğinden ek fayda getirmez (hatta context-switch yüzünden kötüleşebilir).
İyi bir başlangıç: `UV_THREADPOOL_SIZE ≈ os.cpus().length`.

`worker_threads` ile farkı: bu pool **senin JS kodunu** paralelleştirmez; yalnızca
arka plandaki C++ I/O işlerinin kaç tanesinin aynı anda yürüyeceğini belirler.

## pdfkit ile PDF üretimi (Senaryo 5)

`05-pdfkit-report/` altında aynı benchmark üç runtime'da ayrı klasörlerde durur:

| Klasör | Runtime | Worker API |
|--------|---------|------------|
| `nodejs/` | Node.js | `worker_threads` |
| `bun/` | Bun | `worker_threads` |
| `deno/` | Deno | Web `Worker` (ESM) |

Her biri 3 sayfalık ağır PDF üretir (lorem + tablo + grafik), seri vs paralel
karşılaştırması yapar ve sonuçları kendi `output/results.txt` dosyasına yazar.

```bash
# Node.js
cd 05-pdfkit-report/nodejs && npm install && npm run bench

# Bun
cd 05-pdfkit-report/bun && bun install && bun run bench

# Deno
cd 05-pdfkit-report/deno && deno task bench
```

Parametreler: `COUNT`, `WORKERS`, `RUNS` ortam değişkenleri (varsayılan 2000 / 8 / 20).
Üretilen `.pdf` çıktıları `.gitignore`'dadır. Ayrıntılar: `05-pdfkit-report/README.md`.

### PDF üretimini optimize etmek (toplu üretim)

Tek ve küçük bir PDF zaten milisaniyeler sürer; onu "optimize etmek" anlamsızdır.
Asıl kazanç **çok sayıda PDF** üretirken ortaya çıkar. PDF içeriğini oluşturmak
**CPU-bound** bir iştir ve ana JS thread'inde çalışır; yüzlerce belgeyi seri
üretmek event loop'u uzun süre meşgul eder ve yalnızca tek çekirdek kullanır.

`benchmark.js`, aynı N belgeyi iki şekilde üretip karşılaştırır:

- **Seri:** hepsi ana thread'de sırayla (tek çekirdek)
- **Paralel:** worker pool ile iş çekirdeklere bölünür (Senaryo 3'ün
  gerçek dünya uygulaması)

```bash
COUNT=400 WORKERS=8 node 05-pdfkit-report/nodejs/benchmark.js
COUNT=400 WORKERS=8 bun run bench    # bun/ içinden
COUNT=400 WORKERS=8 deno task bench  # deno/ içinden
```

Örnek ölçüm (16 çekirdekli makine, 200 belge, 8 worker):

```
SERİ (tek thread)       : ~9000 ms
PARALEL (worker pool)   : ~2600 ms   → ~3.3x hızlanma
```

Dosyalar: `lib/create-counter-pdf.js` (tek PDF üretimi), `worker.js`
(worker'a düşen dilimi üretir), `benchmark.js` (seri vs paralel ölçüm).

Diğer optimizasyon notları:
- **child_process / cluster:** PDF üretimini ayrı process'lere de dağıtabilirsin;
  ama `worker_threads` aynı process içinde daha hafiftir ve burada yeterlidir.
- **Disk I/O:** Çok sayıda dosyayı aynı anda yazmak libuv thread pool'unu kullanır;
  gerekirse `UV_THREADPOOL_SIZE` (Senaryo 4) ile artırılabilir.
- **Stream:** PDF zaten stream olarak yazılır; tüm içeriği bellekte tutmak yerine
  parça parça diske akıtmak bellek dostudur.

## SQLite işlem hızı (Senaryo 6)

`06-db-test/`, 10000 kullanıcı kaydı (`id`, `username`, `name`, `surname`, `age`)
üzerinde SQLite CRUD sürelerini Node.js (`better-sqlite3`) ve Bun (`bun:sqlite`)
ile karşılaştırır. İkisi de paylaşımlı `06-db-test/bench.db` dosyasını kullanır
(her işlem öncesi sıfırlanır).

```bash
cd 06-db-test/nodejs && npm install && npm run bench
cd 06-db-test/bun && bun run bench
```

Parametreler: `COUNT` (varsayılan 10000), `RUNS` (varsayılan 20).
Ayrıntılar: `06-db-test/README.md`.

## Worker vs child_process vs cluster vs Promise

| | Ne yapar | Bellek | Paralellik | Ne zaman |
|---|---|---|---|---|
| **Promise / async** | Tek thread'de eşzamanlılık (interleaving) | Aynı (tek thread) | Yok (cooperative) | I/O-bound işler, beklemeler |
| **worker_threads** | Aynı process içinde ek thread | `SharedArrayBuffer` ile **paylaşılabilir** | Gerçek (çok çekirdek) | CPU-bound iş (görüntü işleme, kriptografi) |
| **child_process** | Ayrı process (farklı PID) | **Ayrı** bellek, paylaşım yok (IPC) | Gerçek | İzole iş, ayrı binary/script çalıştırma |
| **cluster** | Servisin ayrı process kopyaları + load balance | Ayrı bellek | Gerçek | Gelen isteği çok çekirdeğe dağıtma (HTTP sunucu) |

Kısaca (PDF'teki ayrımla uyumlu):

- **Promise**: aynı işi tek thread'de sıraya sokar; gerçek paralellik yok.
- **Worker**: eldeki **tek bir işi** birden fazla thread'e paylaştırır (aynı memory).
- **child_process**: ayrı memory alanı; thread değil, ayrı process.
- **cluster**: bir **servise** çok istek gelince kopyalarını ayrı process olarak
  oluşturup load balance yapar (container yönetimine benzer).

## Race condition önleme teknikleri (PDF özeti)

- **Lock (kilit):** Bir thread veriye erişirken kilitler, işi bitince açar.
- **Semafor:** Sayaç tabanlı. `wait`: sayaç>0 ise azalt ve devam et, 0 ise thread
  uyur. `signal`: iş bitince sayaç artar, bekleyen thread devralır.
- **Atomic operations:** Bölünmez işlemler (örn. `Sayac = Sayac + 1` tek parça
  olarak tamamlanır). Node.js'te `Atomics.*` bunu sağlar.

## İki farklı race türü (önemli ayrım)

- **Senaryo 1: Async concurrency race (mantıksal yarış).** JavaScript tek
  thread'lidir. Gerçek paralellik yoktur; yarış sadece `await` noktalarında
  işlemlerin **iç içe geçmesinden (interleaving)** doğar. Bellek paylaşımı
  yoktur. Bu yüzden "bazen şanslı çıkarız". Çözüm: Mutex ile kritik bölümü
  serileştirmek.
- **Senaryo 2: Shared Memory / data race (gerçek yarış).** Birden fazla Worker
  thread'i (ayrı OS thread'leri, ayrı çekirdekler) **aynı `SharedArrayBuffer`'a**
  erişir. `view[0] += 1` CPU seviyesinde LOAD→ADD→STORE üç adımdır ve atomik
  değildir; thread'ler araya girip artışları kaybeder. Bu, C/C++'taki
  `pthread` data race'inin JavaScript karşılığıdır. Çözüm: `Atomics.*`
  (örn. `Atomics.add`) ya da Atomics tabanlı kilit.

## Bonus: Mutex örneği

`01-read-modify-write/fixed.js` içindeki `Mutex` sınıfı, kritik bölümü
serileştirmenin async dünyadaki uygulamasıdır. Aynı fikir: bir işlem kilidi
alır, kritik bölümü çalıştırır, sonra bırakır.
