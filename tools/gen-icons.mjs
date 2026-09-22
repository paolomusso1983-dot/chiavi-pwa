// Genera le icone dell'app (manifest.webmanifest) senza dipendenze esterne: nessun tool di
// grafica è disponibile in questo ambiente, quindi si scrive un encoder PNG minimo (via zlib,
// incluso in Node) e si disegna un'icona geometrica (una chiave stilizzata) pixel per pixel.
// Uso: node tools/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "icons");

const ACCENT = [0x1f, 0x5f, 0x7a]; // --accent di chiavi-base.html
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crcTable = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgbaBuffer) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bpc RGBA, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgbaBuffer.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Disegna una chiave stilizzata bianca su sfondo accento, ruotata 45°, centrata.
// `scale` <1 lascia margine (usato per l'icona maskable, che deve stare nella "safe zone").
function drawKeyIcon(size, { scale = 1, rounded = true } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const cos = Math.SQRT1_2, sin = Math.SQRT1_2; // rotazione -45°
  const bowR = size * 0.17 * scale;
  const bowRingT = size * 0.075 * scale;
  const bowCenterU = -size * 0.26 * scale;
  const shaftHalf = size * 0.05 * scale;
  const shaftStartU = bowCenterU + bowR - size * 0.01;
  const shaftEndU = size * 0.30 * scale;
  const toothW = size * 0.045 * scale, toothH = size * 0.055 * scale;
  const cornerR = rounded ? size * 0.22 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // sfondo: quadrato con angoli arrotondati
      let inBg = true;
      if (rounded) {
        const dx = Math.min(x - cornerR, size - 1 - x - cornerR, 0);
        const dy = Math.min(y - cornerR, size - 1 - y - cornerR, 0);
        if (dx < 0 && dy < 0 && Math.hypot(dx, dy) > cornerR) inBg = false;
      }
      let color = inBg ? ACCENT : null;
      const alpha = inBg ? 255 : 0;

      // coordinate ruotate rispetto al centro
      const dx0 = x - cx, dy0 = y - cy;
      const u = dx0 * cos + dy0 * sin;
      const v = -dx0 * sin + dy0 * cos;

      let isKey = false;
      // anello (testa della chiave)
      const rr = Math.hypot(u - bowCenterU, v);
      if (rr <= bowR && rr >= bowR - bowRingT) isKey = true;
      // stelo
      if (!isKey && u >= shaftStartU && u <= shaftEndU && Math.abs(v) <= shaftHalf) isKey = true;
      // due denti verso la punta
      if (!isKey) {
        const t1 = shaftEndU - toothW * 1.6, t2 = shaftEndU - toothW * 0.2;
        if (u >= t1 - toothW / 2 && u <= t1 + toothW / 2 && v >= shaftHalf && v <= shaftHalf + toothH) isKey = true;
        if (u >= t2 - toothW / 2 && u <= t2 + toothW / 2 && v >= shaftHalf && v <= shaftHalf + toothH * 0.6) isKey = true;
      }
      if (isKey && inBg) color = WHITE;

      buf[idx] = color ? color[0] : 0;
      buf[idx + 1] = color ? color[1] : 0;
      buf[idx + 2] = color ? color[2] : 0;
      buf[idx + 3] = alpha;
    }
  }
  return buf;
}

for (const size of [192, 512]) {
  const png = encodePng(size, size, drawKeyIcon(size, { scale: 1, rounded: true }));
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`Scritto icon-${size}.png`);
}
// Maskable: sfondo edge-to-edge, icona ridotta per stare nella safe zone (~80% centrale).
{
  const png = encodePng(512, 512, drawKeyIcon(512, { scale: 0.62, rounded: false }));
  writeFileSync(join(OUT, "icon-512-maskable.png"), png);
  console.log("Scritto icon-512-maskable.png");
}
// Favicon 32x32 (usata anche come apple-touch-icon di riserva)
{
  const png = encodePng(32, 32, drawKeyIcon(32, { scale: 1, rounded: true }));
  writeFileSync(join(OUT, "favicon-32.png"), png);
  console.log("Scritto favicon-32.png");
}
