# Chiavi

Archivio personale di password: solo consultazione (copia/incolla, niente autofill), cifrato sul
dispositivo, installabile come app e utilizzabile offline. Pensato prima di tutto per il telefono.

Zero-knowledge: nessun dato in chiaro lascia mai il dispositivo. Non c'è un server di Chiavi — i
dati stanno solo nel browser/app che usi, cifrati con la tua master password.

## Installare sul telefono

**Android (Chrome):** apri il link della pagina pubblicata, tocca i tre puntini in alto a destra →
"Installa app" (o "Aggiungi a schermata Home").

**iPhone/iPad (Safari):** apri il link, tocca l'icona di condivisione (il quadrato con la freccia
in su) → "Aggiungi a Home".

Dopo l'installazione l'app si apre a schermo intero, come le altre, e funziona anche senza
connessione (dopo il primo avvio).

## Passare dalla versione claude.ai

Se usavi la versione precedente pubblicata su claude.ai (`chiavi-base.html`):
1. Apri quella pagina, vai in **Impostazioni → Esporta backup**: scarichi un file
   `chiavi-backup-AAAA-MM-GG.json`.
2. Apri questa app (schermata di ingresso) → **"Ho già un backup: importalo"**, scegli il file e
   inserisci la stessa master password usata lì.
3. Fatto: ritrovi tutte le voci. Da qui in poi puoi anche usare le funzioni nuove (logo
   automatico, importazione da Excel) tenendo com'è tutto il resto.

## Funzioni principali

- Archivio con ricerca istantanea, preferiti, generatore di password, codici 2FA (TOTP), campi
  extra e note per ogni voce.
- **Logo automatico**: quando aggiungi o importi una voce, Chiavi cerca da sola il logo del sito a
  partire dal nome o dall'indirizzo (vedi `DECISIONI.md` per come funziona e cosa viene inviato in
  rete — solo il nome del dominio, mai dati personali). Si può disattivare dalle Impostazioni: con
  l'interruttore spento, nessuna richiesta di rete per i loghi.
- **Importazione da Excel**: `.xlsx`, `.xls` o `.csv` con le password già registrate altrove,
  mappatura delle colonne automatica, anteprima prima di confermare.
- Blocco automatico per inattività, ritardo crescente dopo password errate ripetute, appunti
  svuotati 30 secondi dopo una copia.
- Backup: file cifrato esportabile in ogni momento, da tenere anche fuori dal telefono.

## Sviluppo

Richiede Node.js 20+.

```bash
npm install
npm run dev       # sviluppo, con ricarica automatica
npm test          # test automatici (crittografia, TOTP, importazione Excel, compatibilità)
npm run build     # build di produzione in dist/
npm run preview   # serve dist/ localmente per un collaudo pre-pubblicazione
```

Altri script:
- `npm run verify-domains` — riverifica con richieste HTTP reali tutti i domini di
  `tools/domains-source.json` e scrive `tools/domains-verify-report.json`.
- `npm run gen-domains` — rigenera `src/domains.js` (solo i domini con esito positivo).

## Pubblicazione (GitHub Pages)

Il repository deve essere **pubblico** (i privati richiedono un piano Pro/Team, vedi
`VERIFICHE.md`). Su GitHub: Settings → Pages → Source → "GitHub Actions". Il workflow
`.github/workflows/deploy.yml` builda e pubblica a ogni push su `main`. Pubblicare il codice non è
un rischio per la riservatezza: i dati restano cifrati sul dispositivo dell'utente e non transitano
mai dal repository o da un server.

## Documenti del progetto

- `DECISIONI.md` — scelte tecniche prese e perché.
- `VERIFICHE.md` — verifiche di rete e comportamento reale eseguite durante lo sviluppo, con data.
- `DEPLOY-PROXY.md` — come aggiungere (facoltativo) un proxy con CORS per avere i loghi anche nei
  backup.
- `SPEC.md` — specifica di dettaglio originale (il prompt di sviluppo prevale in caso di conflitto).

## Fuori perimetro

Autofill, estensioni browser, sincronizzazione cloud, condivisione, account, server.
