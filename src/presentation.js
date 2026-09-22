// Presentazione delle voci: iniziali colorate, e logo (manuale o automatico via dominio).
import { sourceById } from "./logos.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function hueOf(s) {
  let h = 0;
  for (const c of norm(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
export function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (w.length > 1) return (w[0][0] + w[1][0]).toUpperCase();
  const s = w[0] || "?";
  return s[0].toUpperCase() + (s[1] || "").toLowerCase();
}
// Niente attributo style="" inline: la CSP (style-src 'self', senza 'unsafe-inline') lo blocca.
// Il colore di sfondo si applica via JS dopo l'inserimento nel DOM (vedi wireLogos/applyHue).
export function logoHtml(it, meta, cls = "logo") {
  if (it.logo) return `<div class="${cls}"><img data-logo src="${esc(it.logo)}" alt=""></div>`;
  if (it.logoDomain && meta && meta.autoLogo !== false) {
    const source = sourceById(it.logoSource) || sourceById("google");
    const src = source.url(it.logoDomain);
    return `<div class="${cls}" data-name="${esc(it.name)}" data-hue="${hueOf(it.name)}"><img data-logo src="${esc(src)}" alt=""></div>`;
  }
  return `<div class="${cls}" data-hue="${hueOf(it.name)}" aria-hidden="true">${esc(initials(it.name))}</div>`;
}

// Da chiamare dopo ogni inserimento nel DOM di HTML prodotto da logoHtml: applica lo sfondo
// colorato (data-hue) via JS e, se l'<img> fallisce a caricare (dominio senza favicon, rete
// assente), ripiega sulle iniziali colorate.
export function wireLogos(root) {
  root.querySelectorAll("[data-hue]:not([data-hue-applied])").forEach(div => {
    div.dataset.hueApplied = "1";
    div.style.background = `hsl(${div.dataset.hue} 42% 40%)`;
  });
  root.querySelectorAll("img[data-logo]:not([data-wired])").forEach(img => {
    img.dataset.wired = "1";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      const div = img.parentElement;
      if (!div) return;
      const name = div.dataset.name || "";
      div.innerHTML = esc(initials(name));
    };
  });
}

export function host(url) { if (!url) return ""; return String(url).replace(/^https?:\/\//i, "").replace(/\/$/, ""); }
export function href(url) { if (!url) return ""; return /^https?:\/\//i.test(url) ? url : "https://" + url; }
export const byName = (a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" });
