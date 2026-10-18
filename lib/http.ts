import { config } from "./config";

/** Réponses JSON standardisées des API. */
export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function jsonError(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return json({ error, ...extra }, status);
}

/**
 * `0.0.0.0` (et `::`) signifie « toutes les interfaces » côté serveur :
 * ce n'est PAS une adresse navigable. Le navigateur répond
 * `ERR_ADDRESS_INVALID` si on le lui renvoie dans un `Location`.
 */
const NON_ROUTABLE_HOSTS = new Set(["0.0.0.0", "::", "0:0:0:0:0:0:0:0", ""]);

/** Première valeur d'un en-tête pouvant être une liste (`a, b`). */
function firstValue(header: string | null): string {
  if (!header) return "";
  return header.split(",")[0]?.trim() ?? "";
}

/** Nom d'hôte (sans port) d'un en-tête `host`. */
function hostnameOf(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "").split(":")[0]?.toLowerCase() ?? "";
}

function isRoutableHost(host: string): boolean {
  if (!host) return false;
  return !NON_ROUTABLE_HOSTS.has(hostnameOf(host));
}

/**
 * Hôte public de la requête — celui que le navigateur a utilisé.
 *
 * En développement, Next.js relaie la requête vers un serveur de rendu interne
 * joignable sur `0.0.0.0:<port>` : `req.url` pointe donc vers cette adresse
 * interne, qui n'est pas exploitable par le navigateur. L'hôte public
 * d'origine est conservé dans les en-têtes de proxy (`x-forwarded-host`).
 */
export function publicHost(req: Request): string {
  const candidates = [
    firstValue(req.headers.get("x-forwarded-host")),
    firstValue(req.headers.get("host")),
  ];
  return candidates.find(isRoutableHost) ?? "";
}

/**
 * Protocole public de la requête.
 *
 * `APP_URL` fait foi quand l'hôte de la requête lui correspond (c'est
 * l'URL publique déclarée de l'application) ; sinon on se fie à
 * `x-forwarded-proto`, posé par le proxy TLS.
 */
export function publicProtocol(req: Request): "http" | "https" {
  const host = publicHost(req);
  if (host) {
    try {
      const app = new URL(config.appUrl);
      if (app.hostname.toLowerCase() === hostnameOf(host)) {
        return app.protocol === "https:" ? "https" : "http";
      }
    } catch {
      /* APP_URL invalide : on ignore */
    }
  }
  const fwd = firstValue(req.headers.get("x-forwarded-proto")).toLowerCase();
  if (fwd === "https" || fwd === "http") return fwd;
  try {
    return new URL(req.url).protocol === "https:" ? "https" : "http";
  } catch {
    return "http";
  }
}

/** Origine publique de la requête (schéma + hôte), utilisable dans une URL absolue. */
export function publicOrigin(req: Request): string {
  const host = publicHost(req);
  if (host) return `${publicProtocol(req)}://${host}`;
  // Aucun hôte routable : on se rabat sur l'URL publique déclarée.
  try {
    const app = new URL(config.appUrl);
    if (isRoutableHost(app.host)) return app.origin;
  } catch {
    /* APP_URL invalide */
  }
  return "http://localhost";
}

/**
 * La requête arrive-t-elle en HTTPS ?
 * On suit le protocole réellement utilisé (et non `APP_URL`) afin que le
 * cookie de session reste valide aussi bien derrière un proxy TLS (preview,
 * ingress) qu'en local sur http://localhost.
 */
export function isSecureRequest(req: Request): boolean {
  return publicProtocol(req) === "https";
}

/**
 * Redirection vers un chemin de l'application.
 *
 * Le `Location` est **relatif** : le navigateur le résout contre l'origine
 * courante, qui est forcément la bonne (celle de la barre d'adresse). On évite
 * ainsi de reconstruire une URL absolue à partir d'un `req.url` qui, en dev
 * ou derrière un proxy, désigne l'adresse interne du serveur (`0.0.0.0`).
 */
export function redirectTo(path: string, status = 307): Response {
  return new Response(null, {
    status,
    headers: {
      Location: path,
      "Cache-Control": "no-store",
    },
  });
}
