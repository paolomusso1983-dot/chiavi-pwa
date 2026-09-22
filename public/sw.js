// Service worker — cache dell'app shell per l'uso offline (punto 7) + cache runtime "opaca"
// delle icone dei loghi (punto 3.2.a: nessuna sorgente favicon ha CORS, quindi le risposte sono
// opache — comunque cacheabili, solo non ispezionabili). Nessuna libreria: la CSP vieta script
// da CDN a runtime e l'uso qui è abbastanza semplice da non giustificare Workbox.
// __BUILD_ID__ è sostituito da tools/stamp-sw.mjs (eseguito dopo `vite build`, vedi
// package.json) con un hash del contenuto di dist/: cambia a ogni build, così `activate`
// elimina automaticamente le cache delle build precedenti (bundle JS/CSS con nome hashato
// diverso a ogni release) invece di farle accumulare all'infinito. In sviluppo (senza build)
// resta il valore letterale qui sotto.
const CACHE_VERSION = "chiavi-__BUILD_ID__";
const APP_CACHE = `${CACHE_VERSION}-app`;
const LOGO_CACHE = `${CACHE_VERSION}-logos`;
const BASE = new URL(".", self.location).href;

// __PRECACHE_EXTRA_JSON__ è sostituito con l'elenco reale (array JSON) dei file con hash in
// dist/assets/ prodotti dalla build, es. ["assets/index-XXXX.js","assets/index-XXXX.css"].
// In sviluppo (file sorgente, mai sostituito) resta un array vuoto: niente precache extra, ma
// la cache runtime (stale-while-revalidate qui sotto) li mette comunque in cache al primo uso.
const PRECACHE_EXTRA = "__PRECACHE_EXTRA_JSON__".startsWith("__") ? [] : JSON.parse("__PRECACHE_EXTRA_JSON__");

const APP_SHELL = [
  "", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png", "icons/favicon-32.png",
  ...PRECACHE_EXTRA,
].map(p => BASE + p);

const LOGO_ORIGINS = ["https://www.google.com", "https://icons.duckduckgo.com"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== LOGO_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isLogoRequest(url) {
  return LOGO_ORIGINS.some(o => url.startsWith(o));
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(res => {
    // Le risposte "opaque" (cross-origin senza CORS) hanno status 0 ma sono cacheabili.
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  // `cached || networkPromise` era un bug: una Promise pendente è sempre "truthy", quindi lo
  // short-circuit `||` restituiva la Promise ANCHE quando poi si risolveva a null (rete assente
  // e niente in cache) invece di aspettarla — `event.respondWith(null)` rompe la richiesta con
  // net::ERR_FAILED invece di mostrare l'errore corretto o i dati in cache.
  if (cached) { networkPromise.catch(() => {}); return cached; }
  const fromNetwork = await networkPromise;
  if (fromNetwork) return fromNetwork;
  throw new Error("risorsa non disponibile né in cache né in rete");
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res && res.ok) { const cache = await caches.open(cacheName); cache.put(request, res.clone()); }
    return res;
  } catch {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match(BASE + "index.html");
    throw new Error("offline e nessuna cache disponibile");
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = request.url;

  if (isLogoRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, LOGO_CACHE));
    return;
  }
  if (url.startsWith(self.location.origin)) {
    if (request.mode === "navigate") { event.respondWith(networkFirst(request, APP_CACHE)); return; }
    event.respondWith(staleWhileRevalidate(request, APP_CACHE));
    return;
  }
  // Altre origini (es. Clearbit): passthrough, nessuna cache — è una ricerca dinamica, non serve offline.
});
