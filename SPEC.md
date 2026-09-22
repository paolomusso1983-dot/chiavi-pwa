# Chiavi — specifica per Claude Code

Documento di partenza per sviluppare **Chiavi** come app web installabile (PWA) con Claude Code.
Base di codice: `chiavi-base.html` (versione attuale, funzionante, pubblicata su claude.ai).
Dati verificati il 22/09/2026; le voci marcate **[DA VERIFICARE]** vanno controllate prima dell'uso.

---

## 1. Obiettivo

Archivio personale di credenziali, solo consultazione (copia/incolla, nessun autofill), usato
principalmente da **telefono**. Rispetto alla versione attuale aggiunge:

1. **Logo automatico** del sito/app, recuperato da internet dal nome o dall'indirizzo.
2. **Importazione da Excel** (.xlsx / .xls / .csv) delle password già registrate.
3. Uso fuori da claude.ai: installabile sulla home del telefono, funzionante offline.

Motivo del passaggio: la pagina pubblicata su claude.ai ha una Content-Security-Policy che blocca
immagini remote e richieste di rete verso altri siti, quindi il logo automatico lì è impossibile.

## 2. Vincoli non negoziabili

- **Zero-knowledge**: nessun dato in chiaro lascia mai il dispositivo, nessun server nostro.
- Crittografia invariata rispetto alla base: PBKDF2-SHA256, 600.000 iterazioni, sale 16 byte,
  AES-256-GCM, IV 12 byte nuovo a ogni salvataggio. Solo Web Crypto API, nessuna libreria crypto.
- **Compatibilità totale con i backup esistenti** (sezione 3): un backup esportato dalla versione
  claude.ai deve importarsi senza conversioni.
- Nessuno script caricato da CDN a runtime: tutte le dipendenze vendorizzate nel repository.
- Content-Security-Policy restrittiva (sezione 6).
- Interfaccia e testi in italiano. Mobile-first (390 px), poi desktop.
- Nessun framework obbligatorio: vanilla JS va bene. Se si usa un bundler, Vite.

## 3. Formato dati (da mantenere identico)

File di backup / blob salvato:

```json
{ "app":"chiavi", "v":1, "kdf":"PBKDF2-SHA256", "iter":600000,
  "salt":"<base64>", "iv":"<base64>", "ct":"<base64 AES-GCM di JSON(payload)>" }
```

Payload decifrato:

```json
{
  "items": [{
    "id":"hex16", "name":"Fineco", "url":"finecobank.com", "user":"", "pass":"", "pin":"",
    "totp":"segreto base32 oppure otpauth://...", "notes":"",
    "fields":[{"k":"Codice cliente","v":"12345","secret":false}],
    "logo":"data:image/png;base64,... oppure stringa vuota", "fav":false, "updated":1758520000000
  }],
  "meta": { "lockMin":3, "lastBackup":0, "dirty":false }
}
```

Nuovi campi ammessi solo come **aggiunte opzionali** (es. `logoSource`, `logoDomain`,
`meta.autoLogo`). Il lettore deve tollerare campi mancanti.

## 4. Logo automatico

### Flusso
1. Determinare il dominio: dal campo `url`; se vuoto, dal dizionario nome→dominio (4.3);
   se non trovato, mostrare "Indica l'indirizzo del sito per trovare il logo".
2. Scaricare l'icona (4.2), ridimensionarla a 128×128 su sfondo bianco, salvarla come data URL PNG
   dentro `logo` (quindi cifrata e inclusa nei backup, visibile offline).
3. Se il risultato è il segnaposto generico o sotto 32 px reali: scartarlo e usare le iniziali.
4. Trigger: al salvataggio di una voce se il dominio è cambiato e `logo` è vuoto; pulsante
   "Cerca logo" nella modifica; azione di massa "Cerca loghi mancanti" nelle impostazioni.
5. Il logo caricato a mano dall'utente non viene mai sovrascritto automaticamente.

### 4.2 Sorgenti (servizi non ufficiali, senza garanzie di disponibilità)
- Primaria: `https://www.google.com/s2/favicons?domain={dominio}&sz=128`
  (restituisce l'icona più grande disponibile, spesso l'apple-touch-icon).
- Riserva: `https://icons.duckduckgo.com/ip3/{dominio}.ico` (spesso solo 16/32 px).
- **[DA VERIFICARE]** se entrambe rispondono con header CORS da un'origine github.io.
  - Se sì: `fetch` → blob → canvas → data URL.
  - Se no: un `<img>` senza CORS "sporca" il canvas e non si può convertire. In quel caso scegliere
    e motivare un'alternativa (es. salvare solo `logoDomain` e far caricare l'immagine via
    service worker con cache delle risposte opache), documentando che il logo non sarà nei backup.

### Privacy (da mostrare all'utente una volta, con interruttore nelle impostazioni)
Al servizio di icone viene inviato **solo il nome del dominio**, mai utente o password.
Chi gestisce il servizio può però dedurre quali siti sono nell'archivio.
Impostazione `meta.autoLogo` (default: attivo, ma chiedere conferma alla prima ricerca).

### 4.3 Dizionario nome → dominio
File `domains.js`, confronto su nome normalizzato (minuscolo, senza accenti), con alias multipli.
Proposta iniziale, **ogni dominio [DA VERIFICARE] con una richiesta HTTP prima del commit**:
Fineco, Poste Italiane / BancoPosta / PostePay, INPS, NoiPA, Agenzia delle Entrate, ING,
Intesa Sanpaolo, UniCredit, PayPal, Amazon, eBay, Google / Gmail, Apple / iCloud, Microsoft /
Outlook, Facebook, Instagram, WhatsApp, Netflix, Spotify, Enel, Trenitalia, Aruba, TIM, Vodafone,
WindTre, Iliad, Fastweb, Booking, Subito, Zalando, Telepass, Autostrade, ACI, Satispay.
Estendibile dall'utente: quando inserisce un url per un nome non presente, proporre di ricordarlo
(salvato cifrato nel payload, non in chiaro).

## 5. Importazione da Excel

### Libreria
SheetJS CE **dalla CDN ufficiale** `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
(verificato 22/09/2026: ultima versione indicata dalla documentazione ufficiale).
**Non** usare il pacchetto `xlsx` di npmjs.com: è fermo alla 0.18.5 e non riceve aggiornamenti.
Controllare se esiste una versione più recente prima di installare. Vendorizzare il build.

### Flusso
1. Pulsante "Importa da Excel" in impostazioni e nella home vuota. Accetta .xlsx, .xls, .csv.
2. Se ci sono più fogli: scelta del foglio.
3. Riga di intestazione rilevata automaticamente (prima riga con ≥2 celle testuali), modificabile.
4. **Mappatura colonne** con proposta automatica per sinonimi (IT/EN, senza accenti):
   - nome: nome, sito, servizio, app, descrizione, name, title
   - url: url, indirizzo, link, sito web, website
   - utente: utente, username, user, login, email, e-mail, codice cliente, id
   - password: password, pass, pwd, parola chiave
   - pin: pin, codice pin
   - totp: 2fa, otp, totp, chiave 2fa
   - note: note, notes, annotazioni
   - ogni altra colonna → "Campo extra" (etichetta = intestazione) oppure "Ignora".
5. Anteprima prime 5 righe con password mascherate; contatori "da importare / vuote / duplicate".
6. Duplicati (stesso nome normalizzato + stesso utente): scelta unica per tutto l'import tra
   Salta / Sovrascrivi / Aggiungi comunque.
7. Import → salvataggio cifrato → ricerca loghi in blocco (se attiva) con avanzamento.
8. Messaggio finale obbligatorio: il file Excel contiene le password in chiaro, va eliminato dal
   telefono, dal cestino e da eventuali cloud (Drive, OneDrive, allegati email).

### Insidie da gestire (con test dedicati)
- **Zeri iniziali e numeri**: Excel converte "01234" in 1234 e codici lunghi in notazione
  scientifica. Leggere il testo formattato della cella (`cell.w`, `raw:false`), non il valore
  numerico. Se una cella password/PIN è di tipo numerico, segnalarla nell'anteprima.
- Date interpretate come numeri seriali: usare il testo formattato.
- Spazi iniziali/finali: rimossi da nome/url/utente, **mai** dalla password.
- Celle unite, righe vuote, righe di totale o commento: saltate e contate.
- CSV con separatore `;` (Excel in italiano) e codifica Windows-1252 oltre a UTF-8.
- Il file viene letto solo in memoria: mai salvato, mai inviato in rete.

## 6. Sicurezza della pagina

- CSP via `<meta http-equiv>`: `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'` (oppure spostare gli stili in file); `img-src 'self' data: blob:` più i soli
  host di 4.2; `connect-src 'self'` più i soli host di 4.2; `object-src 'none'; base-uri 'none';
  frame-ancestors 'none'` (quest'ultimo solo via header, non valido in meta: documentarlo).
  Font: vendorizzarli o usare font di sistema, niente Google Fonts a runtime.
- Nessun analytics, nessun tracker.
- Archivio in **IndexedDB** (solo il blob cifrato), con `navigator.storage.persist()` per ridurre
  il rischio di cancellazione automatica. Migrazione automatica da `localStorage["chiavi.vault.v1"]`.
- Mantenere: blocco per inattività, blocco al ritorno dopo N minuti in background, ritardo
  crescente dopo 3 password errate, svuotamento appunti dopo 30 s, nessun dato decifrato in
  memoria dopo il blocco.

## 7. PWA e pubblicazione

- `manifest.webmanifest` (nome "Chiavi", icona 192/512 px originale, `display: standalone`),
  service worker che mette in cache i file dell'app per l'uso offline.
- Hosting: GitHub Pages dal ramo `main`. Il codice pubblico non è un rischio: i dati stanno solo
  sul dispositivo e sono cifrati. **[DA VERIFICARE]** che GitHub Pages su repository privato
  richieda un piano a pagamento; se sì, repository pubblico.
- Istruzioni nel README per: installazione sulla home (Chrome Android / Safari iOS),
  migrazione dalla versione claude.ai (Esporta backup lì → Importa backup qui).

## 8. Test richiesti prima di considerare finito

1. TOTP: vettori RFC 6238 SHA-1 a T=59, 1111111109, 20000000000 → 94287082, 07081804, 65353130.
2. Cifratura: andata/ritorno; password errata rifiutata; IV diverso a ogni salvataggio.
3. Import di un backup prodotto da `chiavi-base.html` (generarlo con Playwright).
4. Excel di prova con: intestazioni italiane, accenti, PIN "0123", codice di 16 cifre, date,
   righe vuote, duplicati, file .csv con `;`.
5. Logo: dominio esistente, dominio senza favicon (deve cadere sulle iniziali), rete assente
   (nessun errore bloccante), interruttore disattivato (nessuna richiesta di rete: verificarlo).
6. Test end-to-end con Playwright su viewport 390×844 e 1280×800, tema chiaro e scuro.

## 9. Fuori perimetro

Autofill, estensioni browser, sincronizzazione cloud, condivisione, account, server.
