import { describe, it, expect } from "vitest";
import { deriveKey, sealVault, openBlob, validBlob, genPw, ITER } from "../src/crypto.js";

async function makeState(pw, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pw, salt, ITER);
  return { key, salt, iter: ITER, data };
}

describe("cifratura", () => {
  it("andata/ritorno: apre con la password giusta e ritrova gli stessi dati", async () => {
    const state = await makeState("una frase segreta di prova", { items: [{ id: "1", name: "Test" }], meta: {} });
    const blob = await sealVault(state);
    expect(validBlob(blob)).toBe(true);
    const opened = await openBlob(blob, "una frase segreta di prova");
    expect(opened.data).toEqual(state.data);
  });

  it("rifiuta la password errata", async () => {
    const state = await makeState("password corretta 123456", { items: [], meta: {} });
    const blob = await sealVault(state);
    await expect(openBlob(blob, "password sbagliata 123456")).rejects.toThrow();
  });

  it("usa un IV diverso a ogni salvataggio", async () => {
    const state = await makeState("stessa password sempre 12", { items: [], meta: {} });
    const b1 = await sealVault(state);
    const b2 = await sealVault(state);
    expect(b1.iv).not.toBe(b2.iv);
    expect(b1.ct).not.toBe(b2.ct);
  });

  it("il blob rispetta il formato atteso (app/kdf/iter)", async () => {
    const state = await makeState("altra frase di prova ok", { items: [], meta: {} });
    const blob = await sealVault(state);
    expect(blob.app).toBe("chiavi");
    expect(blob.kdf).toBe("PBKDF2-SHA256");
    expect(blob.iter).toBe(600000);
  });
});

describe("generatore password", () => {
  it("genera la lunghezza richiesta", () => {
    expect(genPw(20)).toHaveLength(20);
    expect(genPw(32)).toHaveLength(32);
  });
  it("non produce due password identiche di seguito (probabilisticamente)", () => {
    expect(genPw(24)).not.toBe(genPw(24));
  });
});
