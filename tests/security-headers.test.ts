/**
 * En-têtes de sécurité.
 *
 * L'enjeu n'est pas seulement « les en-têtes sont présents » : une CSP mal
 * écrite casse l'application (scripts bloqués, HMR hors service). Ces tests
 * fixent donc les deux côtés du contrat — ce qui est interdit, et ce qui doit
 * rester autorisé pour que l'app fonctionne.
 */
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

/** Découpe une CSP en map directive -> valeur. */
const parse = (csp: string) =>
  Object.fromEntries(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(" ");
        return [name, rest.join(" ")];
      }),
  );

describe("Content-Security-Policy", () => {
  it("verrouille l'origine par défaut", () => {
    const d = parse(contentSecurityPolicy({ nodeEnv: "production" }));
    expect(d["default-src"]).toBe("'self'");
  });

  it("interdit les plugins embarqués et les URI externes", () => {
    const d = parse(contentSecurityPolicy({ nodeEnv: "production" }));
    expect(d["object-src"]).toBe("'none'");
    expect(d["base-uri"]).toBe("'self'");
    expect(d["form-action"]).toBe("'self'");
  });

  it("n'autorise les appels réseau que vers l'application", () => {
    const d = parse(contentSecurityPolicy({ nodeEnv: "production" }));
    expect(d["connect-src"]).toBe("'self'");
  });

  it("autorise les scripts en ligne (Next.js en émet au démarrage)", () => {
    // Sans 'unsafe-inline', l'amorçage de Next.js est bloqué et la page reste
    // blanche : c'est la régression la plus probable sur ce fichier.
    const d = parse(contentSecurityPolicy({ nodeEnv: "production" }));
    expect(d["script-src"]).toContain("'unsafe-inline'");
  });

  it("refuse 'unsafe-eval' en production", () => {
    const d = parse(contentSecurityPolicy({ nodeEnv: "production" }));
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("autorise 'unsafe-eval' en développement (React Refresh)", () => {
    const d = parse(contentSecurityPolicy({ nodeEnv: "development" }));
    expect(d["script-src"]).toContain("'unsafe-eval'");
  });

  it("autorise le WebSocket du HMR en développement seulement", () => {
    expect(parse(contentSecurityPolicy({ nodeEnv: "development" }))["connect-src"]).toContain("ws:");
    expect(parse(contentSecurityPolicy({ nodeEnv: "production" }))["connect-src"]).not.toContain(
      "ws:",
    );
  });

  it("laisse passer les images https (avatars GitHub) et les data URI", () => {
    const d = parse(contentSecurityPolicy({ nodeEnv: "production" }));
    expect(d["img-src"]).toContain("https:");
    expect(d["img-src"]).toContain("data:");
  });

  it("n'émet frame-ancestors que si c'est demandé", () => {
    expect(contentSecurityPolicy({ nodeEnv: "production" })).not.toContain("frame-ancestors");
    const d = parse(contentSecurityPolicy({ nodeEnv: "production", frameAncestors: "'self'" }));
    expect(d["frame-ancestors"]).toBe("'self'");
  });

  it("n'impose pas upgrade-insecure-requests (casserait l'aperçu http)", () => {
    expect(contentSecurityPolicy({ nodeEnv: "production" })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("jeu d'en-têtes", () => {
  const get = (key: string, opts = {}) =>
    securityHeaders({ nodeEnv: "production", ...opts }).find((h) => h.key === key)?.value;

  it("empêche l'interprétation d'un type MIME deviné", () => {
    expect(get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("ne divulgue que l'origine dans le Referer", () => {
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("désactive les APIs navigateur non utilisées", () => {
    const value = get("Permissions-Policy") ?? "";
    expect(value).toContain("camera=()");
    expect(value).toContain("microphone=()");
    expect(value).toContain("geolocation=()");
  });

  it("force HTTPS pendant un an", () => {
    expect(get("Strict-Transport-Security")).toContain("max-age=31536000");
  });

  it("pose la CSP sur toutes les réponses", () => {
    expect(get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("n'interdit le cadrage que si FRAME_ANCESTORS est renseigné", () => {
    // Par défaut, aucune directive : l'aperçu dans une iframe continue de
    // fonctionner. C'est délibéré et testé, pas un oubli.
    expect(get("X-Frame-Options")).toBeUndefined();
    expect(contentSecurityPolicy({ nodeEnv: "production" })).not.toContain("frame-ancestors");

    expect(get("X-Frame-Options", { frameAncestors: "'self'" })).toBe("SAMEORIGIN");
  });

  it("chaque en-tête a une valeur non vide", () => {
    for (const h of securityHeaders({ nodeEnv: "production" })) {
      expect(h.value.length).toBeGreaterThan(0);
      expect(h.key.length).toBeGreaterThan(0);
    }
  });
});
