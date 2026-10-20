/**
 * Mot de passe du panel staff : empreinte scrypt, amorçage par variable
 * d'environnement, priorité de la base, et limitation des tentatives.
 *
 * Le mot de passe ne doit jamais se retrouver en clair en base, et aucune
 * empreinte malformée ne doit lever d'exception (ce serait un refus de service
 * déclenchable à distance).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `rd-staff-pwd-${process.pid}`);
process.env.DB_PATH = path.join(TMP, "staff.db");
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import { listEvents, getSettingRaw } from "@/lib/db";

beforeAll(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Recharge `lib/staff` avec un environnement donné (config lit l'env à l'import). */
async function loadStaff(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of ["STAFF_PASSWORD", "STAFF_LOGINS", "DEV_AUTH"]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import("@/lib/staff");
}

describe("empreinte scrypt", () => {
  it("vérifie le bon mot de passe et refuse les autres", async () => {
    const staff = await loadStaff();
    const hash = staff.hashStaffPassword("correct horse battery");
    expect(hash.startsWith("scrypt$N=16384,r=8,p=1$")).toBe(true);
    expect(staff.verifyStaffPasswordHash("correct horse battery", hash)).toBe(true);
    expect(staff.verifyStaffPasswordHash("Correct horse battery", hash)).toBe(false);
    expect(staff.verifyStaffPasswordHash("", hash)).toBe(false);
  });

  it("sale chaque empreinte : deux hashes diffèrent mais vérifient tous les deux", async () => {
    const staff = await loadStaff();
    const a = staff.hashStaffPassword("même-mot-de-passe");
    const b = staff.hashStaffPassword("même-mot-de-passe");
    expect(a).not.toBe(b);
    expect(staff.verifyStaffPasswordHash("même-mot-de-passe", a)).toBe(true);
    expect(staff.verifyStaffPasswordHash("même-mot-de-passe", b)).toBe(true);
  });

  it("ne lève jamais d'exception sur une empreinte malformée", async () => {
    const staff = await loadStaff();
    const broken = [
      "",
      "md5$N=1,r=1,p=1$aa$bb",
      "scrypt$N=16384,r=8,p=1$aa",
      "scrypt$N=abc,r=8,p=1$aa$bb",
      "scrypt$N=0,r=8,p=1$aa$bb",
      "scrypt$r=8,p=1$aa$bb",
      "scrypt$N=16384,r=8,p=1$$bb",
      "scrypt$N=16384,r=8,p=1$aa$",
      "scrypt$N=16384,r=8,p=1$zzzz$qqqq",
      "scrypt$N=999999999999,r=8,p=1$aa$bb",
    ];
    for (const b of broken) {
      expect(staff.verifyStaffPasswordHash("secret", b)).toBe(false);
    }
  });

  it("accepte une empreinte produite avec d'autres paramètres (auto-descriptive)", async () => {
    const staff = await loadStaff();
    const crypto = await import("node:crypto");
    const salt = crypto.randomBytes(8);
    const hash = crypto.scryptSync("secret", salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$N=1024,r=8,p=1$${salt.toString("hex")}$${hash.toString("hex")}`;
    expect(staff.verifyStaffPasswordHash("secret", stored)).toBe(true);
    expect(staff.verifyStaffPasswordHash("autre", stored)).toBe(false);
  });
});

describe("amorçage et stockage", () => {
  it("aucun mot de passe par défaut", async () => {
    const staff = await loadStaff();
    expect(await staff.isStaffPasswordSet()).toBe(false);
    expect(await staff.verifyStaffPassword("quoi-que-ce-soit")).toBe(false);
  });

  it("STAFF_PASSWORD suffit à exiger un mot de passe", async () => {
    const staff = await loadStaff({ STAFF_PASSWORD: "s3cret-panel" });
    expect(await staff.isStaffPasswordSet()).toBe(true);
    expect(await staff.verifyStaffPassword("s3cret-panel")).toBe(true);
    expect(await staff.verifyStaffPassword("S3CRET-PANEL")).toBe(false);
    expect(await staff.verifyStaffPassword("")).toBe(false);
  });

  it("enregistre une empreinte, jamais le mot de passe en clair", async () => {
    const staff = await loadStaff();
    await staff.setStaffPassword("mot-de-passe-du-panel", { login: "alice" });

    expect(await staff.isStaffPasswordSet()).toBe(true);
    expect(await staff.verifyStaffPassword("mot-de-passe-du-panel")).toBe(true);
    expect(await staff.verifyStaffPassword("mauvais")).toBe(false);

    const stored = getSettingRaw("staff.passwordHash");
    expect(stored).toContain("scrypt$");
    expect(stored).not.toContain("mot-de-passe-du-panel");
    expect(JSON.stringify(listEvents({ limit: 20 }))).not.toContain(
      "mot-de-passe-du-panel",
    );

    // Le changement est tracé dans le journal d'activité.
    const entry = listEvents({ limit: 5 }).find(
      (e) => (e.detail as { scope?: string } | null)?.scope === "staff.password",
    );
    expect(entry?.login).toBe("alice");
    expect(await staff.staffPasswordUpdatedAt()).toBeTruthy();
  });

  it("la valeur en base a priorité sur STAFF_PASSWORD", async () => {
    const staff = await loadStaff({ STAFF_PASSWORD: "amorcage" });
    await staff.setStaffPassword("depuis-le-panel");

    // Recharge pour repartir d'un état propre (config relue).
    const fresh = await loadStaff({ STAFF_PASSWORD: "amorcage" });
    expect(await fresh.verifyStaffPassword("depuis-le-panel")).toBe(true);
    expect(await fresh.verifyStaffPassword("amorcage")).toBe(false);
  });

  it("une chaîne vide supprime le verrou", async () => {
    const staff = await loadStaff();
    await staff.setStaffPassword("temporaire");
    expect(await staff.isStaffPasswordSet()).toBe(true);

    await staff.setStaffPassword("");
    expect(await staff.isStaffPasswordSet()).toBe(false);
    expect(await staff.verifyStaffPassword("temporaire")).toBe(false);
    // La ligne subsiste (setString écrit un JSON vide) mais ne contient plus
    // aucune empreinte : c'est ce qui compte.
    expect(getSettingRaw("staff.passwordHash")).not.toContain("scrypt$");
    expect(await staff.staffPasswordUpdatedAt()).toBeFalsy();
  });
});

describe("limitation des tentatives", () => {
  it("une faute de frappe ne bloque PAS : le seuil est à 6 échecs", async () => {
    const staff = await loadStaff();
    const ip = "203.0.113.9";
    staff.resetUnlockAttempts(ip);

    // 1er échec : il reste des essais et l'accès n'est pas suspendu.
    expect(staff.recordUnlockFailure(ip)).toBe(5);
    expect(staff.unlockThrottledUntil(ip)).toBe(0);

    // 5 échecs : toujours ouvert.
    for (let i = 0; i < 4; i += 1) staff.recordUnlockFailure(ip);
    expect(staff.unlockThrottledUntil(ip)).toBe(0);
    staff.resetUnlockAttempts(ip);
  });

  it("bloque au 6e échec, pour 15 minutes au plus, puis se réinitialise", async () => {
    const staff = await loadStaff();
    const ip = "203.0.113.7";
    staff.resetUnlockAttempts(ip);

    const left = [1, 2, 3, 4, 5, 6].map(() => staff.recordUnlockFailure(ip));
    expect(left).toEqual([5, 4, 3, 2, 1, 0]);

    const until = staff.unlockThrottledUntil(ip);
    expect(until).toBeGreaterThan(Date.now());
    expect(until - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);

    staff.resetUnlockAttempts(ip);
    expect(staff.unlockThrottledUntil(ip)).toBe(0);
  });

  it("compte chaque IP séparément", async () => {
    const staff = await loadStaff();
    staff.resetUnlockAttempts("198.51.100.1");
    staff.resetUnlockAttempts("198.51.100.2");
    for (let i = 0; i < 6; i += 1) staff.recordUnlockFailure("198.51.100.1");
    expect(staff.unlockThrottledUntil("198.51.100.1")).toBeGreaterThan(Date.now());
    expect(staff.unlockThrottledUntil("198.51.100.2")).toBe(0);
    staff.resetUnlockAttempts("198.51.100.1");
  });
});
