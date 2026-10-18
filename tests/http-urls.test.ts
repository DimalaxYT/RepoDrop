/**
 * Tests des helpers d'URL « publique » (lib/http.ts).
 *
 * Contexte : en développement, Next.js relaie la requête vers un serveur de
 * rendu interne joignable sur 0.0.0.0:<port>. `req.url` pointe donc vers
 * cette adresse interne — non navigable (ERR_ADDRESS_INVALID). On doit
 * reconstruire l'URL publique à partir des en-têtes de proxy.
 */
import { describe, expect, it } from "vitest";
import {
  isSecureRequest,
  publicHost,
  publicOrigin,
  publicProtocol,
  redirectTo,
} from "../lib/http";

/** Requête simulant l'arrivée via un proxy (preview / ingress). */
function proxied(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

const PREVIEW_HOST = "10000-i1pyp7vero96bt41hmzdj.e2b.app";

describe("publicHost", () => {
  it("privilégie x-forwarded-host (hôte public d'origine)", () => {
    const req = proxied("http://0.0.0.0:10000/api/auth/dev-login", {
      host: "10.0.0.5:10000",
      "x-forwarded-host": PREVIEW_HOST,
    });
    expect(publicHost(req)).toBe(PREVIEW_HOST);
  });

  it("retombe sur l'en-tête host si x-forwarded-host est absent", () => {
    const req = proxied("http://0.0.0.0:10000/x", { host: "127.0.0.1:10000" });
    expect(publicHost(req)).toBe("127.0.0.1:10000");
  });

  it("ignore les hôtes non routables (0.0.0.0, ::)", () => {
    const req = proxied("http://0.0.0.0:10000/x", {
      host: "0.0.0.0:10000",
      "x-forwarded-host": "0.0.0.0:10000",
    });
    expect(publicHost(req)).toBe("");
  });

  it("conserve un hôte IPv4 local valide", () => {
    const req = proxied("http://0.0.0.0:10000/x", { host: "127.0.0.1:10000" });
    expect(publicHost(req)).not.toBe("");
  });
});

describe("publicProtocol / isSecureRequest", () => {
  it("détecte https via x-forwarded-proto", () => {
    const req = proxied("http://0.0.0.0:10000/x", {
      host: "example.test",
      "x-forwarded-proto": "https",
    });
    expect(publicProtocol(req)).toBe("https");
    expect(isSecureRequest(req)).toBe(true);
  });

  it("reste en http quand le proxy annonce http", () => {
    const req = proxied("http://0.0.0.0:10000/x", {
      host: "example.test",
      "x-forwarded-proto": "http",
    });
    expect(publicProtocol(req)).toBe("http");
    expect(isSecureRequest(req)).toBe(false);
  });

  it("gère une liste de protocoles (proxy en chaîne)", () => {
    const req = proxied("http://0.0.0.0:10000/x", {
      host: "example.test",
      "x-forwarded-proto": "https, http",
    });
    expect(publicProtocol(req)).toBe("https");
  });
});

describe("publicOrigin", () => {
  it("reconstruit l'origine publique (schéma + hôte)", () => {
    const req = proxied("http://0.0.0.0:10000/api/auth/dev-login", {
      host: "10.0.0.5:10000",
      "x-forwarded-host": PREVIEW_HOST,
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(req)).toBe(`https://${PREVIEW_HOST}`);
  });

  it("ne renvoie jamais 0.0.0.0", () => {
    const req = proxied("http://0.0.0.0:10000/x", {
      host: "0.0.0.0:10000",
      "x-forwarded-host": "0.0.0.0:10000",
    });
    expect(publicOrigin(req)).not.toContain("0.0.0.0");
  });
});

describe("redirectTo", () => {
  it("produit un Location relatif (résolu par le navigateur)", () => {
    const res = redirectTo("/import");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/import");
  });

  it("conserve la query string", () => {
    const res = redirectTo("/login?error=devauth");
    expect(res.headers.get("location")).toBe("/login?error=devauth");
  });
});
