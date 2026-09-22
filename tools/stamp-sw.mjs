// Post-build (vedi package.json: "build": "vite build && node tools/stamp-sw.mjs"):
// - sostituisce __BUILD_ID__ in dist/sw.js con un hash del contenuto di dist/, così ogni
//   deploy ha una cache diversa e "activate" nel service worker elimina da sola le cache delle
//   build precedenti invece di farle accumulare (i nomi dei bundle JS/CSS cambiano a ogni build
//   per via dell'hash che Vite mette nel nome del file).
// - sostituisce __PRECACHE_EXTRA_JSON__ con l'elenco reale dei file assets/* prodotti dalla
//   build, letti dagli <script>/<link> di dist/index.html, così il bundle JS/CSS finisce in
//   cache già al primo avvio (non solo alla prima richiesta runtime).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

const indexHtml = readFileSync(join(DIST, "index.html"), "utf8");
const assetPaths = [...indexHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(m => m[1]);

const hash = createHash("sha256");
for (const f of readdirSync(join(DIST, "assets")).sort()) {
  hash.update(f);
  hash.update(readFileSync(join(DIST, "assets", f)));
}
const buildId = hash.digest("hex").slice(0, 12);

const swPath = join(DIST, "sw.js");
let sw = readFileSync(swPath, "utf8");
sw = sw.replaceAll("__BUILD_ID__", buildId); // occorre sia nel commento sia nel codice
sw = sw.replaceAll('"__PRECACHE_EXTRA_JSON__"', JSON.stringify(JSON.stringify(assetPaths)));
writeFileSync(swPath, sw);
console.log(`sw.js aggiornato — build ${buildId}, precache extra: ${assetPaths.join(", ")}`);
