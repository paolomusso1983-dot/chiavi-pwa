// Importazione da Excel (sezione 4 del prompt / sezione 5 di SPEC.md).
// Diviso in due livelli: funzioni pure su array-di-array (testabili senza SheetJS/DOM) e un
// livello che usa SheetJS per leggere il file vero e proprio.

export const SYNONYMS = {
  name: ["nome", "sito", "servizio", "app", "applicazione", "descrizione", "name", "title", "account"],
  url: ["url", "indirizzo", "link", "sito web", "website", "web"],
  user: ["utente", "username", "user", "login", "email", "e-mail", "mail", "codice cliente", "id", "identificativo"],
  pass: ["password", "pass", "pwd", "psw", "parola chiave", "chiave"],
  pin: ["pin", "codice pin", "codice dispositivo"],
  totp: ["2fa", "otp", "totp", "chiave 2fa", "authenticator"],
  notes: ["note", "notes", "annotazioni", "commenti"],
};
const SECRET_HEADER_HINTS = ["codice", "pin", "puk", "segreto", "risposta", "domanda"];
const FIELD_ORDER = ["name", "url", "user", "pass", "pin", "totp", "notes"];

export function normalizeHeader(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Confronto per parole intere (non per sottostringa: un'intestazione "a" non deve "matchare"
// solo perché "a" compare dentro "password"). Un sinonimo multi-parola come "sito web" vince su
// uno mono-parola come "sito" quando l'intestazione li contiene entrambi, scegliendo il match più
// specifico (più parole in comune).
export function matchField(headerText) {
  const h = normalizeHeader(headerText);
  if (!h) return null;
  const hWords = new Set(h.split(" ").filter(Boolean));
  let best = null, bestScore = 0;
  for (const field of FIELD_ORDER) {
    for (const syn of SYNONYMS[field]) {
      const sWords = normalizeHeader(syn).split(" ").filter(Boolean);
      if (!sWords.length) continue;
      const allPresent = sWords.every(w => hWords.has(w));
      if (!allPresent) continue;
      const score = sWords.length;
      if (score > bestScore) { bestScore = score; best = field; }
    }
  }
  return best;
}

export function isSecretHeader(headerText) {
  const h = normalizeHeader(headerText);
  return SECRET_HEADER_HINTS.some(hint => h.includes(hint));
}

function isTextish(cell) {
  return typeof cell === "string" && cell.trim() !== "";
}

// Prima riga con almeno 2 celle testuali che corrispondono a sinonimi noti.
export function detectHeaderRowIndex(aoa, maxScan = 20) {
  for (let r = 0; r < Math.min(aoa.length, maxScan); r++) {
    const row = aoa[r] || [];
    let matches = 0;
    for (const cell of row) if (isTextish(cell) && matchField(cell)) matches++;
    if (matches >= 2) return r;
  }
  return -1;
}

// Mappa colonna -> campo riconosciuto ("name","url",... o null se non riconosciuta = campo extra).
export function buildMapping(headerRow) {
  const mapping = [];
  const used = new Set();
  headerRow.forEach((cell, col) => {
    const field = matchField(cell);
    if (field && !used.has(field)) { mapping[col] = field; used.add(field); }
    else mapping[col] = null;
  });
  return mapping;
}

// Fallback quando non c'è un'intestazione riconoscibile (punto 4.2): deduce le colonne dal
// contenuto delle prime righe di dati. url = contiene un punto/dominio, utente = contiene @,
// password = colonna con più varietà di caratteri (esclusi nome/url/utente già assegnati).
export function inferMappingWithoutHeader(aoa, sampleRows = 15) {
  const rows = aoa.slice(0, sampleRows).filter(r => r && r.some(isTextish));
  if (!rows.length) return [];
  const colCount = Math.max(...rows.map(r => r.length));
  const mapping = new Array(colCount).fill(null);
  const scores = { url: new Array(colCount).fill(0), email: new Array(colCount).fill(0), variety: new Array(colCount).fill(0) };
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const v = String(row[c] ?? "");
      if (!v) continue;
      if (/@/.test(v)) scores.email[c]++;
      else if (/\.[a-z]{2,}/i.test(v) && /^[\w.-]+$/.test(v)) scores.url[c]++;
      scores.variety[c] += new Set(v).size;
    }
  }
  let urlCol = -1, userCol = -1, passCol = -1;
  let best = 0;
  scores.url.forEach((v, c) => { if (v > best) { best = v; urlCol = c; } });
  best = 0;
  scores.email.forEach((v, c) => { if (v > best) { best = v; userCol = c; } });
  best = -1;
  scores.variety.forEach((v, c) => { if (c !== urlCol && c !== userCol && v > best) { best = v; passCol = c; } });
  if (urlCol >= 0) mapping[urlCol] = "url";
  if (userCol >= 0 && userCol !== urlCol) mapping[userCol] = "user";
  if (passCol >= 0) mapping[passCol] = "pass";
  return mapping;
}

// True se una cella era di tipo numerico nel foglio originale (per avvisare l'utente in
// anteprima: potrebbe aver perso zeri iniziali prima ancora di essere letta come testo).
export function cellsToRows(aoa, mapping, headerRowIndex, numericMask) {
  const dataRows = aoa.slice(headerRowIndex + 1);
  const items = [];
  const skipped = [];
  dataRows.forEach((row, i) => {
    const absoluteRow = headerRowIndex + 1 + i;
    if (!row || row.every(c => c === undefined || c === null || String(c).trim() === "")) {
      skipped.push({ row: absoluteRow, reason: "riga vuota" });
      return;
    }
    const item = { name: "", url: "", user: "", pass: "", pin: "", totp: "", notes: "", fields: [], numericWarnings: [] };
    mapping.forEach((field, col) => {
      const raw = row[col];
      if (raw === undefined || raw === null) return;
      const text = String(raw);
      if (field) {
        const trimmed = field === "pass" || field === "pin" || field === "totp" ? text : text.trim();
        if (trimmed) item[field] = trimmed;
        if ((field === "pass" || field === "pin") && numericMask && numericMask[absoluteRow] && numericMask[absoluteRow][col]) {
          item.numericWarnings.push(field);
        }
      } else if (text.trim() !== "") {
        // colonna non mappata -> campo extra (usa l'intestazione se disponibile, altrimenti "Campo N")
        item.__extraCols = item.__extraCols || [];
        item.__extraCols.push({ col, value: text.trim() });
      }
    });
    if (!item.name && !item.pass) {
      skipped.push({ row: absoluteRow, reason: "manca nome e password: probabile riga di commento/totale" });
      return;
    }
    // Solo il nome, nient'altro (nemmeno un campo extra): probabile riga di totale/commento
    // ("Totale", "-----", intestazione di sezione ripetuta), non una voce vera.
    const hasOtherData = item.url || item.user || item.pass || item.pin || item.totp || item.notes || item.__extraCols;
    if (item.name && !hasOtherData) {
      skipped.push({ row: absoluteRow, reason: "solo il nome, nessun altro dato: probabile riga di commento/totale" });
      return;
    }
    items.push(item);
  });
  return { items, skipped };
}

export function attachExtraFields(items, headerRow) {
  for (const item of items) {
    if (!item.__extraCols) continue;
    item.fields = item.__extraCols.map(({ col, value }) => {
      const label = (headerRow && headerRow[col] != null && String(headerRow[col]).trim()) || `Campo ${col + 1}`;
      return { k: label, v: value, secret: isSecretHeader(label) };
    });
    delete item.__extraCols;
  }
  return items;
}

const dupKey = it => `${String(it.name || "").trim().toLowerCase()}::${String(it.user || "").trim().toLowerCase()}`;

// Fonde i duplicati DENTRO lo stesso file importato (es. la stessa voce corretta su due righe),
// prima ancora di confrontarli con l'archivio esistente: stessa regola, solo i campi non vuoti
// sovrascrivono, l'ultima riga vince in caso di conflitto.
function collapseDuplicatesWithinBatch(importedItems) {
  const order = [];
  const byKey = new Map();
  for (const imp of importedItems) {
    const key = dupKey(imp);
    const prev = byKey.get(key);
    if (!prev) { const copy = { ...imp }; byKey.set(key, copy); order.push(copy); continue; }
    for (const f of ["name", "url", "user", "pass", "pin", "totp", "notes"]) {
      if (imp[f]) prev[f] = imp[f];
    }
    if (imp.fields && imp.fields.length) prev.fields = [...(prev.fields || []), ...imp.fields];
  }
  return order;
}

// Punto 4.2: stesso nome normalizzato + stesso utente -> aggiorna la voce esistente solo con i
// campi non vuoti, senza creare doppioni. Ritorna il nuovo array items + contatori.
export function mergeImportedItems(existingItems, importedItems, makeId) {
  importedItems = collapseDuplicatesWithinBatch(importedItems);
  const byKey = new Map(existingItems.map(it => [dupKey(it), it]));
  let added = 0, updated = 0;
  const result = existingItems.slice();
  for (const imp of importedItems) {
    const key = dupKey(imp);
    const existing = byKey.get(key);
    if (existing) {
      let changed = false;
      for (const f of ["name", "url", "user", "pass", "pin", "totp", "notes"]) {
        if (imp[f]) { existing[f] = imp[f]; changed = true; }
      }
      if (imp.fields && imp.fields.length) { existing.fields = [...(existing.fields || []), ...imp.fields]; changed = true; }
      if (changed) { existing.updated = Date.now(); updated++; }
    } else {
      const fresh = {
        id: makeId(), name: imp.name || "(senza nome)", url: imp.url || "", user: imp.user || "",
        pass: imp.pass || "", pin: imp.pin || "", totp: imp.totp || "", notes: imp.notes || "",
        fields: imp.fields || [], logo: "", fav: false, updated: Date.now(),
      };
      result.push(fresh);
      byKey.set(key, fresh);
      added++;
    }
  }
  return { items: result, added, updated };
}

// ---------- livello file (richiede SheetJS globale `XLSX`, vendorizzato in src/vendor) ----------

function detectDelimiter(sampleText) {
  const firstLines = sampleText.split(/\r?\n/).slice(0, 5).join("\n");
  const semi = (firstLines.match(/;/g) || []).length;
  const comma = (firstLines.match(/,/g) || []).length;
  return semi > comma ? ";" : ",";
}

function decodeCsvBytes(buf) {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Legge un File (.xlsx/.xls/.csv) e ritorna { sheets: [{name, aoa, numericMask}], chosenIndex }.
// numericMask[row][col] = true se la cella era di tipo numerico nel foglio originale.
export async function readWorkbookFile(file, XLSX) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  let wb;
  if (name.endsWith(".csv")) {
    const text = decodeCsvBytes(buf);
    const FS = detectDelimiter(text);
    wb = XLSX.read(text, { type: "string", FS, raw: false });
  } else {
    wb = XLSX.read(buf, { type: "array", cellText: true });
  }
  const sheets = wb.SheetNames.map(sheetName => {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    const numericMask = {};
    const ref = ws["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.t === "n") { (numericMask[r] ||= {})[c] = true; }
        }
      }
    }
    return { name: sheetName, aoa, numericMask };
  });
  // Foglio con più righe contenenti una colonna riconoscibile come password.
  let chosenIndex = 0, bestScore = -1;
  sheets.forEach((s, i) => {
    const headerIdx = detectHeaderRowIndex(s.aoa);
    let score = 0;
    if (headerIdx >= 0) {
      const mapping = buildMapping(s.aoa[headerIdx]);
      if (mapping.includes("pass")) score = s.aoa.length - headerIdx;
    }
    if (score > bestScore) { bestScore = score; chosenIndex = i; }
  });
  return { sheets, chosenIndex };
}

export function maskPassword(v) {
  const s = String(v || "");
  return s ? "•".repeat(Math.min(10, s.length)) : "";
}
