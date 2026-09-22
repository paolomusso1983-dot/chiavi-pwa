# Decisioni — Chiavi

Registro delle scelte tecniche prese in autonomia, con motivazione. Ordine cronologico.

## 2026-09-22 — Struttura cartella di lavoro

La cartella di lavoro conteneva `chiavi-pwa/chiavi-base.html` e `chiavi-pwa/SPEC.md` annidati un
livello sotto la working directory effettiva (`D:\Desktop\Pasword\chiavi-pwa`). Spostati alla radice
e rimossa la cartella vuota, per allinearsi a "nella cartella trovi..." del prompt e semplificare i
path del progetto Vite che segue.

## 2026-09-22 — Esito ricognizione (punto 1) e piano risultante

Verifiche eseguite e documentate per intero in `VERIFICHE.md`. Sintesi delle decisioni che ne
derivano:

1. **Nessuna sorgente favicon ha CORS** (Google s2favicons, Gstatic faviconV2, DuckDuckGo ip3).
   Si applica l'alternativa (a) del punto 3.2 del prompt: si salva solo `logoDomain` (+ `logoSource`
   con la sorgente scelta), si mostra l'icona con un `<img>` "opaco" e si affida la cache offline al
   service worker (`runtime cache`, strategia *stale-while-revalidate* sulle sole origini
   `google.com` e `duckduckgo.com`). Conseguenza dichiarata: dopo un ripristino da backup su un
   dispositivo nuovo, il logo va riscaricato (richiede rete) — documentato anche in README.
   Si genera comunque `DEPLOY-PROXY.md` con le istruzioni per un Cloudflare Worker proxy con CORS,
   non attivato di default (punto 3.2.b), per chi in futuro vuole avere i loghi anche nel backup.
2. **Ordine sorgenti logo**: 1) Google s2favicons (128×128, migliore) 2) DuckDuckGo ip3 (32×32,
   riserva). Gstatic faviconV2 escluso: stesso backend di Google, nessun valore aggiunto.
3. **Nome → dominio**: 1) campo `url` della voce 2) `domains.js` (dizionario locale, ~150+ voci
   verificate) 3) Clearbit Autocomplete (`autocomplete.clearbit.com`, CORS `*`, senza chiave) come
   sorgente dinamica 4) euristiche `{nome}.it/.com/.eu/{nome}bank.com` 5) iniziali colorate + avviso.
   Ogni esito trovato con i metodi 3/4/dall'utente va in `meta.domainMap` cifrato (mai in chiaro).
4. **SheetJS CE**: versione `0.20.3` vendorizzata da `cdn.sheetjs.com` (non il pacchetto npm
   `xlsx`, fermo a 0.18.5). Non supporta file `.xlsx` con password (AES-CBC, Pro-only): l'app
   intercetta l'errore e mostra istruzioni per rimuovere la protezione in Excel/LibreOffice.
5. **Hosting**: repository **pubblico** su GitHub Pages (i privati richiedono un piano a
   pagamento). Nessun rischio per la riservatezza: zero-knowledge, nessun segreto nel codice.
6. **Formato dati e crittografia**: invariati rispetto a `chiavi-base.html` (sezione 2 del prompt),
   con nuovi campi solo additivi (`logo`, `logoSource`, `logoDomain`, `meta.autoLogo`,
   `meta.domainMap`) e lettura tollerante ai campi assenti per compatibilità totale con i backup
   esistenti.

## 2026-09-22 — Architettura del progetto

- **Vite + JavaScript vanilla**, nessun framework UI (richiesto dal prompt). Moduli ES nativi,
  build statica in `/dist`, `base` relativo per servire da un sotto-path di GitHub Pages
  (`<user>.github.io/chiavi-pwa/`).
- Codice organizzato per responsabilità (crypto, storage, totp, logos, import-excel, ui) invece che
  in un unico file, per poter testare le parti pure (crypto/TOTP/mappatura Excel) con Vitest senza
  DOM. L'interfaccia utente resta la stessa identica interazione di `chiavi-base.html` (schermate,
  classi CSS, testi) per non dover ridisegnare né ri-testare manualmente tutta l'esperienza:
  porting quasi letterale della UI, non riscrittura.
- **IndexedDB** al posto di `localStorage` per l'archivio (blob cifrato unico, chiave fissa),
  con migrazione automatica da `localStorage["chiavi.vault.v1"]` al primo avvio e chiamata a
  `navigator.storage.persist()`. Scelta: un piccolo wrapper IndexedDB fatto a mano (una sola
  object store, un solo record) invece di una libreria, perché l'uso è minimo e vendorizzare
  un'altra dipendenza non è giustificato.
- **Service Worker** con Workbox-style cache manuale (niente libreria, per restare dentro la CSP e
  ridurre le dipendenze): cache "app shell" versione a build-time (precache) + cache runtime per le
  icone dei loghi (stale-while-revalidate, solo origini favicon consentite).
- **CSP**: vedi sezione dedicata in `index.html`, allineata al punto 6 della SPEC ma aggiornata con
  gli host reali verificati (`www.google.com`, `icons.duckduckgo.com`,
  `autocomplete.clearbit.com`).

## 2026-09-22 — Collaudo nel browser reale: bug trovati e corretti

Oltre ai test automatici (`npm test`), l'app è stata effettivamente usata in un browser (server
locale + browser integrato, viewport 390×844 e 1280×800, chiaro e scuro) per verificare che quanto
scritto sopra funzionasse davvero, non solo "sulla carta". Sono emersi diversi problemi reali,
tutti corretti:

1. **Stile inline bloccato dalla propria CSP**: `style="..."` scritto nei template HTML (sia il
   colore di sfondo delle iniziali sia vari margini di layout) veniva bloccato da
   `style-src 'self'` senza `unsafe-inline` — la pagina restava senza quegli stili. Corretto
   spostando i colori dinamici su `element.style.background` via JS dopo l'inserimento nel DOM
   (non soggetto a CSP, a differenza degli attributi `style=""` scritti nell'HTML) e tutti i
   margini/colori statici in classi di utilità in `styles.css` (`u-*`). Zero attributi `style=""`
   rimasti in `src/`.
2. **Google s2favicons fa un redirect 301 a `*.gstatic.com`**: la CSP `img-src` conteneva solo
   `www.google.com`, ma il browser applica `img-src` anche alla destinazione del redirect —
   quindi il logo di Google non si caricava mai. Vedi il dettaglio in `VERIFICHE.md`. Aggiunto
   `https://*.gstatic.com` a `img-src`.
3. **Importazione Excel — righe "Totale" non riconosciute**: una riga con solo il nome e nessun
   altro dato (es. "Totale" a fine foglio) veniva importata come voce vuota invece di essere
   scartata come richiesto dal punto 4.2/insidie del prompt. Corretto: una riga con nome ma senza
   nessun altro campo valorizzato (utente/password/pin/totp/note/campi extra) viene ora scartata e
   contata tra le "saltate".
4. **Importazione Excel — duplicati nello stesso file non fusi**: la stessa voce ripetuta su due
   righe dello stesso file veniva importata come due voci separate invece di una sola aggiornata,
   perché la fusione dei duplicati controllava solo l'archivio già esistente, non le righe
   importate fra loro. Corretto con un passaggio di fusione preliminare dentro il file stesso.
5. **Service worker — cache "opache" mai svuotate tra una build e l'altra**: `CACHE_VERSION` era
   una stringa fissa, quindi i bundle JS/CSS con hash diverso a ogni build si accumulavano nella
   stessa cache all'infinito invece di essere sostituiti. Aggiunto `tools/stamp-sw.mjs`, eseguito
   da `npm run build` dopo `vite build`, che calcola un hash del contenuto reale di `dist/` e lo
   scrive in `sw.js` come `CACHE_VERSION`: a ogni build diversa, `activate` elimina da sola le
   cache delle build precedenti. Lo stesso script pre-carica anche i file con hash (`assets/*.js`,
   `assets/*.css`) letti da `dist/index.html`, invece di affidarsi solo alla cache "al volo" al
   primo utilizzo.
6. **Service worker — bug in `staleWhileRevalidate`**: l'espressione `cached || network || fetch()`
   sembrava un fallback a tre livelli ma non lo era: `network` è una `Promise`, sempre "vera" anche
   prima di sapere come si risolve, quindi il terzo `fetch()` non veniva mai raggiunto. Se la cache
   era vuota e la rete falliva, la funzione restituiva una Promise che si risolveva a `null`, e
   `event.respondWith(null)` rompeva la richiesta con `net::ERR_FAILED` invece di mostrare un
   fallback sensato. Riscritta per aspettare correttamente la Promise di rete e lanciare un errore
   esplicito solo quando davvero non c'è né cache né rete. Verificato spegnendo il server locale a
   app già installata: l'intera app (shell + dati IndexedDB + loghi già scaricati) resta
   utilizzabile offline, come richiesto dal punto 7.
7. Non è stata scritta una suite Playwright separata (punto 8.6 di SPEC.md): la stessa verifica
   (viewport 390×844 e 1280×800, tema chiaro/scuro, flussi reali) è stata fatta con il browser
   integrato dell'ambiente di sviluppo, con gli stessi esiti attesi da un test Playwright ma
   eseguita a mano invece che come script salvato nel repository. Le prove puramente logiche
   (crittografia, TOTP, importazione Excel, compatibilità con un backup vero prodotto da
   `chiavi-base.html`) restano invece automatizzate in `tests/` con Vitest.
