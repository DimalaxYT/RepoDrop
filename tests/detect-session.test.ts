/**
 * Tests de la détection de format (magic bytes) et du chiffrement de session.
 */
import { describe, expect, it } from "vitest";
import { detectFormat } from "@/lib/extract";
import { sealSession, openSession } from "@/lib/session";

describe("detectFormat", () => {
  it("reconnaît le ZIP (PK\\x03\\x04)", () => {
    expect(detectFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe("zip");
  });
  it("reconnaît le ZIP vide (PK\\x05\\x06)", () => {
    expect(detectFormat(Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]))).toBe("zip");
  });
  it("reconnaît le RAR4", () => {
    const b = Buffer.from("Rar!\u001a\u0007\u0000", "binary");
    expect(detectFormat(b)).toBe("rar");
  });
  it("reconnaît le RAR5", () => {
    const b = Buffer.from("Rar!\u001a\u0007\u0001\u0000", "binary");
    expect(detectFormat(b)).toBe("rar");
  });
  it("refuse l'inconnu", () => {
    expect(detectFormat(Buffer.from("MZ\x90\x00\x03"))).toBeNull(); // .exe
    expect(detectFormat(Buffer.from("\u0000\u0001\u0002"))).toBeNull();
    expect(detectFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("session chiffrée", () => {
  it("fait un aller-retour seal → open", async () => {
    const sealed = await sealSession({
      login: "alice",
      name: "Alice",
      avatar: "https://avatars.example/x.png",
      token: "gho_secret_token_value",
    });
    // Le jeton ne doit PAS être lisible en clair dans le cookie.
    expect(sealed).not.toContain("gho_secret_token_value");
    expect(sealed).not.toContain("alice");

    const opened = await openSession(sealed);
    expect(opened).toEqual({
      login: "alice",
      name: "Alice",
      avatar: "https://avatars.example/x.png",
      token: "gho_secret_token_value",
      staffUnlocked: false,
    });
  });

  it("conserve le déverrouillage du panel staff, et rien d'autre ne le vaut", async () => {
    const sealed = await sealSession({
      login: "alice",
      name: "Alice",
      avatar: "",
      token: "gho_secret_token_value",
      staffUnlocked: true,
    });
    const opened = await openSession(sealed);
    expect(opened?.staffUnlocked).toBe(true);

    // Un cookie scellé sans le claim ne peut pas le faire apparaître : le JWE
    // est authentifié, toute modification invalide le cookie (test suivant).
    const plain = await sealSession({
      login: "alice",
      name: "Alice",
      avatar: "",
      token: "gho_secret_token_value",
    });
    expect((await openSession(plain))?.staffUnlocked).toBe(false);
  });

  it("rejette un cookie altéré", async () => {
    const sealed = await sealSession({
      login: "bob",
      name: "Bob",
      avatar: "",
      token: "x",
    });
    const tampered = sealed.slice(0, sealed.length - 6) + "AAAAAA";
    await expect(openSession(tampered)).resolves.toBeNull();
  });
});
