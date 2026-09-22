// Verifica ogni dominio di domains-source.json con una richiesta HTTP reale.
// Uso: node tools/verify-domains.mjs
// Scrive tools/domains-verify-report.json e stampa un riepilogo.
// Usa `curl` (processo esterno) invece di fetch/undici: in questo ambiente Windows fetch nativo
// dava "operation was aborted" intermittenti su domini che curl raggiungeva invece regolarmente
// (verificato a mano più volte sugli stessi host) — curl è quindi la misura più affidabile
// disponibile qui. Un dominio è valido se riceve un qualunque status HTTP (anche redirect,
// 403/405/429: significa che l'host esiste ed è raggiungibile). Solo un vero fallimento di
// connessione/DNS/timeout esclude il dominio.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(__dirname, "domains-source.json"), "utf8"));

// Sequenziale: in questo ambiente Windows, lanciare più processi curl in parallelo produceva
// fallimenti intermittenti ("Command failed") su domini che una singola richiesta raggiungeva
// sempre correttamente (verificato a mano, più volte, sugli stessi host). Più lento ma affidabile.
const CONCURRENCY = 1;
const TIMEOUT_S = 12;
const RETRIES = 2;

async function curlOnce(domain) {
  // Niente -L: basta la risposta del primo hop (anche un redirect) per provare che l'host esiste
  // ed è raggiungibile. Seguire l'intera catena di redirect fino alla pagina finale era la causa
  // dei falsi negativi: alcuni siti (es. vodafone.it -> privati.vodafone.it) impiegano più di
  // 12s a servire la pagina finale completa pur rispondendo subito al primo hop.
  const { stdout } = await execFileP("curl", [
    "-s", "-o", "NUL", "-w", "%{http_code} %{redirect_url}",
    "--max-time", String(TIMEOUT_S),
    `https://${domain}`,
  ]);
  const [code, ...rest] = stdout.trim().split(" ");
  return { status: Number(code), redirectUrl: rest.join(" ") };
}

async function checkOne(entry) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const r = await curlOnce(entry.domain);
      if (r.status > 0) return { ...entry, ok: true, ...r };
      lastErr = `http_code 0 (nessuna risposta)`;
    } catch (e) {
      lastErr = String(e && e.message || e).split("\n")[0];
    }
  }
  return { ...entry, ok: false, error: lastErr };
}

async function run() {
  const queue = [...src];
  const results = [];
  async function worker() {
    while (queue.length) {
      const entry = queue.shift();
      const r = await checkOne(entry);
      results.push(r);
      console.log((r.ok ? "OK  " : "FAIL") + " " + entry.domain + (r.ok ? ` (${r.status})` : ` — ${r.error}`));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.domain.localeCompare(b.domain));
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  writeFileSync(join(__dirname, "domains-verify-report.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: results.length, ok: ok.length, fail: fail.length,
    results,
  }, null, 2));
  console.log(`\nTotale: ${results.length}  OK: ${ok.length}  FALLITI: ${fail.length}`);
  if (fail.length) console.log("Falliti:", fail.map(f => f.domain).join(", "));
}
run();
