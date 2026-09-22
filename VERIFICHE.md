# Verifiche — Chiavi

Ogni riga è il risultato di una richiesta di rete reale eseguita durante lo sviluppo (non simulata).
Ambiente: Node.js v20.20.2 (`fetch` nativo), Windows, dal Bash tool. Data: 2026-09-22.

## 1.2.a–d — Sorgenti favicon: CORS, formati, segnaposto

Script: `scratch/verify.mjs` e `scratch/verify2.mjs` (cancellati dopo l'uso, risultati qui sotto).

| Sorgente | URL di test | Status | Content-Type | `Access-Control-Allow-Origin` | Dimensioni reali |
|---|---|---|---|---|---|
| Google s2favicons | `https://www.google.com/s2/favicons?domain=finecobank.com&sz=128` | 200 | image/png | **assente** | 128×128 PNG |
| Google s2favicons (dominio inesistente) | `...domain=dominio-inesistente-xyz123.it&sz=128` | 404 | image/png | assente | **16×16 PNG**, sha256 `59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64` |
| Gstatic faviconV2 | `https://t1.gstatic.com/faviconV2?...url=https://finecobank.com&size=128` | 200 | image/png | assente | 128×128 PNG, **hash identico** a Google s2favicons → stesso backend |
| Gstatic faviconV2 (dominio inesistente) | idem con dominio fasullo | 404 | image/png | assente | 16×16, hash identico al segnaposto Google |
| DuckDuckGo ip3 | `https://icons.duckduckgo.com/ip3/finecobank.com.ico` | 200 | image/png (non .ico nonostante l'estensione URL) | assente | 32×32 PNG |
| DuckDuckGo ip3 (dominio inesistente) | `.../ip3/dominio-inesistente-xyz123.it.ico` | 404 | image/png | assente | **48×48 PNG**, sha256 `e5db88ea2322863ca17817b99d60006c625a31cff0dad49cf05d3c6d16a75c17` — segnaposto generico (globo) |

**Conclusione (decisiva per la sezione 3.2 del prompt):** nessuna delle tre sorgenti invia
`Access-Control-Allow-Origin`. Un `fetch()` da pagina servita su `*.github.io` riceverebbe quindi
una risposta *opaque* (con `mode:"cors"`, la richiesta fallisce; con `no-cors` il body non è
leggibile) → **il canvas non può leggere il pixel data e non si può produrre un data URL PNG lato
client**. Si applica l'alternativa (a) del punto 3.2: si salva `logoDomain`, il tag `<img>` carica
l'icona in modo "opaco" (senza CORS, funziona comunque per la visualizzazione) e il service worker
mette in cache la risposta per l'uso offline dopo il primo caricamento. Il logo non entra quindi nel
payload cifrato/backup finché l'utente non lo conferma esplicitamente (vedi DECISIONI.md).

Riconoscimento segnaposto generico:
- Google/Gstatic: immagine 16×16 con sha256 `59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64` **oppure** status HTTP 404.
- DuckDuckGo: immagine 48×48 con sha256 `e5db88ea2322863ca17817b99d60006c625a31cff0dad49cf05d3c6d16a75c17` **oppure** status HTTP 404.
- Regola pratica scelta: scartare sempre le risposte con status 404 (in pratica coincide con i segnaposto rilevati) e comunque scartare immagini con lato reale < 32 px (esclude il 16×16 di Google ma accetta il 32×32 reale di DuckDuckGo).

Ordine di qualità osservato: **Google s2favicons (128×128) > DuckDuckGo (32×32)**. Gstatic
faviconV2 è omesso dall'app perché risulta un semplice alias dello stesso backend di Google
s2favicons (stessi byte), quindi non aggiunge valore e complica solo il codice.

## 1.2.e — Servizio gratuito nome→dominio, senza chiave API, con CORS

Testato `https://autocomplete.clearbit.com/v1/companies/suggest?query=fineco`:

```
HTTP/1.1 200 OK
Content-Type: application/json
access-control-allow-origin: *
```

Risposta: `[{"name":"FinecoBank","domain":"finecobank.com","logo":null}, ...]` — **funziona,
nessuna chiave richiesta, CORS abilitato**. Endpoint pubblico storico di Clearbit (ora parte di
HubSpot), usato diffusamente per autocompletamento aziende nei form. Si usa **solo** come sorgente
di *fallback* al punto 3.3.3, inviando esclusivamente il nome digitato dall'utente (mai altri dati).

Nota: `https://logo.clearbit.com/{dominio}` (usato in passato come sorgente di loghi) **non
risolve più** (`Could not resolve host`): il servizio Logo API di Clearbit è stato dismesso. Non
viene quindi usato come sorgente logo — solo Google s2favicons e DuckDuckGo restano sorgenti logo.

## 1.2.f — Versione più recente di SheetJS CE

RSS ufficiale `https://git.sheetjs.com/sheetjs/sheetjs/tags.rss` → tag più recente **v0.20.3**
(pubblicato 2024-07-18), invariato rispetto al 22/09/2026. Conferma quanto scritto in SPEC.md.
File verificato raggiungibile e vendorizzabile:
`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` → `200 OK`,
`Access-Control-Allow-Origin: *`, `Content-Type: application/javascript`.

## 1.2.g — SheetJS CE e file .xlsx protetti da password

Dalla documentazione ufficiale (`docs.sheetjs.com`, sezione "Password Protection" delle opzioni di
parsing): *"SheetJS CE currently supports XOR encryption in XLS files. Errors will be thrown when
trying to parse files using unsupported encryption methods. SheetJS Pro offers support for
additional encryption schemes, including the AES-CBC schemes used in XLSX / XLSM / XLSB files..."*

**Conclusione: NO.** I file `.xlsx` protetti da password di apertura usano AES-CBC (crittografia
OOXML "Agile"/"Standard"), che la Community Edition **non supporta**: il parsing lancia un errore.
Solo i vecchi `.xls` con cifratura XOR (schema debole, raro) sono leggibili.
**Alternativa applicata:** l'app intercetta l'errore di parsing, riconosce il caso (messaggio
SheetJS contiene "password" o l'apertura fallisce su un file che si apre correttamente in Excel) e
mostra un messaggio dedicato: "Questo file Excel è protetto da password. Aprilo in Excel/LibreOffice,
rimuovi la protezione (File → Proteggi cartella di lavoro → Rimuovi password) e riprova." Non si
tenta di implementare una decrittazione AES-CBC proprietaria: fuori perimetro per una CE gratuita e
rischioso da reimplementare correttamente per un archivio di password.

## 1.2.h — GitHub Pages su repository privato con account gratuito

Da `docs.github.com` (About GitHub Pages, sezione "type of repository"): *"...you can publish [...]
private repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud, and GitHub Enterprise
Server."* — quindi su un account **gratuito** GitHub Pages su repo privato **non è disponibile**.

**Conclusione:** repository **pubblico**. Non è un problema per la sicurezza (principio zero-knowledge
già richiesto dal prompt): il codice pubblicato non contiene segreti, i dati dell'utente restano
sempre cifrati sul dispositivo e non transitano mai dal repository.

## Scoperta durante il collaudo nel browser reale: redirect di Google verso gstatic.com

Testando l'app in un browser vero (non solo con `fetch` in Node) è emerso che
`https://www.google.com/s2/favicons?...` risponde con un **redirect 301** verso
`https://t{0-3}.gstatic.com/faviconV2?...` (sottodominio variabile per bilanciamento del carico):

```
curl -sI "https://www.google.com/s2/favicons?domain=finecobank.com&sz=128"
HTTP/1.1 301 Moved Permanently
Location: https://t3.gstatic.com/faviconV2?...
```

Il primo tentativo di CSP (`img-src ... https://www.google.com ...`) bloccava quindi SEMPRE il
caricamento reale dell'icona, perché il browser applica `img-src` anche alla destinazione finale
del redirect, non solo all'URL richiesto inizialmente — cosa che una richiesta `fetch()` da Node
(usata nella verifica iniziale del punto 1.2) segue silenziosamente senza mostrare il problema.
Corretto aggiungendo `https://*.gstatic.com` a `img-src` in `index.html`. Lezione: le verifiche di
rete fatte da Node non bastano per la CSP, serve anche un collaudo nel browser vero (fatto qui con
un server locale + il browser integrato, vedi anche `tests/compat.test.js`).

## Verifica dominio-per-dominio (`domains.js`)

Vedi `tools/verify-domains.mjs` e il suo output in `tools/domains-verify-report.json`, generato
rilanciando lo script — ogni dominio incluso in `src/domains.js` ha ricevuto una risposta HTTP
reale (redirect o 200) al momento della verifica; quelli senza risposta sono stati esclusi o
sostituiti con l'alias corretto. Dettagli e data dell'ultima esecuzione in fondo a quel file.
