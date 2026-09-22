// TOTP (RFC 6238) — identico a chiavi-base.html.
export function b32(s) {
  s = s.replace(/[\s=-]/g, "").toUpperCase();
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error("b32");
    val = ((val << 5) | i) & 0xFFFF;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  if (!out.length) throw new Error("b32");
  return new Uint8Array(out);
}

export function parseTotp(str) {
  str = (str || "").trim();
  if (!str) return null;
  let secret = str, digits = 6, period = 30, algo = "SHA-1";
  if (/^otpauth:/i.test(str)) {
    const u = new URL(str);
    secret = u.searchParams.get("secret") || "";
    digits = parseInt(u.searchParams.get("digits")) || 6;
    period = parseInt(u.searchParams.get("period")) || 30;
    const a = (u.searchParams.get("algorithm") || "SHA1").toUpperCase();
    algo = a === "SHA256" ? "SHA-256" : a === "SHA512" ? "SHA-512" : "SHA-1";
  }
  return { key: b32(secret), digits, period, algo };
}

export async function totpNow(cfg, now = Date.now()) {
  const ctr = Math.floor(now / 1000 / cfg.period);
  const buf = new ArrayBuffer(8), dv = new DataView(buf);
  dv.setUint32(0, Math.floor(ctr / 2 ** 32));
  dv.setUint32(4, ctr >>> 0);
  const k = await crypto.subtle.importKey("raw", cfg.key, { name: "HMAC", hash: cfg.algo }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", k, buf));
  const o = h[h.length - 1] & 15;
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** cfg.digits;
  return String(n).padStart(cfg.digits, "0");
}

// Vettore di test diretto RFC 6238 (SHA-1) senza passare da otpauth://, usato dai test.
export async function totpAt(secretB32, epochSeconds, period = 30, digits = 8) {
  return totpNow({ key: b32(secretB32), digits, period, algo: "SHA-1" }, epochSeconds * 1000);
}
