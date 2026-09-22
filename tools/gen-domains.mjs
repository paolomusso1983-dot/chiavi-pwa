// Genera src/domains.js a partire da tools/domains-source.json, includendo SOLO i domini
// presenti (con esito ok:true) in tools/domains-verify-report.json (vedi verify-domains.mjs).
// Uso: node tools/gen-domains.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(__dirname, "domains-source.json"), "utf8"));
let report;
try {
  report = JSON.parse(readFileSync(join(__dirname, "domains-verify-report.json"), "utf8"));
} catch {
  console.error("Manca domains-verify-report.json: esegui prima `npm run verify-domains`.");
  process.exit(1);
}
const okSet = new Set(report.results.filter(r => r.ok).map(r => r.domain));
const verified = src.filter(e => okSet.has(e.domain));
const skipped = src.filter(e => !okSet.has(e.domain));
if (skipped.length) {
  console.log("Esclusi (non raggiungibili durante la verifica):", skipped.map(s => s.domain).join(", "));
}

const header = `// File generato automaticamente da tools/gen-domains.mjs — NON MODIFICARE A MANO.
// Rigenerare con: npm run verify-domains && npm run gen-domains
// Ogni dominio qui presente è stato verificato con una richiesta HTTP reale
// (vedi tools/domains-verify-report.json, generato il ${report.generatedAt}).
// Dizionario nome -> dominio (punto 3.3.2 del prompt): usato come sorgente per trovare
// automaticamente il logo di un servizio a partire dal nome scritto dall'utente.
`;

const body = `export const DOMAINS = ${JSON.stringify(verified, null, 2)};\n`;

writeFileSync(join(__dirname, "..", "src", "domains.js"), header + "\n" + body);
console.log(`Scritto src/domains.js con ${verified.length} domini.`);
