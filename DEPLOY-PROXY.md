# Proxy opzionale per i loghi (Cloudflare Worker)

**Non necessario per usare Chiavi.** L'app funziona già così com'è: i loghi vengono mostrati
tramite un `<img>` caricato direttamente da Google/DuckDuckGo (senza CORS) e messo in cache dal
service worker per l'uso offline dopo il primo caricamento (vedi `DECISIONI.md`, punto 3.2.a).
Il limite di questo approccio: il logo **non entra nel backup cifrato** (perché senza CORS il
canvas non può leggerne i pixel), quindi dopo un ripristino su un dispositivo nuovo va riscaricato
(serve rete la prima volta).

Se in futuro si vuole avere i loghi *anche* dentro il backup, si può aggiungere un piccolo proxy
con CORS abilitato, così l'app può scaricare l'immagine via `fetch()`, leggerla su canvas e
salvarla come data URL nel campo `logo` (esattamente come già succede per un logo caricato a mano).
Un Cloudflare Worker gratuito basta.

## 1. Creare il Worker

Su [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Worker, oppure
da riga di comando con `npx wrangler init`. Codice del Worker:

```js
// worker.js — proxy sola-lettura per le icone dei siti, con CORS abilitato.
// Whitelist di sorgenti consentite: evita che il Worker diventi un proxy generico aperto.
const ALLOWED = [
  { prefix: "https://www.google.com/s2/favicons?", },
  { prefix: "https://icons.duckduckgo.com/ip3/" },
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("u");
    if (!target || !ALLOWED.some(a => target.startsWith(a.prefix))) {
      return new Response("URL non consentito", { status: 400 });
    }
    const upstream = await fetch(target, { headers: { "User-Agent": "chiavi-logo-proxy" } });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "https://<tuo-utente>.github.io",
      },
    });
  },
};
```

Sostituire `<tuo-utente>` con il proprio nome utente GitHub (per limitare l'uso del Worker alla
pagina di Chiavi). Pubblicare con `npx wrangler deploy`: si ottiene un URL tipo
`https://chiavi-logo-proxy.<account>.workers.dev`.

## 2. Collegarlo all'app

In `src/logos.js`, cambiare le funzioni `url()` delle sorgenti in `LOGO_SOURCES` per passare
dal proxy, es.:

```js
url: domain => `https://chiavi-logo-proxy.<account>.workers.dev/?u=${encodeURIComponent(
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
)}`,
```

e in `probeLogo`/dove si scarica l'immagine, usare `fetch()` + `canvas` (stesso codice già
presente in `shrinkImage()` in `src/main.js` per il caricamento manuale) per produrre il data URL
da salvare in `logo`.

## 3. Aggiornare la CSP

Aggiungere l'host del Worker a `connect-src` e `img-src` in `index.html`:

```
connect-src 'self' https://autocomplete.clearbit.com https://chiavi-logo-proxy.<account>.workers.dev;
```

## Costi e limiti

Il piano gratuito di Cloudflare Workers include 100.000 richieste al giorno: ampiamente
sufficiente per un uso personale. Nessuna carta di credito richiesta per attivarlo.
