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
| Worker / child_process / cluster / Promise farkı | Aşağıdaki bölüm |
| libuv thread pool, semafor, atomic operations | `docs/` PDF + aşağıdaki notlar |

## Race condition nedir? (kısa)

JavaScript tek thread'lidir ama `async`/`await`, `Promise`, `setTimeout` ve
event callback'leri ile **eşzamanlılık (concurrency)** vardır. Bir işlem
`await`'te beklerken başka bir işlem araya girip **paylaşılan state'i**
değiştirebilir. Sonucun, işlemlerin **zamanlamasına/sırasına** bağlı olarak
değişmesine race condition denir.

## Çalıştırma

Kurulum gerektirmez (sadece Node.js gerekir; v18+ önerilir).

```bash
# Tek bir senaryo:
node 01-read-modify-write/broken.js
node 01-read-modify-write/fixed.js

# Single vs multi-thread demosu (önerilen giriş):
node 03-single-vs-multi-thread/compare.js

# Tek tek:
node 03-single-vs-multi-thread/single-thread.js
node 03-single-vs-multi-thread/multi-thread.js

# Hepsini bir arada (broken + fixed):
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

Dosyalar: `compare.js` (ana giriş, ikisini sırayla çalıştırır), `single-thread.js`, `multi-thread.js` (çalıştırılabilir), `cpu-task.js` (yardımcı modül, doğrudan çalıştırılmaz).

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
