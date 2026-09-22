import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openBlob, validBlob } from "../src/crypto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Backup vero, prodotto da chiavi-base.html (non simulato): aperto in un browser reale
// (servito via HTTP locale, non file:// per far girare gli script), creato un archivio con
// master password "prova password compat test 123", aggiunta una voce con tutti i campi
// (nome, url, utente, password, PIN con zero iniziale, chiave 2FA), poi letto S.key/sealVault()
// dalla pagina viva. Verifica punto 8.3: un backup della versione claude.ai deve aprirsi qui
// senza conversioni.
describe("compatibilità con i backup di chiavi-base.html", () => {
  const blob = JSON.parse(readFileSync(join(__dirname, "fixtures", "backup-from-chiavi-base.json"), "utf8"));

  it("il blob esportato dalla base è nel formato atteso", () => {
    expect(validBlob(blob)).toBe(true);
  });

  it("si apre con la master password originale e ritrova i dati esatti", async () => {
    const { data } = await openBlob(blob, "prova password compat test 123");
    expect(data.items).toHaveLength(1);
    const it = data.items[0];
    expect(it.name).toBe("Fineco Compat Test");
    expect(it.url).toBe("finecobank.com");
    expect(it.user).toBe("utente.prova");
    expect(it.pass).toBe("P@ssw0rd!Compat");
    expect(it.pin).toBe("01234"); // zero iniziale preservato
    expect(it.totp).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rifiuta una password diversa da quella originale", async () => {
    await expect(openBlob(blob, "password sbagliata")).rejects.toThrow();
  });
});
