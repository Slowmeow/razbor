/* Разбор колоды — офлайн-кэш.
   Меняйте VERSION при обновлении файлов, тогда старый кэш будет вычищен. */
const VERSION = "razbor-v21";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable.png",
  "./papaparse.min.js"
];

/* Кладём файлы по одному. addAll падает целиком, если не отдался хоть один файл,
   и тогда worker уходит в redundant, а офлайна нет вовсе. */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).catch(() => null).then(async (c) => {
      if (!c) return self.skipWaiting();
      await Promise.all(ASSETS.map((u) =>
        fetch(new Request(u, { cache: "reload" }))
          .then((r) => (r && r.ok ? c.put(u, r) : null))
          .catch(() => null)
      ));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().catch(() => [])
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .catch(() => null)
      .then(() => self.clients.claim())
  );
});

function fresh(res) {
  return res && res.ok && res.type === "basic";
}

/* Сначала кэш, обновление — фоном. Так приложение открывается мгновенно
   и без сети, а новая версия подхватывается со следующего запуска. */
async function cacheFirst(req, fallbackKey) {
  /* Хранилище кэша может быть недоступно (приватный режим, кончилось место,
     запрет политикой). Тогда просто отдаём сеть — офлайна не будет,
     но приложение обязано открываться. */
  let cache = null;
  try { cache = await caches.open(VERSION); } catch (e) { cache = null; }
  if (!cache) return fetch(req);

  let hit = null;
  try {
    hit = await cache.match(req, { ignoreSearch: true }) ||
          (fallbackKey ? await cache.match(fallbackKey) : null);
  } catch (e) { hit = null; }

  const network = fetch(req)
    .then((res) => {
      if (fresh(res)) { try { cache.put(req, res.clone()); } catch (e) {} }
      return res;
    })
    .catch(() => null);

  if (hit) { network.catch(() => {}); return hit; }        // обновится в фоне
  const res = await network;
  if (res) return res;
  return new Response("Нет сети, и в кэше этого файла нет.", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // запросы к GitHub (синхронизация) кэшировать нельзя
  if (url.origin !== self.location.origin) return;

  // переход по адресу — всегда отдаём приложение, даже офлайн
  if (req.mode === "navigate") { e.respondWith(cacheFirst(req, "./index.html")); return; }

  e.respondWith(cacheFirst(req, null));
});
