// Logo automatico (sezione 3 del prompt).
// Nessuna delle sorgenti favicon ha CORS (vedi VERIFICHE.md) quindi non si può leggere il pixel
// data via canvas per produrre un data URL: si salva solo il dominio (`logoDomain` + `logoSource`)
// e si mostra con un <img> "opaco", messo in cache dal service worker per l'uso offline
// (alternativa (a) del punto 3.2 — vedi DECISIONI.md).
import { DOMAINS } from "./domains.js";

export const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Indice nome normalizzato -> dominio, costruito una sola volta dal dizionario verificato.
const DICTIONARY = new Map();
for (const entry of DOMAINS) {
  for (const name of entry.names) DICTIONARY.set(norm(name), entry.domain);
}

export function normalizeDomainInput(raw) {
  if (!raw) return "";
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return d;
}

// Sorgenti logo, in ordine di qualità (punto 3.2/3.4). `dims` sono le dimensioni del segnaposto
// generico noto di quella sorgente, riconosciuto via naturalWidth/naturalHeight dell'<img> (che
// restano leggibili anche senza CORS, a differenza dei pixel via canvas).
export const LOGO_SOURCES = [
  {
    id: "google",
    label: "Google s2favicons",
    url: domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    isPlaceholder: (w, h) => w === 16 && h === 16,
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    url: domain => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
    isPlaceholder: (w, h) => w === 48 && h === 48,
  },
];
export const sourceById = id => LOGO_SOURCES.find(s => s.id === id);

// 3.3 — nome -> dominio, in ordine: url della voce, dizionario locale, domainMap imparato,
// servizio Clearbit Autocomplete, euristiche. Ritorna {domain, via} oppure null.
export function resolveDomain(item, meta) {
  const url = normalizeDomainInput(item.url);
  if (url) return { domain: url, via: "url" };
  const n = norm(item.name);
  if (!n) return null;
  if (meta && meta.domainMap && meta.domainMap[n]) return { domain: meta.domainMap[n], via: "domainMap" };
  if (DICTIONARY.has(n)) return { domain: DICTIONARY.get(n), via: "dictionary" };
  return null; // il resto (servizio remoto + euristiche) richiede rete: vedi resolveDomainOnline
}

// Punto 3.3.3: Clearbit Autocomplete, CORS abilitato, nessuna chiave richiesta (VERIFICHE.md).
// Invia solo il nome digitato, mai altri dati (punto 3.5).
async function tryNameService(name, { signal } = {}) {
  try {
    const res = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`, { signal });
    if (!res.ok) return null;
    const list = await res.json();
    const hit = Array.isArray(list) && list.find(x => x && x.domain);
    return hit ? hit.domain : null;
  } catch { return null; }
}

// Punto 3.3.4: euristiche sul nome normalizzato, senza spazi/accenti.
function heuristicCandidates(name) {
  const slug = norm(name).replace(/[^a-z0-9]+/g, "");
  if (!slug) return [];
  return [`${slug}.it`, `${slug}.com`, `${slug}bank.com`, `${slug}.eu`];
}

function loadImageDims(url, timeoutMs = 6000) {
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = res => { if (done) return; done = true; clearTimeout(timer); resolve(res); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => finish(null);
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}

// Prova le sorgenti logo in ordine per un dominio; ritorna la prima valida (>=32px reali e non
// il segnaposto generico riconosciuto) oppure null se nessuna sorgente ha un'icona utile.
export async function probeLogo(domain) {
  for (const source of LOGO_SOURCES) {
    const dims = await loadImageDims(source.url(domain));
    if (!dims) continue;
    if (dims.w < 32 || dims.h < 32) continue;
    if (source.isPlaceholder(dims.w, dims.h)) continue;
    return { source: source.id, w: dims.w, h: dims.h };
  }
  return null;
}

// Risoluzione completa (rete inclusa) per una voce: prova prima i metodi offline (resolveDomain),
// poi, se autoLogo è attivo, il servizio nome->dominio e infine le euristiche, verificando ogni
// candidato con probeLogo prima di accettarlo.
export async function resolveAndProbe(item, meta, { autoLogo, signal } = {}) {
  const offline = resolveDomain(item, meta);
  if (offline) {
    const probe = await probeLogo(offline.domain);
    if (probe) return { domain: offline.domain, via: offline.via, ...probe };
  }
  if (!autoLogo) return null;
  const n = norm(item.name);
  if (!n) return null;
  const remoteDomain = await tryNameService(item.name, { signal });
  const candidates = [remoteDomain, ...heuristicCandidates(item.name)].filter(Boolean);
  for (const domain of candidates) {
    const probe = await probeLogo(domain);
    if (probe) return { domain, via: domain === remoteDomain ? "nameservice" : "heuristic", ...probe };
  }
  return null;
}

// Coda con massimo 4 richieste in parallelo, senza bloccare in caso di errore/rete assente
// (punto 3.4). `onItemResolved(item, result)` viene chiamato per ogni voce elaborata,
// `result` è null se non si è trovato nulla.
export async function runLogoQueue(items, meta, { autoLogo, concurrency = 4, onItemResolved } = {}) {
  const queue = items.slice();
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      let result = null;
      try {
        result = await resolveAndProbe(item, meta, { autoLogo });
      } catch { result = null; }
      if (onItemResolved) await onItemResolved(item, result);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}
