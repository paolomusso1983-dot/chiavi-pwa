import { describe, it, expect } from "vitest";
import { totpAt } from "../src/totp.js";

// Vettori di test ufficiali RFC 6238, appendice B, colonna SHA-1, secret "12345678901234567890" (ASCII).
// SPEC.md punto 8.1 li richiede in base32: lo stesso segreto ASCII codificato in base32.
const SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890" in base32

describe("TOTP RFC 6238", () => {
  it("T=59 -> 94287082", async () => {
    expect(await totpAt(SECRET_B32, 59, 30, 8)).toBe("94287082");
  });
  it("T=1111111109 -> 07081804", async () => {
    expect(await totpAt(SECRET_B32, 1111111109, 30, 8)).toBe("07081804");
  });
  it("T=20000000000 -> 65353130", async () => {
    expect(await totpAt(SECRET_B32, 20000000000, 30, 8)).toBe("65353130");
  });
});
