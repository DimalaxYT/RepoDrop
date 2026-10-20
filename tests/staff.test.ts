/**
 * Contrôle d'accès au panel staff.
 *
 * `lib/config` lit l'environnement à l'import : chaque cas recharge donc les
 * modules après avoir posé ses variables.
 */
import { describe, expect, it, vi } from "vitest";

async function loadStaff(env: {
  STAFF_LOGINS?: string;
  DEV_AUTH?: string;
}): Promise<typeof import("@/lib/staff")> {
  vi.resetModules();
  delete process.env.STAFF_LOGINS;
  delete process.env.DEV_AUTH;
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) process.env[k] = v;
  }
  return import("@/lib/staff");
}

describe("isStaffLogin", () => {
  it("accepte les logins listés, sans tenir compte de la casse", async () => {
    const staff = await loadStaff({ STAFF_LOGINS: "Alice, BOB ,carole" });
    expect(staff.isStaffLogin("alice")).toBe(true);
    expect(staff.isStaffLogin("BOB")).toBe(true);
    expect(staff.isStaffLogin(" bob ")).toBe(true);
    expect(staff.isStaffLogin("carole")).toBe(true);
    expect(staff.staffConfigured()).toBe(true);
  });

  it("refuse tout le monde si la liste est vide", async () => {
    const staff = await loadStaff({});
    expect(staff.isStaffLogin("alice")).toBe(false);
    expect(staff.isStaffLogin(null)).toBe(false);
    expect(staff.isStaffLogin("")).toBe(false);
    expect(staff.staffConfigured()).toBe(false);
  });

  it("refuse un compte absent de la liste", async () => {
    const staff = await loadStaff({ STAFF_LOGINS: "alice" });
    expect(staff.isStaffLogin("eve")).toBe(false);
  });

  it("ouvre l'accès à tout compte connecté en mode dev sans liste", async () => {
    const staff = await loadStaff({ DEV_AUTH: "1" });
    expect(staff.isStaffLogin("n-importe-qui")).toBe(true);
  });

  it("n'ouvre PAS l'accès en mode dev dès qu'une liste existe", async () => {
    const staff = await loadStaff({ DEV_AUTH: "1", STAFF_LOGINS: "alice" });
    expect(staff.isStaffLogin("alice")).toBe(true);
    expect(staff.isStaffLogin("eve")).toBe(false);
  });
});
