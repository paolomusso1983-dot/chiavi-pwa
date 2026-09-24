"use strict";
import "./styles.css";
import { deriveKey, sealVault, openBlob, validBlob, genPw, uid, ITER } from "./crypto.js";
import { parseTotp, totpNow } from "./totp.js";
import * as store from "./storage.js";
import { IC } from "./icons.js";
import { esc, norm, logoHtml, wireLogos, host, href, byName, initials, hueOf } from "./presentation.js";
import { resolveDomain, resolveAndProbe, runLogoQueue, normalizeDomainInput } from "./logos.js";
import { loadXlsx } from "./vendor-loader.js";
import * as biometric from "./webauthn-unlock.js";
import {
  detectHeaderRowIndex, buildMapping, inferMappingWithoutHeader, cellsToRows,
  attachExtraFields, mergeImportedItems, maskPassword, readWorkbookFile,
} from "./excel-import.js";

const $ = s => document.querySelector(s);

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), bad ? 5200 : 2600);
}
let clipT = null;
async function copyText(text, label) {
  if (!text) return;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(t); t.select();
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    t.remove();
  }
  if (!ok) { toast("Copia automatica non disponibile qui: tieni premuto sul testo per copiarlo.", true); return; }
  toast(label + " copiato. Gli appunti si svuotano tra 30 secondi.");
  clearTimeout(clipT);
  clipT = setTimeout(() => { try { navigator.clipboard.writeText("").catch(() => {}); } catch { /* ignore */ } }, 30000);
}

const DEFAULT_META = () => ({ lockMin: 3, lastBackup: 0, dirty: false, autoLogo: true, autoLogoConsent: false, domainMap: {} });

const S = { screen: "boot", key: null, salt: null, iter: ITER, data: null, q: "", sheet: null, fails: 0, waitUntil: 0, pendingBlob: null, reveal: {}, logoQueueRunning: false, biometricRecord: null };

async function persist(changed = true) {
  if (changed) S.data.meta.dirty = true;
  const ok = await store.storeBlob(await sealVault(S));
  if (!ok) toast("Salvataggio non riuscito in questo browser. Esporta subito un backup dalle impostazioni.", true);
}

/* ---------- blocco automatico ---------- */
let idleT = null, hiddenAt = 0;
function lockMinutes() { return (S.data && S.data.meta && S.data.meta.lockMin) || 3; }
function bumpIdle() { if (!S.key) return; clearTimeout(idleT); idleT = setTimeout(lock, lockMinutes() * 60000); }
["pointerdown", "keydown", "scroll", "touchstart"].forEach(e => addEventListener(e, bumpIdle, { passive: true }));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); }
  else if (S.key && hiddenAt && Date.now() - hiddenAt > lockMinutes() * 60000) { lock(); }
});
function lock() {
  S.key = null; S.salt = null; S.data = null; S.sheet = null; S.q = ""; S.reveal = {};
  clearTimeout(idleT); closeSheet();
  Promise.all([store.loadBlob(), store.loadBiometric()]).then(([b, bio]) => {
    S.biometricRecord = bio;
    S.screen = b ? "unlock" : "setup";
    render();
  });
}

/* ---------- ricerca ---------- */
function results(q) {
  q = norm(q).trim(); if (!q) return null;
  return S.data.items.map(it => {
    const n = norm(it.name); let s = 9;
    if (n.startsWith(q)) s = 0;
    else if (n.split(/[\s.\-_]+/).some(w => w.startsWith(q))) s = 1;
    else if (n.includes(q)) s = 2;
    else if (norm(it.url).includes(q) || norm(it.user).includes(q)) s = 3;
    return [s, it];
  }).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0] || byName(a[1], b[1])).map(x => x[1]);
}

/* ---------- schermate ---------- */
function render() {
  const app = $("#app");
  if (S.screen === "setup") {
    app.innerHTML = `<div class="gate"><div class="gate-box">
      <h1 class="brand">Chiavi</h1>
      <p>Crea la master password. È l'unica che dovrai ricordare: senza di lei l'archivio non si apre, e nessuno può recuperarla.</p>
      <label class="f"><span>Master password (almeno 12 caratteri)</span><input id="p1" class="in" type="password" autocomplete="new-password"></label>
      <label class="f"><span>Ripetila</span><input id="p2" class="in" type="password" autocomplete="new-password"></label>
      <label class="check"><input id="ok" type="checkbox"><span>Ho capito che se la dimentico perdo tutti i dati salvati qui.</span></label>
      <div class="err" id="err"></div>
      <button class="btn btn-main" id="go">Crea archivio</button>
      <button class="link" id="imp">Ho già un backup: importalo</button>
    </div></div>`;
    $("#go").onclick = createVault; $("#imp").onclick = () => $("#file-backup").click();
    $("#p2").onkeydown = e => { if (e.key === "Enter") createVault(); };
    $("#p1").focus(); return;
  }
  if (S.screen === "unlock") {
    app.innerHTML = `<div class="gate"><div class="gate-box">
      <h1 class="brand">Chiavi</h1>
      <p>Archivio bloccato.</p>
      ${S.biometricRecord ? `<button class="btn btn-main u-mb14" id="bio">Sblocca con impronta/volto</button>` : ""}
      <label class="f"><span>Master password</span><input id="pw" class="in" type="password" autocomplete="current-password"></label>
      <div class="err" id="err"></div>
      <button class="btn btn-main" id="go">Sblocca</button>
      <button class="link" id="imp">Importa un backup al posto di questo archivio</button>
    </div></div>`;
    $("#go").onclick = unlock; $("#pw").onkeydown = e => { if (e.key === "Enter") unlock(); };
    $("#imp").onclick = () => $("#file-backup").click();
    if ($("#bio")) $("#bio").onclick = unlockWithBiometric;
    $("#pw").focus(); return;
  }
  if (S.screen === "home") {
    const m = S.data.meta;
    app.innerHTML = `<div class="wrap">
      <div class="top"><h1>Chiavi</h1>
        <button class="icon-btn" id="add" title="Nuova voce" aria-label="Nuova voce">${IC.plus}</button>
        <button class="icon-btn" id="set" title="Impostazioni" aria-label="Impostazioni">${IC.gear}</button>
        <button class="icon-btn" id="lk" title="Blocca" aria-label="Blocca">${IC.lock}</button>
      </div>
      <div class="search">${IC.search}<input id="q" type="search" placeholder="Cerca un sito o un'app" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.q)}" aria-label="Cerca"></div>
      ${m.dirty && S.data.items.length ? `<div class="banner"><span>Ci sono modifiche non ancora salvate in un backup${m.lastBackup ? "" : " (nessun backup fatto finora)"}.</span><button class="btn btn-sm" id="bk">Esporta backup</button></div>` : ""}
      <div id="grid"></div>
    </div>`;
    $("#add").onclick = () => openSheet({ type: "edit", id: null });
    $("#set").onclick = () => openSheet({ type: "settings" });
    $("#lk").onclick = lock;
    if ($("#bk")) $("#bk").onclick = exportBackup;
    const q = $("#q");
    q.oninput = () => { S.q = q.value; renderGrid(); };
    q.onkeydown = e => { if (e.key === "Enter") { const r = results(S.q); if (r && r.length) openSheet({ type: "detail", id: r[0].id }); } if (e.key === "Escape") { q.value = ""; S.q = ""; renderGrid(); } };
    renderGrid();
    if (matchMedia("(pointer:fine)").matches) q.focus();
  }
}
function tiles(list) { return list.map(it => `<button class="tile" data-id="${esc(it.id)}">${logoHtml(it, S.data.meta)}<span>${esc(it.name)}</span></button>`).join(""); }
function renderGrid() {
  const g = $("#grid"); if (!g) return;
  const items = S.data.items;
  if (!items.length) {
    g.innerHTML = `<div class="empty"><strong>Nessuna voce ancora</strong>Aggiungi il primo sito o app, oppure importa un file Excel con le password già registrate.
      <div class="actions"><button class="btn btn-main" id="first">Aggiungi voce</button><button class="btn" id="firstx">Importa da Excel</button></div></div>`;
    $("#first").onclick = () => openSheet({ type: "edit", id: null });
    $("#firstx").onclick = () => $("#file-excel").click();
    return;
  }
  const r = results(S.q);
  if (r) {
    g.innerHTML = r.length ? `<div class="grid">${tiles(r)}</div>` : `<div class="empty"><strong>Nessun risultato per "${esc(S.q)}"</strong><button class="btn btn-sm" id="newq">Crea "${esc(S.q)}"</button></div>`;
    if ($("#newq")) $("#newq").onclick = () => openSheet({ type: "edit", id: null, preset: S.q.trim() });
  } else {
    const fav = items.filter(i => i.fav).sort(byName), all = [...items].sort(byName);
    g.innerHTML = (fav.length ? `<div class="group-title">Preferiti</div><div class="grid">${tiles(fav)}</div>` : "")
      + `<div class="group-title">Tutte le voci (${all.length})</div><div class="grid">${tiles(all)}</div>`;
  }
  g.querySelectorAll(".tile").forEach(b => b.onclick = () => openSheet({ type: "detail", id: b.dataset.id }));
  wireLogos(g);
}

/* ---------- ingresso ---------- */
async function createVault() {
  const p1 = $("#p1").value, p2 = $("#p2").value, err = $("#err");
  if (p1.length < 12) { err.textContent = "Servono almeno 12 caratteri. Una frase di 4-5 parole va benissimo."; return; }
  if (p1 !== p2) { err.textContent = "Le due password non coincidono."; return; }
  if (!$("#ok").checked) { err.textContent = "Conferma di aver capito che la password non è recuperabile."; return; }
  $("#go").disabled = true; $("#go").textContent = "Creazione…";
  S.salt = crypto.getRandomValues(new Uint8Array(16)); S.iter = ITER;
  S.key = await deriveKey(p1, S.salt, S.iter);
  S.data = { items: [], meta: DEFAULT_META() };
  await persist(false); S.screen = "home"; bumpIdle(); render();
}
// Nucleo comune tra sblocco con password e con impronta/volto: apre il blob con la password
// ottenuta (in chiaro, per il tempo minimo necessario) e passa alla home.
async function performUnlock(pw) {
  const r = await openBlob(S._unlockBlob, pw);
  Object.assign(S, { key: r.key, salt: r.salt, iter: r.iter, data: r.data, fails: 0, screen: "home" });
  S.data.meta = Object.assign(DEFAULT_META(), S.data.meta || {});
  bumpIdle(); render();
}
async function unlock() {
  const err = $("#err"), btn = $("#go"), pw = $("#pw").value;
  const wait = S.waitUntil - Date.now();
  if (wait > 0) { err.textContent = `Troppi tentativi. Riprova tra ${Math.ceil(wait / 1000)} secondi.`; return; }
  if (!pw) return;
  const blob = await store.loadBlob();
  if (!validBlob(blob)) { err.textContent = "Archivio non leggibile in questo browser. Importa un backup."; return; }
  S._unlockBlob = blob;
  btn.disabled = true; btn.textContent = "Sblocco…";
  try {
    await performUnlock(pw);
  } catch {
    S.fails++; if (S.fails >= 3) S.waitUntil = Date.now() + Math.min(2 ** (S.fails - 2), 60) * 1000;
    btn.disabled = false; btn.textContent = "Sblocca";
    err.textContent = "Password errata."; $("#pw").select();
  }
}
async function unlockWithBiometric() {
  const btn = $("#bio"); if (btn) { btn.disabled = true; btn.textContent = "Verifica…"; }
  try {
    const blob = await store.loadBlob();
    if (!validBlob(blob)) throw new Error("Archivio non leggibile in questo browser. Importa un backup.");
    S._unlockBlob = blob;
    const pw = await biometric.unlock(S.biometricRecord);
    await performUnlock(pw);
  } catch (e) {
    toast((e && e.message) || "Sblocco con impronta/volto non riuscito.", true);
    if (btn) { btn.disabled = false; btn.textContent = "Sblocca con impronta/volto"; }
  }
}

/* ---------- pannelli ---------- */
let totpTimer = null;
function closeSheet() { S.sheet = null; $("#layer").innerHTML = ""; clearInterval(totpTimer); S.reveal = {}; }
function openSheet(sh) { S.sheet = sh; S.reveal = {}; drawSheet(); }
function sheetShell(inner) {
  $("#layer").innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
  $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.sheet) { closeSheet(); } });

function drawSheet() {
  clearInterval(totpTimer);
  const sh = S.sheet; if (!sh) return;
  if (sh.type === "detail") return drawDetail(sh.id);
  if (sh.type === "edit") return drawEdit(sh);
  if (sh.type === "settings") return drawSettings();
  if (sh.type === "import") return drawImportBackup();
  if (sh.type === "logoConsent") return drawLogoConsent(sh);
  if (sh.type === "excelPreview") return drawExcelPreview(sh);
  if (sh.type === "excelDone") return drawExcelDone(sh);
  if (sh.type === "biometricSetup") return drawBiometricSetup();
}

function fieldRow(label, value, key, secret) {
  const shown = !secret || S.reveal[key];
  const v = shown ? esc(value) : "•".repeat(Math.min(12, String(value).length || 8));
  return `<div class="fld"><div class="txt"><div class="k">${esc(label)}</div><div class="v ${secret ? "mono" : ""}">${v}</div></div>
    <div class="acts">${secret ? `<button class="btn btn-sm" data-rev="${esc(key)}" aria-label="${shown ? "Nascondi" : "Mostra"} ${esc(label)}">${IC.eye}</button>` : ""}
    <button class="btn btn-sm" data-copy="${esc(key)}" aria-label="Copia ${esc(label)}">${IC.copy}</button></div></div>`;
}
function drawDetail(id) {
  const it = S.data.items.find(i => i.id === id); if (!it) { closeSheet(); return; }
  const vals = {}; let rows = "";
  if (it.user) { vals.user = it.user; rows += fieldRow("Nome utente", it.user, "user", false); }
  if (it.pass) { vals.pass = it.pass; rows += fieldRow("Password", it.pass, "pass", true); }
  if (it.pin) { vals.pin = it.pin; rows += fieldRow("PIN", it.pin, "pin", true); }
  let cfg = null;
  if (it.totp) {
    try { cfg = parseTotp(it.totp); } catch { cfg = null; }
    rows += cfg ? `<div class="fld"><div class="txt"><div class="k">Codice di verifica</div><div class="v totp-v mono" id="tc">······</div></div>
      <svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" stroke-width="4"/><circle id="tr" cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" stroke-width="4" stroke-dasharray="94.25" transform="rotate(-90 18 18)"/></svg>
      <div class="acts"><button class="btn btn-sm" id="tcopy" aria-label="Copia codice">${IC.copy}</button></div></div>`
      : `<div class="fld"><div class="txt"><div class="k">Codice di verifica</div><div class="v u-danger-sm">Chiave 2FA non valida: correggila in Modifica.</div></div></div>`;
  }
  (it.fields || []).forEach((f, i) => { if (f.v) { vals["f" + i] = f.v; rows += fieldRow(f.k || "Campo", f.v, "f" + i, !!f.secret); } });
  const noLogoHint = !it.logo && !it.logoDomain
    ? `<p class="hint u-mtn4">Logo non trovato: aggiungi l'indirizzo del sito in Modifica per farlo cercare di nuovo.</p>` : "";
  sheetShell(`<div class="sh-head">${logoHtml(it, S.data.meta, "logo lg")}<div class="grow"><h2>${esc(it.name)}${it.fav ? ' <span class="star" aria-label="Preferito">★</span>' : ""}</h2>
      ${it.url ? `<div class="sub"><a href="${esc(href(it.url))}" target="_blank" rel="noopener noreferrer">${esc(host(it.url))}</a></div>` : ""}</div></div>
    ${noLogoHint}
    ${rows ? `<div class="fields">${rows}</div>` : `<p class="u-muted">Nessun dato salvato per questa voce.</p>`}
    ${it.notes ? `<div class="notes">${esc(it.notes)}</div>` : ""}
    <div class="sh-actions"><button class="btn" id="fav" aria-pressed="${it.fav}"><span class="star">${it.fav ? "★" : "☆"}</span> Preferito</button><span class="spacer"></span>
      <button class="btn" id="cl">Chiudi</button><button class="btn btn-main" id="ed">Modifica</button></div>`);
  wireLogos($("#layer"));
  document.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
    const k = b.dataset.copy; const lbl = k === "user" ? "Nome utente" : k === "pass" ? "Password" : k === "pin" ? "PIN" : ((it.fields[+k.slice(1)] || {}).k || "Campo");
    copyText(vals[k], lbl);
  });
  document.querySelectorAll("[data-rev]").forEach(b => b.onclick = () => { S.reveal[b.dataset.rev] = !S.reveal[b.dataset.rev]; const keep = S.reveal; drawDetail(id); S.reveal = keep; });
  $("#cl").onclick = closeSheet;
  $("#ed").onclick = () => openSheet({ type: "edit", id });
  $("#fav").onclick = async () => { it.fav = !it.fav; await persist(); drawDetail(id); render(); };
  if (cfg) {
    let current = "";
    const tick = async () => {
      const el = $("#tc"); if (!el) { clearInterval(totpTimer); return; }
      try { current = await totpNow(cfg); el.textContent = current.slice(0, Math.ceil(current.length / 2)) + " " + current.slice(Math.ceil(current.length / 2)); } catch { el.textContent = "errore"; }
      const left = cfg.period - (Math.floor(Date.now() / 1000) % cfg.period);
      const r = $("#tr"); if (r) r.setAttribute("stroke-dashoffset", String(94.25 * (1 - left / cfg.period)));
    };
    tick(); totpTimer = setInterval(tick, 1000);
    $("#tcopy").onclick = () => copyText(current, "Codice");
  }
}

function drawEdit(sh) {
  const ex = sh.id ? S.data.items.find(i => i.id === sh.id) : null;
  const d = sh.draft || (ex ? JSON.parse(JSON.stringify(ex)) : { id: uid(), name: sh.preset || "", url: "", user: "", pass: "", pin: "", totp: "", notes: "", fields: [], logo: "", logoDomain: "", logoSource: "", fav: false });
  sh.draft = d;
  const extras = d.fields.map((f, i) => `<div class="extra">
      <div class="row-in"><input class="in" data-fk="${i}" placeholder="Etichetta (es. Codice cliente)" value="${esc(f.k)}"><button class="btn btn-sm" data-frm="${i}" aria-label="Rimuovi campo">Rimuovi</button></div>
      <div class="u-h8"></div><input class="in" data-fv="${i}" placeholder="Valore" value="${esc(f.v)}">
      <label class="check u-mt8"><input type="checkbox" data-fs="${i}" ${f.secret ? "checked" : ""}><span>Nascondi (come una password)</span></label></div>`).join("");
  sheetShell(`<div class="sh-head"><div class="grow"><h2>${ex ? "Modifica voce" : "Nuova voce"}</h2></div></div>
    <div class="logo-edit">${logoHtml(d, S.data.meta, "logo lg")}<div><button class="btn btn-sm" id="lg">Carica logo</button> <button class="btn btn-sm" id="lgs">Cerca logo</button> ${d.logo || d.logoDomain ? `<button class="btn btn-sm" id="lgx">Togli logo</button>` : ""}
      <div class="hint u-mt6">Senza logo viene mostrata l'iniziale colorata.</div></div></div>
    <label class="f"><span>Nome (quello che cercherai)</span><input class="in" id="e-name" value="${esc(d.name)}" placeholder="Fineco"></label>
    <label class="f"><span>Indirizzo del sito</span><input class="in" id="e-url" value="${esc(d.url)}" placeholder="finecobank.com" autocapitalize="off" spellcheck="false"></label>
    <label class="f"><span>Nome utente / codice cliente / email</span><input class="in" id="e-user" value="${esc(d.user)}" autocapitalize="off" spellcheck="false"></label>
    <label class="f"><span>Password</span><div class="row-in"><input class="in mono" id="e-pass" type="password" value="${esc(d.pass)}" autocomplete="off" spellcheck="false">
      <button class="btn btn-sm" id="shp" type="button" aria-label="Mostra password">${IC.eye}</button><button class="btn btn-sm" id="gen" type="button">Genera</button></div></label>
    <label class="f"><span>PIN</span><input class="in mono" id="e-pin" value="${esc(d.pin)}" autocomplete="off"></label>
    <label class="f"><span>Chiave 2FA (facoltativa)</span><input class="in mono" id="e-totp" value="${esc(d.totp)}" placeholder="JBSW Y3DP … oppure otpauth://…" autocapitalize="off" spellcheck="false"></label>
    <div class="hint">È il codice segreto mostrato quando attivi la verifica in due passaggi ("inserisci la chiave manualmente"). Non funziona per le banche che usano la propria app.</div>
    <div class="group-title">Altri campi</div>
    ${extras}
    <button class="btn btn-sm u-mb16" id="addf">Aggiungi campo</button>
    <label class="f"><span>Note</span><textarea class="in" id="e-notes">${esc(d.notes)}</textarea></label>
    <label class="check"><input type="checkbox" id="e-fav" ${d.fav ? "checked" : ""}><span>Mostra tra i preferiti</span></label>
    <div class="err" id="err"></div>
    <div class="sh-actions">${ex ? `<button class="btn btn-danger" id="del">Elimina</button>` : ""}<span class="spacer"></span>
      <button class="btn" id="cn">Annulla</button><button class="btn btn-main" id="sv">Salva</button></div>`);
  wireLogos($("#layer"));
  const sync = () => {
    d.name = $("#e-name").value; d.url = $("#e-url").value.trim(); d.user = $("#e-user").value; d.pass = $("#e-pass").value;
    d.pin = $("#e-pin").value; d.totp = $("#e-totp").value.trim(); d.notes = $("#e-notes").value; d.fav = $("#e-fav").checked;
    document.querySelectorAll("[data-fk]").forEach(x => d.fields[+x.dataset.fk].k = x.value);
    document.querySelectorAll("[data-fv]").forEach(x => d.fields[+x.dataset.fv].v = x.value);
    document.querySelectorAll("[data-fs]").forEach(x => d.fields[+x.dataset.fs].secret = x.checked);
  };
  $("#shp").onclick = () => { const p = $("#e-pass"); p.type = p.type === "password" ? "text" : "password"; };
  $("#gen").onclick = () => { const p = $("#e-pass"); if (p.value && !confirm("Sostituire la password attuale con una nuova generata?")) return; p.value = genPw(20); p.type = "text"; };
  $("#addf").onclick = () => { sync(); d.fields.push({ k: "", v: "", secret: false }); drawEdit(sh); };
  document.querySelectorAll("[data-frm]").forEach(b => b.onclick = () => { sync(); d.fields.splice(+b.dataset.frm, 1); drawEdit(sh); });
  $("#lg").onclick = () => { sync(); $("#file-logo").click(); };
  if ($("#lgx")) $("#lgx").onclick = () => { sync(); d.logo = ""; d.logoDomain = ""; d.logoSource = ""; drawEdit(sh); };
  $("#lgs").onclick = async () => {
    sync();
    if (!d.name.trim() && !d.url.trim()) { $("#err").textContent = "Serve almeno un nome o l'indirizzo del sito."; return; }
    const btn = $("#lgs"); btn.disabled = true; btn.textContent = "Cerco…";
    const found = await searchLogoForDraft(d);
    btn.disabled = false; btn.textContent = "Cerca logo";
    if (found) { drawEdit(sh); toast("Logo trovato."); } else { toast("Nessun logo trovato per questo nome/indirizzo.", true); }
  };
  $("#cn").onclick = () => ex ? openSheet({ type: "detail", id: ex.id }) : closeSheet();
  if ($("#del")) $("#del").onclick = async () => {
    if (!confirm(`Eliminare "${ex.name}"? L'operazione non si può annullare.`)) return;
    S.data.items = S.data.items.filter(i => i.id !== ex.id); await persist(); closeSheet(); render(); toast("Voce eliminata");
  };
  $("#sv").onclick = async () => {
    sync();
    if (!d.name.trim()) { $("#err").textContent = "Serve almeno il nome."; $("#e-name").focus(); return; }
    if (d.totp) { try { parseTotp(d.totp); } catch { $("#err").textContent = "La chiave 2FA non è valida: controlla di averla copiata tutta."; return; } }
    d.name = d.name.trim(); d.fields = d.fields.filter(f => f.k.trim() || f.v); d.updated = Date.now();
    const domainChanged = !ex || normalizeDomainInput(ex.url) !== normalizeDomainInput(d.url);
    const i = S.data.items.findIndex(x => x.id === d.id);
    if (i >= 0) S.data.items[i] = d; else S.data.items.push(d);
    await persist(); render(); openSheet({ type: "detail", id: d.id }); toast("Voce salvata");
    // punto 4 del flusso logo: al salvataggio, se il dominio è cambiato e il logo è vuoto, cerca.
    if (!d.logo && !d.logoDomain && (domainChanged || !ex)) requestAutoLogoSearch([d]);
  };
}
$("#file-logo").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !S.sheet || S.sheet.type !== "edit") return;
  try { S.sheet.draft.logo = await shrinkImage(f); S.sheet.draft.logoDomain = ""; S.sheet.draft.logoSource = ""; drawEdit(S.sheet); } catch { toast("Immagine non leggibile. Prova con un PNG o JPG.", true); }
};
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = 128, c = document.createElement("canvas"); c.width = c.height = s; const x = c.getContext("2d");
        x.fillStyle = "#fff"; x.fillRect(0, 0, s, s);
        const k = Math.min(s / img.width, s / img.height), w = img.width * k, h = img.height * k; x.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
        res(c.toDataURL("image/png"));
      };
      img.onerror = rej; img.src = r.result;
    };
    r.onerror = rej; r.readAsDataURL(file);
  });
}

/* ---------- logo automatico: consenso, ricerca singola e in coda ---------- */
async function searchLogoForDraft(d) {
  const found = await resolveAndProbe(d, S.data.meta, { autoLogo: S.data.meta.autoLogo !== false });
  if (!found) return false;
  d.logoDomain = found.domain; d.logoSource = found.source;
  rememberDomainIfNeeded(d.name, found.domain, found.via);
  return true;
}
function rememberDomainIfNeeded(name, domain, via) {
  if (via !== "url" && via !== "nameservice" && via !== "heuristic") return;
  const n = norm(name);
  if (!n) return;
  S.data.meta.domainMap[n] = domain;
}
// Chiede conferma solo la prima volta in assoluto (punto 3.5), poi rispetta l'interruttore.
function requestAutoLogoSearch(items) {
  if (!S.data.meta.autoLogoConsent) {
    openSheet({ type: "logoConsent", pending: items });
    return;
  }
  if (S.data.meta.autoLogo === false) return;
  runQueueInBackground(items);
}
function drawLogoConsent(sh) {
  sheetShell(`<div class="sh-head"><div class="grow"><h2>Cercare i loghi automaticamente?</h2></div></div>
    <p>Per trovare il logo di un sito, Chiavi invia <strong>solo il nome del dominio</strong> (mai utente o password) a Google, DuckDuckGo o al servizio di ricerca aziende Clearbit. Chi gestisce questi servizi può dedurre quali siti hai in archivio.</p>
    <p class="u-muted-sm">Puoi cambiare idea in qualsiasi momento dalle Impostazioni.</p>
    <div class="sh-actions"><span class="spacer"></span><button class="btn" id="no">No, disattiva</button><button class="btn btn-main" id="yes">Va bene, cerca</button></div>`);
  $("#no").onclick = async () => { S.data.meta.autoLogo = false; S.data.meta.autoLogoConsent = true; await persist(false); closeSheet(); toast("Ricerca automatica dei loghi disattivata."); };
  $("#yes").onclick = async () => {
    S.data.meta.autoLogo = true; S.data.meta.autoLogoConsent = true; await persist(false); closeSheet();
    runQueueInBackground(sh.pending || S.data.items.filter(it => !it.logo && !it.logoDomain));
  };
}
async function runQueueInBackground(items) {
  if (S.logoQueueRunning || !items.length) return;
  S.logoQueueRunning = true;
  await runLogoQueue(items, S.data.meta, {
    autoLogo: S.data.meta.autoLogo !== false,
    onItemResolved: async (item, result) => {
      if (result) { item.logoDomain = result.domain; item.logoSource = result.source; rememberDomainIfNeeded(item.name, result.domain, result.via); }
    },
  });
  S.logoQueueRunning = false;
  await persist(false);
  render();
  if (S.sheet && S.sheet.type === "detail") drawDetail(S.sheet.id);
  if (S.sheet && S.sheet.type === "settings") drawSettings();
}

/* ---------- impostazioni ---------- */
function drawSettings() {
  const m = S.data.meta;
  const last = m.lastBackup ? new Date(m.lastBackup).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "mai";
  const missing = S.data.items.filter(it => !it.logo && !it.logoDomain).length;
  sheetShell(`<div class="sh-head"><div class="grow"><h2>Impostazioni</h2></div></div>
    <label class="f"><span>Blocco automatico dopo inattività</span><select class="in" id="lm">
      ${[1, 3, 5, 10, 15].map(n => `<option value="${n}" ${n === m.lockMin ? "selected" : ""}>${n} ${n === 1 ? "minuto" : "minuti"}</option>`).join("")}</select></label>
    <div class="sect"><h3>Logo automatico</h3>
      <div class="switch-row"><div class="txt"><strong>Cerca i loghi in automatico</strong><span>Invia solo il nome del dominio a Google/DuckDuckGo/Clearbit. Se spento, nessuna richiesta di rete.</span></div>
        <button class="switch" id="autologo" role="switch" aria-pressed="${m.autoLogo !== false}"></button></div>
      <p class="u-p10">Voci senza logo: ${missing}.</p>
      <div class="sh-actions"><button class="btn" id="findlogos" ${missing === 0 || m.autoLogo === false ? "disabled" : ""}>${S.logoQueueRunning ? "Ricerca in corso…" : "Cerca loghi mancanti"}</button></div></div>
    <div class="sect"><h3>Sblocco con impronta/volto</h3>
      <p id="bio-status" class="u-muted-sm">Verifica disponibilità su questo dispositivo…</p>
      <div class="sh-actions"><button class="btn ${S.biometricRecord ? "btn-danger" : "btn-main"}" id="biotoggle">${S.biometricRecord ? "Disattiva" : "Attiva"}</button></div></div>
    <div class="sect"><h3>Importa da Excel</h3>
      <p>Importa un file .xlsx, .xls o .csv con le password già registrate altrove.</p>
      <button class="btn" id="impx">Importa da Excel</button></div>
    <div class="sect"><h3>Backup</h3>
      <p>L'archivio è salvato solo in questo dispositivo (IndexedDB del browser). Se disinstalli l'app o cancelli i dati del browser lo perdi. Il backup è un file cifrato: senza la master password è illeggibile. Tienine una copia fuori dal telefono. Ultimo backup: ${esc(last)}.</p>
      <div class="sh-actions"><button class="btn btn-main" id="ex">Esporta backup</button><button class="btn" id="im">Importa backup</button></div></div>
    <div class="sect"><h3>Cambia master password</h3>
      <label class="f"><span>Password attuale</span><input class="in" id="c0" type="password" autocomplete="current-password"></label>
      <label class="f"><span>Nuova password (almeno 12 caratteri)</span><input class="in" id="c1" type="password" autocomplete="new-password"></label>
      <label class="f"><span>Ripeti la nuova</span><input class="in" id="c2" type="password" autocomplete="new-password"></label>
      <div class="err" id="cerr"></div><button class="btn" id="cp">Cambia password</button>
      <p class="u-mt10">I backup già esportati restano apribili solo con la vecchia password.</p></div>
    <div class="sect"><h3>Cancella tutto</h3><p>Elimina l'archivio da questo dispositivo. I backup esportati non vengono toccati.</p>
      <button class="btn btn-danger" id="wipe">Cancella archivio</button></div>
    <div class="sh-actions u-mt8t"><span class="spacer"></span><button class="btn" id="cl">Chiudi</button></div>`);
  $("#lm").onchange = async e => { m.lockMin = +e.target.value; await persist(false); bumpIdle(); toast("Blocco automatico: " + m.lockMin + " min"); };
  $("#autologo").onclick = async () => { m.autoLogo = m.autoLogo === false; m.autoLogoConsent = true; await persist(false); drawSettings(); };
  $("#findlogos").onclick = () => { const missingItems = S.data.items.filter(it => !it.logo && !it.logoDomain); requestAutoLogoSearch(missingItems); drawSettings(); };
  refreshBiometricStatus();
  $("#biotoggle").onclick = () => {
    if (S.biometricRecord) {
      if (!confirm("Disattivare lo sblocco con impronta/volto? Potrai comunque sempre usare la master password.")) return;
      store.clearBiometric().then(() => { S.biometricRecord = null; drawSettings(); toast("Sblocco con impronta/volto disattivato."); });
    } else {
      openSheet({ type: "biometricSetup" });
    }
  };
  $("#impx").onclick = () => $("#file-excel").click();
  $("#ex").onclick = exportBackup;
  $("#im").onclick = () => $("#file-backup").click();
  $("#cl").onclick = closeSheet;
  $("#cp").onclick = changeMaster;
  $("#wipe").onclick = () => {
    const t = prompt('Per cancellare tutto scrivi ELIMINA'); if (t !== "ELIMINA") return;
    store.wipeStore().then(() => { S.key = null; S.data = null; closeSheet(); S.screen = "setup"; render(); toast("Archivio cancellato"); });
  };
}
async function changeMaster() {
  const c0 = $("#c0").value, c1 = $("#c1").value, c2 = $("#c2").value, err = $("#cerr");
  if (c1.length < 12) { err.textContent = "La nuova password deve avere almeno 12 caratteri."; return; }
  if (c1 !== c2) { err.textContent = "Le due nuove password non coincidono."; return; }
  const btn = $("#cp"); btn.disabled = true; btn.textContent = "Verifica…";
  try { const b = await sealVault(S); await openBlob(b, c0); } catch { err.textContent = "La password attuale è errata."; btn.disabled = false; btn.textContent = "Cambia password"; return; }
  S.salt = crypto.getRandomValues(new Uint8Array(16)); S.iter = ITER; S.key = await deriveKey(c1, S.salt, S.iter);
  S.data.meta.dirty = true; await persist(false);
  // Lo sblocco biometrico cifra la VECCHIA master password: dopo il cambio non serve più a
  // niente (anzi sbloccherebbe con la password sbagliata), va rifatto da capo.
  if (S.biometricRecord) {
    await store.clearBiometric(); S.biometricRecord = null;
    toast("Master password cambiata. Lo sblocco con impronta/volto è stato disattivato: riattivalo dalle Impostazioni. Esporta un nuovo backup.");
  } else {
    toast("Master password cambiata. Esporta un nuovo backup.");
  }
  drawSettings();
}

/* ---------- sblocco con impronta/volto ---------- */
async function refreshBiometricStatus() {
  const el = $("#bio-status");
  if (!el) return;
  if (!biometric.isPlatformAuthenticatorPossible()) { el.textContent = "Il tuo browser non supporta questa funzione."; return; }
  const avail = await biometric.isPlatformAuthenticatorAvailable();
  const stillThere = $("#bio-status"); if (!stillThere) return; // impostazioni chiuse nel frattempo
  stillThere.textContent = avail
    ? (S.biometricRecord ? "Attivo su questo dispositivo." : "Disponibile su questo dispositivo: puoi attivarlo.")
    : "Non risulta disponibile: nessuna impronta/volto configurato in questo browser/dispositivo.";
}
function drawBiometricSetup() {
  sheetShell(`<div class="sh-head"><div class="grow"><h2>Attiva impronta/volto</h2></div></div>
    <p>Inserisci la master password attuale: serve una sola volta, per collegarla in modo sicuro all'impronta/volto di questo dispositivo. Il telefono chiederà poi la verifica biometrica.</p>
    <label class="f"><span>Master password attuale</span><input class="in" id="bp" type="password" autocomplete="current-password"></label>
    <div class="err" id="berr"></div>
    <div class="sh-actions"><span class="spacer"></span><button class="btn" id="cl">Annulla</button><button class="btn btn-main" id="go">Continua</button></div>`);
  $("#bp").focus();
  $("#cl").onclick = () => openSheet({ type: "settings" });
  const run = async () => {
    const pw = $("#bp").value, err = $("#berr"), btn = $("#go");
    if (!pw) return;
    btn.disabled = true; btn.textContent = "Verifica…";
    try { const b = await sealVault(S); await openBlob(b, pw); } catch {
      err.textContent = "Password errata."; btn.disabled = false; btn.textContent = "Continua"; return;
    }
    try {
      const record = await biometric.enable(pw);
      const ok = await store.saveBiometric(record);
      if (!ok) throw new Error("Salvataggio non riuscito su questo dispositivo.");
      S.biometricRecord = record;
      openSheet({ type: "settings" });
      toast("Sblocco con impronta/volto attivato.");
    } catch (e) {
      err.textContent = (e && e.message) || "Attivazione non riuscita.";
      btn.disabled = false; btn.textContent = "Continua";
    }
  };
  $("#go").onclick = run; $("#bp").onkeydown = e => { if (e.key === "Enter") run(); };
}

async function exportBackup() {
  const name = "chiavi-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  const txt = JSON.stringify(await sealVault(S));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  S.data.meta.lastBackup = Date.now(); S.data.meta.dirty = false; await persist(false);
  render(); if (S.sheet && S.sheet.type === "settings") drawSettings(); toast("Backup esportato");
}

$("#file-backup").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  let blob = null; try { blob = JSON.parse(await f.text()); } catch { /* not json */ }
  if (!validBlob(blob)) { toast("Questo file non è un backup di Chiavi.", true); return; }
  S.pendingBlob = blob; openSheet({ type: "import" });
};
function drawImportBackup() {
  sheetShell(`<div class="sh-head"><div class="grow"><h2>Importa backup</h2></div></div>
    <p class="u-muted u-mt0">Inserisci la master password con cui è stato creato il backup. L'archivio attuale in questo dispositivo verrà sostituito.</p>
    <label class="f"><span>Master password del backup</span><input class="in" id="ip" type="password" autocomplete="off"></label>
    <div class="err" id="ierr"></div>
    <div class="sh-actions"><span class="spacer"></span><button class="btn" id="cl">Annulla</button><button class="btn btn-main" id="go">Apri e sostituisci</button></div>`);
  $("#ip").focus();
  $("#cl").onclick = () => { S.pendingBlob = null; closeSheet(); };
  const run = async () => {
    const btn = $("#go"); btn.disabled = true; btn.textContent = "Apertura…";
    try {
      const r = await openBlob(S.pendingBlob, $("#ip").value);
      const n = (r.data.items || []).length;
      if (S.key && !confirm(`Sostituire l'archivio attuale (${S.data.items.length} voci) con il backup (${n} voci)?`)) { btn.disabled = false; btn.textContent = "Apri e sostituisci"; return; }
      Object.assign(S, { key: r.key, salt: r.salt, iter: r.iter, data: r.data, screen: "home", pendingBlob: null, fails: 0 });
      S.data.meta = Object.assign(DEFAULT_META(), S.data.meta || {});
      await persist(false); closeSheet(); bumpIdle(); render(); toast(`Backup importato: ${n} voci`);
    } catch { $("#ierr").textContent = "Password errata o file danneggiato."; btn.disabled = false; btn.textContent = "Apri e sostituisci"; }
  };
  $("#go").onclick = run; $("#ip").onkeydown = e => { if (e.key === "Enter") run(); };
}

/* ---------- importazione da Excel (sezione 4/5) ---------- */
$("#file-excel").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  toast("Lettura del file…");
  try {
    const XLSX = await loadXlsx();
    const { sheets, chosenIndex } = await readWorkbookFile(f, XLSX);
    const sheet = sheets[chosenIndex];
    let headerRowIndex = detectHeaderRowIndex(sheet.aoa);
    let mapping, headerRow;
    if (headerRowIndex >= 0) {
      headerRow = sheet.aoa[headerRowIndex];
      mapping = buildMapping(headerRow);
    } else {
      headerRowIndex = -1;
      mapping = inferMappingWithoutHeader(sheet.aoa);
      headerRow = [];
    }
    const hasNameOrPass = mapping.includes("name") || mapping.includes("pass");
    if (!hasNameOrPass) {
      toast("Non riesco a riconoscere nessuna colonna come nome o password: controlla la mappatura.", true);
    }
    const { items, skipped } = cellsToRows(sheet.aoa, mapping, headerRowIndex, sheet.numericMask);
    attachExtraFields(items, headerRow);
    openSheet({ type: "excelPreview", fileName: f.name, sheet, headerRow, headerRowIndex, mapping, items, skipped, needsManualMap: !hasNameOrPass });
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/password/i.test(msg)) {
      toast("Questo file Excel è protetto da password. Aprilo in Excel/LibreOffice, rimuovi la protezione (File → Proteggi cartella di lavoro → Rimuovi password) e riprova.", true);
    } else {
      toast("Non riesco a leggere questo file: " + msg, true);
    }
  }
};

function drawExcelPreview(sh) {
  const { items, skipped, fileName } = sh;
  const numericWarn = items.filter(it => it.numericWarnings && it.numericWarnings.length);
  // Simulazione (stesso codice del punto 4.2, non una stima approssimata) solo per i contatori
  // dell'anteprima: non tocca S.data, che viene aggiornato davvero solo al click "Importa".
  const dryRun = mergeImportedItems(S.data.items.map(it => ({ ...it })), items, () => "preview");
  const willAdd = dryRun.added, willUpdate = dryRun.updated;
  const preview = items.slice(0, 5).map(it => `<tr><td>${esc(it.name || "—")}</td><td>${esc(it.user || "—")}</td><td class="mono">${esc(maskPassword(it.pass))}</td><td>${esc(it.url || "—")}</td></tr>`).join("");
  sheetShell(`<div class="sh-head"><div class="grow"><h2>Importa "${esc(fileName)}"</h2><div class="sub">Foglio: ${esc(sh.sheet.name)}</div></div></div>
    <div class="stat-row">
      <div class="stat"><b>${willAdd}</b><span>Nuove voci</span></div>
      <div class="stat"><b>${willUpdate}</b><span>Voci aggiornate</span></div>
      <div class="stat"><b>${skipped.length}</b><span>Righe saltate</span></div>
    </div>
    ${sh.needsManualMap ? `<p class="err u-minh-auto">Nessuna colonna riconosciuta come nome o password: verifica il file prima di importare.</p>` : ""}
    ${numericWarn.length ? `<p class="hint u-brass">${numericWarn.length} voci avevano password/PIN in una cella numerica: controlla che eventuali zeri iniziali non si siano persi.</p>` : ""}
    <div class="group-title">Anteprima (prime 5 righe, password mascherate)</div>
    <div class="table-wrap"><table class="imp"><thead><tr><th>Nome</th><th>Utente</th><th>Password</th><th>Indirizzo</th></tr></thead><tbody>${preview || `<tr><td colspan="4">Nessuna riga da importare.</td></tr>`}</tbody></table></div>
    ${skipped.length ? `<details class="u-mb14"><summary class="u-summary">Righe saltate (${skipped.length})</summary><ul class="warn-list">${skipped.slice(0, 20).map(s => `<li>Riga ${s.row + 1}: ${esc(s.reason)}</li>`).join("")}</ul></details>` : ""}
    <p class="hint">Il file resta solo in questa pagina: non viene salvato né inviato in rete. Dopo l'importazione, elimina il file Excel dal telefono, dal cestino e da eventuali cloud (Drive, OneDrive, allegati email).</p>
    <div class="sh-actions"><span class="spacer"></span><button class="btn" id="cn">Annulla</button><button class="btn btn-main" id="go" ${!items.length ? "disabled" : ""}>Importa</button></div>`);
  $("#cn").onclick = closeSheet;
  $("#go").onclick = async () => {
    const btn = $("#go"); btn.disabled = true; btn.textContent = "Importazione…";
    const { items: merged, added, updated } = mergeImportedItems(S.data.items, items, uid);
    S.data.items = merged;
    await persist();
    render();
    const newOrUpdated = S.data.items.filter(it => !it.logo && !it.logoDomain);
    openSheet({ type: "excelDone", added, updated, skipped: skipped.length, pendingLogos: newOrUpdated });
  };
}
function drawExcelDone(sh) {
  sheetShell(`<div class="sh-head"><div class="grow"><h2>Importazione completata</h2></div></div>
    <div class="stat-row">
      <div class="stat"><b>${sh.added}</b><span>Aggiunte</span></div>
      <div class="stat"><b>${sh.updated}</b><span>Aggiornate</span></div>
      <div class="stat"><b>${sh.skipped}</b><span>Saltate</span></div>
    </div>
    <p><strong>Importante:</strong> il file Excel contiene le password in chiaro. Eliminalo ora dal telefono, dal cestino e da eventuali cloud (Drive, OneDrive, allegati email).</p>
    <div class="sh-actions"><span class="spacer"></span><button class="btn btn-main" id="cl">Fatto</button></div>`);
  $("#cl").onclick = () => { closeSheet(); if (sh.pendingLogos && sh.pendingLogos.length) requestAutoLogoSearch(sh.pendingLogos); };
}

/* digitare dalla home porta nella ricerca */
document.addEventListener("keydown", e => {
  if (S.screen !== "home" || S.sheet || e.ctrlKey || e.metaKey || e.altKey) return;
  const q = $("#q"); if (q && document.activeElement !== q && e.key.length === 1) { q.focus(); }
});

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* offline non disponibile, non bloccante */ });
  });
}

/* ---------- avvio ---------- */
(async function boot() {
  if (!(window.crypto && crypto.subtle)) {
    $("#app").innerHTML = `<div class="gate"><div class="gate-box"><h1 class="brand">Chiavi</h1><p>Questo browser non offre la crittografia necessaria. Aprilo con Chrome, Firefox, Safari o Edge aggiornati.</p></div></div>`;
    return;
  }
  store.requestPersistence();
  await store.migrateIfNeeded();
  const [blob, bio] = await Promise.all([store.loadBlob(), store.loadBiometric()]);
  S.biometricRecord = bio;
  S.screen = blob ? "unlock" : "setup";
  render();
})();
