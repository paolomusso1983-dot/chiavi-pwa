// Sblocco con impronta/volto — usa WebAuthn (le stesse "passkey" del sistema operativo) con
// l'estensione "prf": l'autenticatore della piattaforma (impronta/volto), dopo la verifica
// biometrica, restituisce un valore segreto derivato che non passa mai in chiaro né viene
// salvato da nessuna parte. Con quel valore si cifra (AES-256-GCM) la master password e si
// salva SOLO il risultato cifrato in IndexedDB — non dentro l'archivio cifrato con la master
// password (altrimenti sarebbe un cane che si morde la coda: servirebbe la password per leggere
// la password). Compatibile con "zero-knowledge": senza QUESTO dispositivo e QUESTA impronta/
// volto già registrati, il valore non si può ricostruire in nessun altro modo.
//
// Limite reale, non un dettaglio implementativo: l'estensione "prf" non è supportata da tutti i
// browser/telefoni. Va sempre verificata sul dispositivo reale (vedi isSupported/prova pratica
// in enable()) — non si può dedurre dal modello del telefono.
import { b64e, b64d } from "./crypto.js";

const RP_NAME = "Chiavi";

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Vero solo se il browser espone l'API — non garantisce che l'estensione "prf" funzioni davvero:
// quella si scopre solo provando (vedi enable()), perché varia da telefono a telefono.
export function isPlatformAuthenticatorPossible() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

async function isPlatformAuthenticatorAvailable() {
  try {
    if (!isPlatformAuthenticatorPossible()) return false;
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch { return false; }
}
export { isPlatformAuthenticatorAvailable };

async function importPrfKey(prfBytes) {
  // L'estensione "prf" restituisce 32 byte: la lunghezza esatta di una chiave AES-256.
  return crypto.subtle.importKey("raw", prfBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Crea una nuova credenziale con l'estensione prf e ottiene il valore derivato, richiedendo la
// verifica biometrica all'utente. Ritorna {credentialId, salt, prfBytes} oppure lancia un errore
// con un messaggio già in italiano, pronto da mostrare.
async function createCredentialAndDerive() {
  const salt = randomBytes(32);
  const userId = randomBytes(16);
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME },
        user: { id: userId, name: "chiavi-locale", displayName: "Chiavi (questo dispositivo)" },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (e) {
    if (e && e.name === "NotAllowedError") throw new Error("Operazione annullata o impronta/volto non riconosciuto.");
    throw new Error("Il tuo telefono/browser non supporta questa funzione (" + (e && e.message || e) + ").");
  }
  if (!cred) throw new Error("Creazione della credenziale non riuscita.");
  const ext = cred.getClientExtensionResults();
  if (!ext || !ext.prf || !ext.prf.enabled) {
    throw new Error("Il tuo browser gestisce l'impronta/il volto ma non la funzione necessaria per cifrare i dati in modo sicuro (estensione \"prf\"). Aggiorna il browser o riprova su un altro dispositivo.");
  }
  let prfBytes = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
  const credentialId = new Uint8Array(cred.rawId);
  if (!prfBytes) {
    // Alcuni browser non restituiscono il valore già alla creazione: si richiede con un get()
    // immediato (un secondo tocco/sguardo, inevitabile su quei browser).
    prfBytes = await getPrfBytes(credentialId, salt);
  }
  return { credentialId, salt, prfBytes };
}

async function getPrfBytes(credentialId, salt) {
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: credentialId, type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (e) {
    if (e && e.name === "NotAllowedError") throw new Error("Impronta/volto non riconosciuto o operazione annullata.");
    throw new Error("Sblocco con impronta/volto non riuscito (" + (e && e.message || e) + ").");
  }
  const ext = assertion && assertion.getClientExtensionResults();
  const first = ext && ext.prf && ext.prf.results && ext.prf.results.first;
  if (!first) throw new Error("Il dispositivo non ha restituito il valore necessario. Riprova o disattiva questa funzione.");
  return new Uint8Array(first);
}

// Attiva lo sblocco biometrico: verifica davvero sul dispositivo (non un'ipotesi) che
// impronta/volto + estensione prf funzionino, poi cifra la master password col valore ottenuto.
// Ritorna il record da salvare con storage.saveBiometric().
export async function enable(masterPassword) {
  const { credentialId, salt, prfBytes } = await createCredentialAndDerive();
  const key = await importPrfKey(prfBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const te = new TextEncoder();
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(masterPassword)));
  return {
    credentialId: b64e(credentialId),
    salt: b64e(salt),
    iv: b64e(iv),
    ct: b64e(ct),
  };
}

// Richiede impronta/volto e, se riconosciuto, ritorna la master password in chiaro (da passare
// alla normale procedura di sblocco — non bypassa mai openBlob/PBKDF2, è solo un modo diverso di
// fornire la password).
export async function unlock(record) {
  const credentialId = b64d(record.credentialId);
  const salt = b64d(record.salt);
  const prfBytes = await getPrfBytes(credentialId, salt);
  const key = await importPrfKey(prfBytes);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(record.iv) }, key, b64d(record.ct));
  return new TextDecoder().decode(pt);
}
