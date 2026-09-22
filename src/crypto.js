// Crittografia — identica a chiavi-base.html: PBKDF2-SHA256, 600.000 iterazioni, sale 16 byte,
// AES-256-GCM, IV 12 byte nuovo a ogni salvataggio. Solo Web Crypto API.
export const ITER = 600000;
const te = new TextEncoder(), td = new TextDecoder();

export function b64e(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64d(s) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

export async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealVault(state) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.key, te.encode(JSON.stringify(state.data))));
  return { app: "chiavi", v: 1, kdf: "PBKDF2-SHA256", iter: state.iter, salt: b64e(state.salt), iv: b64e(iv), ct: b64e(ct) };
}

export async function openBlob(blob, pw) {
  const salt = b64d(blob.salt);
  const key = await deriveKey(pw, salt, blob.iter);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(blob.iv) }, key, b64d(blob.ct));
  return { key, salt, iter: blob.iter, data: JSON.parse(td.decode(pt)) };
}

export function validBlob(b) {
  return !!(b && b.app === "chiavi" && typeof b.salt === "string" && typeof b.iv === "string" && typeof b.ct === "string" && Number.isInteger(b.iter));
}

export function genPw(n = 20) {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_+=";
  const lim = 256 - (256 % cs.length);
  let out = "";
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < lim && out.length < n) out += cs[b % cs.length];
    }
  }
  return out;
}

export const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
