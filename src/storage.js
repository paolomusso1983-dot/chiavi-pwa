// Archivio: blob cifrato unico in IndexedDB (punto 2.4). Migrazione automatica da
// localStorage["chiavi.vault.v1"] (la chiave usata da chiavi-base.html) al primo avvio.
const DB_NAME = "chiavi-db";
const DB_VERSION = 1;
const STORE = "vault";
const RECORD_KEY = "blob";
const LOCALSTORAGE_KEY = "chiavi.vault.v1";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function loadLegacyBlob() {
  try {
    const r = localStorage.getItem(LOCALSTORAGE_KEY);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}
function wipeLegacy() {
  try { localStorage.removeItem(LOCALSTORAGE_KEY); } catch { /* ignore */ }
}

// Esegue la migrazione se serve: se IndexedDB è vuoto e localStorage ha un blob valido, lo copia
// e lo rimuove dalla vecchia sede. Va chiamata una volta all'avvio, prima di loadBlob().
export async function migrateIfNeeded() {
  try {
    const existing = await idbGet(RECORD_KEY);
    if (existing) return false;
    const legacy = loadLegacyBlob();
    if (!legacy) return false;
    await idbSet(RECORD_KEY, legacy);
    wipeLegacy();
    return true;
  } catch {
    return false;
  }
}

export async function loadBlob() {
  try { return await idbGet(RECORD_KEY); } catch { return null; }
}

export async function storeBlob(blob) {
  try { await idbSet(RECORD_KEY, blob); return true; } catch { return false; }
}

export async function wipeStore() {
  try { await idbDelete(RECORD_KEY); } catch { /* ignore */ }
  wipeLegacy();
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
