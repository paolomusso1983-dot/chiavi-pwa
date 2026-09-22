import { describe, it, expect } from "vitest";
import {
  normalizeHeader, matchField, isSecretHeader, detectHeaderRowIndex, buildMapping,
  inferMappingWithoutHeader, cellsToRows, attachExtraFields, mergeImportedItems, maskPassword,
} from "../src/excel-import.js";

describe("riconoscimento intestazioni (sinonimi IT/EN, accenti, maiuscole)", () => {
  it("normalizza accenti e maiuscole", () => {
    expect(normalizeHeader("Città")).toBe("citta");
    expect(normalizeHeader("E-Mail")).toBe("e mail");
  });
  it("riconosce i sinonimi principali", () => {
    expect(matchField("Nome")).toBe("name");
    expect(matchField("Sito Web")).toBe("url");
    expect(matchField("E-mail")).toBe("user");
    expect(matchField("Codice cliente")).toBe("user");
    expect(matchField("Parola chiave")).toBe("pass");
    expect(matchField("Codice PIN")).toBe("pin");
    expect(matchField("Chiave 2FA")).toBe("totp");
    expect(matchField("Annotazioni")).toBe("notes");
  });
  it("colonne non riconosciute restano null (diventano campo extra)", () => {
    expect(matchField("Colore preferito")).toBeNull();
  });
  it("intestazioni con codice/pin/segreto sono marcate come campo da nascondere", () => {
    expect(isSecretHeader("Codice cliente")).toBe(true);
    expect(isSecretHeader("Domanda di sicurezza")).toBe(true);
    expect(isSecretHeader("Note")).toBe(false);
  });
});

describe("rilevamento riga di intestazione", () => {
  it("trova la prima riga con almeno 2 celle riconosciute", () => {
    const aoa = [
      ["Elenco password personali"],
      ["Nome", "Password", "Note"],
      ["Fineco", "abc123", ""],
    ];
    expect(detectHeaderRowIndex(aoa)).toBe(1);
  });
  it("ritorna -1 se non trova nessuna intestazione riconoscibile", () => {
    const aoa = [["a", "b", "c"], ["1", "2", "3"]];
    expect(detectHeaderRowIndex(aoa)).toBe(-1);
  });
});

describe("mappatura colonne ed estrazione righe", () => {
  // "Sito" da solo è sinonimo di nome (tabella del prompt), "Indirizzo" di url: niente ambiguità.
  const header = ["Nome", "Indirizzo", "Utente", "Password", "PIN", "Colore"];
  const mapping = buildMapping(header);

  it("mappa le colonne riconosciute e lascia extra quelle sconosciute", () => {
    expect(mapping).toEqual(["name", "url", "user", "pass", "pin", null]);
  });

  it("un sinonimo più specifico (\"sito web\") vince su uno più generico (\"sito\")", () => {
    expect(matchField("Sito")).toBe("name");
    expect(matchField("Sito web")).toBe("url");
  });

  it("PIN e codici con zeri iniziali restano testo intatto (letti come stringa formattata)", () => {
    const aoa = [header, ["Fineco", "finecobank.com", "u1", "pw1", "0123", "blu"]];
    const { items } = cellsToRows(aoa, mapping, 0, {});
    expect(items[0].pin).toBe("0123");
  });

  it("codice di 16 cifre non viene troncato né convertito", () => {
    const aoa = [header, ["Carta", "", "", "1234567890123456", "", ""]];
    const { items } = cellsToRows(aoa, mapping, 0, {});
    expect(items[0].pass).toBe("1234567890123456");
  });

  it("segnala in un avviso se una cella password/PIN era di tipo numerico nel foglio originale", () => {
    const aoa = [header, ["Fineco", "", "", "0123", "0456", ""]];
    // riga assoluta 1 (dopo l'header a indice 0); colonna 3=pass, 4=pin marcate numeriche
    const numericMask = { 1: { 3: true, 4: true } };
    const { items } = cellsToRows(aoa, mapping, 0, numericMask);
    expect(items[0].numericWarnings.sort()).toEqual(["pass", "pin"]);
  });

  it("righe vuote vengono saltate e contate", () => {
    const aoa = [header, ["Fineco", "", "", "pw", "", ""], ["", "", "", "", "", ""], ["Poste", "", "", "pw2", "", ""]];
    const { items, skipped } = cellsToRows(aoa, mapping, 0, {});
    expect(items).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/vuota/);
  });

  it("righe senza nome né password vengono saltate (probabile riga di totale/commento)", () => {
    const aoa = [header, ["", "solo un sito.it", "", "", "", ""]];
    const { items, skipped } = cellsToRows(aoa, mapping, 0, {});
    expect(items).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it("una riga con solo il nome (es. \"Totale\") viene saltata come probabile riga di commento", () => {
    const aoa = [header, ["Totale", "", "", "", "", ""], ["Fineco", "", "", "pw", "", ""]];
    const { items, skipped } = cellsToRows(aoa, mapping, 0, {});
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Fineco");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/commento\/totale/);
  });

  it("spazi iniziali/finali rimossi da nome/url/utente ma mai dalla password", () => {
    const aoa = [header, ["  Fineco  ", " finecobank.com ", " utente ", "  pw con spazi  ", "0123", ""]];
    const { items } = cellsToRows(aoa, mapping, 0, {});
    expect(items[0].name).toBe("Fineco");
    expect(items[0].url).toBe("finecobank.com");
    expect(items[0].user).toBe("utente");
    expect(items[0].pass).toBe("  pw con spazi  ");
  });

  it("colonne non mappate diventano campi extra con l'intestazione come etichetta", () => {
    const aoa = [header, ["Fineco", "", "", "pw", "", "blu scuro"]];
    const { items } = cellsToRows(aoa, mapping, 0, {});
    attachExtraFields(items, header);
    expect(items[0].fields).toEqual([{ k: "Colore", v: "blu scuro", secret: false }]);
  });
});

describe("mappatura senza intestazione riconoscibile (fallback euristico)", () => {
  it("deduce url da un dominio, utente da un'email, password dalla colonna più varia", () => {
    const aoa = [
      ["Fineco", "finecobank.com", "mario.rossi@example.com", "Tr0ub4dor&3xyz!"],
      ["Poste", "poste.it", "mario@example.com", "AnotherStrongP@ss9"],
    ];
    const mapping = inferMappingWithoutHeader(aoa);
    expect(mapping[1]).toBe("url");
    expect(mapping[2]).toBe("user");
    expect(mapping[3]).toBe("pass");
  });
});

describe("duplicati: stesso nome normalizzato + stesso utente", () => {
  it("aggiorna la voce esistente solo con i campi non vuoti, senza creare doppioni", () => {
    const existing = [{ id: "1", name: "Fineco", user: "mario", pass: "vecchia", url: "", pin: "", totp: "", notes: "", fields: [] }];
    const imported = [{ name: "Fineco", user: "mario", pass: "nuova", url: "finecobank.com", pin: "", totp: "", notes: "", fields: [] }];
    const { items, added, updated } = mergeImportedItems(existing, imported, () => "new-id");
    expect(items).toHaveLength(1);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(items[0].pass).toBe("nuova");
    expect(items[0].url).toBe("finecobank.com");
  });

  it("duplicati dentro lo stesso file importato (stessa voce su più righe) si fondono in una sola", () => {
    const existing = [];
    const imported = [
      { name: "Fineco", user: "mario", pass: "prima", url: "", pin: "", totp: "", notes: "", fields: [] },
      { name: "Fineco", user: "mario", pass: "corretta-dopo", url: "finecobank.com", pin: "", totp: "", notes: "", fields: [] },
    ];
    const { items, added, updated } = mergeImportedItems(existing, imported, () => "new-id");
    expect(items).toHaveLength(1);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(items[0].pass).toBe("corretta-dopo");
    expect(items[0].url).toBe("finecobank.com");
  });

  it("nomi diversi (o utenti diversi) restano voci separate", () => {
    const existing = [{ id: "1", name: "Fineco", user: "mario", pass: "x", url: "", pin: "", totp: "", notes: "", fields: [] }];
    const imported = [{ name: "Fineco", user: "luigi", pass: "y", url: "", pin: "", totp: "", notes: "", fields: [] }];
    const { items, added, updated } = mergeImportedItems(existing, imported, () => "new-id");
    expect(items).toHaveLength(2);
    expect(added).toBe(1);
    expect(updated).toBe(0);
  });
});

describe("mascheramento password nell'anteprima", () => {
  it("maschera senza rivelare la lunghezza esatta oltre 10 caratteri", () => {
    expect(maskPassword("abc")).toBe("•••");
    expect(maskPassword("password molto lunga")).toBe("••••••••••");
    expect(maskPassword("")).toBe("");
  });
});
