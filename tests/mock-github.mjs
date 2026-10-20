/**
 * Fausse API GitHub, importable depuis les tests.
 *
 * Pourquoi ce module existe : les vérifications de bout en bout des routes
 * `/api/repos*` étaient faites à la main contre un fichier posé hors du dépôt,
 * donc **non reproductibles** par qui que ce soit d'autre. Ici, le serveur fait
 * partie du code et tourne dans la CI.
 *
 * Aucune dépendance : `node:http` + `node:zlib`. Les archives servies sont
 * générées à la volée et sont **réellement valides** (zip avec répertoire
 * central et EOCD, tar.gz avec somme de contrôle d'en-tête) — un test peut donc
 * les repasser à `unzip` / `tar` sans tricher.
 */
import http from "node:http";
import zlib from "node:zlib";

/* ------------------------------------------------------------------ *
 * Génération d'archives valides
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Archive ZIP **stockée** (sans compression) mais complète : en-têtes locaux,
 * répertoire central et EOCD. Suffisante pour `unzip -t`.
 */
export function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // méthode : stored
    local.writeUInt16LE(0, 10); // heure
    local.writeUInt16LE(0x21, 12); // date (1996-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

/** Archive tar.gz valide (en-tête 512 octets avec somme de contrôle). */
export function buildTarGz(files) {
  const blocks = [];
  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf8");
    const header = Buffer.alloc(512);
    header.write(name.slice(0, 99), 0, "utf8");
    header.write("0000644\0", 100, "utf8");
    header.write("0000000\0", 108, "utf8");
    header.write("0000000\0", 116, "utf8");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    header.write("00000000000\0", 136, "utf8"); // mtime
    header.write("        ", 148, "utf8"); // somme provisoire (espaces)
    header.write("0", 156, "utf8"); // typeflag : fichier
    header.write("ustar\0", 257, "utf8");
    header.write("00", 263, "utf8");

    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");

    const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
    blocks.push(header, data, pad);
  }
  blocks.push(Buffer.alloc(1024)); // deux blocs nuls de fin
  return zlib.gzipSync(Buffer.concat(blocks));
}

export const ZIP_BYTES = buildZip([
  ["README.md", "# Mon projet\n\nLigne de démonstration.\n"],
  ["src/index.ts", 'export const hello = "monde";\n'],
]);

export const TAR_BYTES = buildTarGz([
  ["README.md", "# Mon projet\n\nLigne de démonstration.\n"],
  ["src/index.ts", 'export const hello = "monde";\n'],
]);

/* ------------------------------------------------------------------ *
 * Données de démonstration
 * ------------------------------------------------------------------ */

/** Jeton attendu par le mock sur les routes protégées. */
export const EXPECTED_AUTH = "Bearer gho_test";

export const REPOS = [
  {
    full_name: "dimalaxyt/mon-projet",
    name: "mon-projet",
    owner: { login: "DimalaxYT" },
    private: false,
    archived: false,
    fork: false,
    default_branch: "main",
    pushed_at: "2026-10-19T10:00:00Z",
    updated_at: "2026-10-19T10:00:00Z",
    size: 128,
    description: "Démo de dépôt",
    language: "TypeScript",
    html_url: "https://github.com/dimalaxyt/mon-projet",
    stargazers_count: 3,
    open_issues_count: 1,
    permissions: { pull: true, push: true, admin: true },
  },
  {
    full_name: "dimalaxyt/legacy",
    name: "legacy",
    owner: { login: "DimalaxYT" },
    private: true,
    archived: true,
    fork: false,
    default_branch: "master",
    pushed_at: "2025-02-01T00:00:00Z",
    updated_at: "2025-02-01T00:00:00Z",
    size: 42,
    description: null,
    language: "Python",
    html_url: "https://github.com/dimalaxyt/legacy",
    stargazers_count: 0,
    open_issues_count: 0,
    permissions: { pull: true, push: true, admin: true },
  },
  {
    full_name: "autre-org/lecture-seule",
    name: "lecture-seule",
    owner: { login: "autre-org" },
    private: false,
    archived: false,
    fork: false,
    default_branch: "main",
    pushed_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    size: 7,
    description: "Collaboration, sans droits d'écriture",
    language: "Go",
    html_url: "https://github.com/autre-org/lecture-seule",
    stargazers_count: 0,
    open_issues_count: 0,
    permissions: { pull: true, push: false, admin: false },
  },
];

const entry = (name, type, size = 0) => ({ name, path: name, sha: `s-${name}`, size, type });

export const ROOT_ENTRIES = [
  entry("src", "dir"),
  entry("README.md", "file", 34),
  entry("package.json", "file", 120),
  entry("logo.png", "file", 2048),
];
export const SRC_ENTRIES = [entry("app", "dir"), entry("index.ts", "file", 88)];
export const SRC_APP_ENTRIES = [entry("page.tsx", "file", 64)];

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/* ------------------------------------------------------------------ *
 * Serveur
 * ------------------------------------------------------------------ */

/** @typedef {{ method: string, path: string, search: string }} MockCall */
/**
 * @typedef {object} MockPatch
 * @property {string} [name]
 * @property {string | null} [description]
 * @property {boolean} [private]
 */

/**
 * Démarre la fausse API.
 *
 * @param {object} [opts]
 * @param {number} [opts.port=0] 0 = port libre choisi par l'OS
 * @returns {Promise<{ url: string, port: number, calls: MockCall[], patches: MockPatch[], stop: () => Promise<void> }>}
 */
export async function startMockGithub({ port = 0 } = {}) {
  /** @type {MockCall[]} Toutes les requêtes reçues, pour assertions. */
  const calls = [];
  /** @type {MockPatch[]} Corps des PATCH, pour vérifier ce qui est envoyé. */
  const patches = [];
  /**
   * Origine réelle du mock. `req.url` ne porte que le chemin, donc l'URL
   * reconstituée dans le handler aurait l'hôte du fallback (« localhost », sans
   * port) : on utilise cette valeur pour les en-têtes absolus (Link).
   */
  let origin = "http://127.0.0.1";

  const send = (res, body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const key = `${req.method ?? "GET"} ${url.pathname}`;
    calls.push({ method: req.method, path: url.pathname, search: url.search });

    // Contrôle du jeton sur une route : prouve que le client envoie bien
    // l'en-tête attendu, et permet de tester le mappage 401.
    if (url.pathname === "/user/repos" && req.headers.authorization !== EXPECTED_AUTH) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "0",
      });
      return res.end(JSON.stringify({ message: "Bad credentials" }));
    }

    if (key === "GET /user") {
      return send(res, {
        login: "dimalaxyt",
        name: "Dima",
        avatar_url: "https://avatars.example/x.png",
      });
    }
    if (key === "GET /user/repos") {
      // Deux pages, reliées par l'en-tête Link comme le fait GitHub : c'est ce
      // qui permet de tester que le client suit réellement la pagination.
      if (url.searchParams.get("page") === "2") {
        return send(res, [REPOS[2]]);
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        Link: `<${origin}/user/repos?per_page=100&page=2>; rel="next"`,
      });
      return res.end(JSON.stringify([REPOS[0], REPOS[1]]));
    }
    if (key === "GET /repos/dimalaxyt/mon-projet") return send(res, REPOS[0]);
    if (key === "GET /repos/dimalaxyt/legacy") return send(res, REPOS[1]);
    if (key === "GET /repos/dimalaxyt/mon-projet/branches") {
      return send(res, [
        { name: "main", protected: true },
        { name: "dev", protected: false },
      ]);
    }
    // Référence inconnue : GitHub répond 404 (message d'origine conservé).
    if (
      url.pathname.startsWith("/repos/dimalaxyt/mon-projet/contents") &&
      url.searchParams.get("ref") === "branche-inconnue"
    ) {
      return send(res, { message: "reference does not exist" }, 404);
    }
    // Dépôt créé mais jamais commité : GitHub répond 404 « repository is empty ».
    if (
      url.pathname.startsWith("/repos/dimalaxyt/vide/contents")
    ) {
      return send(res, { message: "This repository is empty." }, 404);
    }

    if (key === "GET /repos/dimalaxyt/mon-projet/contents/") return send(res, ROOT_ENTRIES);
    if (key === "GET /repos/dimalaxyt/mon-projet/contents/src") return send(res, SRC_ENTRIES);
    if (key === "GET /repos/dimalaxyt/mon-projet/contents/src/app") {
      return send(res, SRC_APP_ENTRIES);
    }

    if (key === "GET /repos/dimalaxyt/mon-projet/contents/README.md") {
      const content = "# Mon projet\n\nLigne de démonstration.";
      return send(res, {
        name: "README.md",
        path: "README.md",
        type: "file",
        size: Buffer.byteLength(content),
        sha: "r1",
        content: b64(content),
        encoding: "base64",
      });
    }
    if (key === "GET /repos/dimalaxyt/mon-projet/contents/package.json") {
      const content = JSON.stringify({ name: "mon-projet", version: "1.0.0" }, null, 2);
      return send(res, {
        name: "package.json",
        path: "package.json",
        type: "file",
        size: Buffer.byteLength(content),
        sha: "r2",
        content: b64(content),
        encoding: "base64",
      });
    }
    if (key === "GET /repos/dimalaxyt/mon-projet/contents/src/index.ts") {
      const content = 'export const hello = "monde";\n';
      return send(res, {
        name: "index.ts",
        path: "src/index.ts",
        type: "file",
        size: Buffer.byteLength(content),
        sha: "r3",
        content: b64(content),
        encoding: "base64",
      });
    }
    if (key === "GET /repos/dimalaxyt/mon-projet/contents/docs") {
      return send(res, { name: "docs", path: "docs", type: "dir", size: 0, sha: "d1" });
    }
    if (key === "GET /repos/dimalaxyt/mon-projet/contents/logo.png") {
      return send(res, {
        name: "logo.png",
        path: "logo.png",
        type: "file",
        size: 2048,
        sha: "r4",
        // Octets invalides en UTF-8 : doit être détecté binaire.
        content: Buffer.from([0x89, 0x50, 0x4e, 0xff, 0xfe, 0xfd]).toString("base64"),
        encoding: "base64",
      });
    }
    // --- Archives ---------------------------------------------------
    if (key === "GET /repos/dimalaxyt/mon-projet/zipball/main") {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(ZIP_BYTES.length),
        "Content-Disposition": 'attachment; filename="DimalaxYT-mon-projet-main-abc1234.zip"',
      });
      return res.end(ZIP_BYTES);
    }
    // Même archive sur la branche « dev » : permet de vérifier que la
    // référence demandée est bien propagée dans l'URL.
    if (key === "GET /repos/dimalaxyt/mon-projet/zipball/dev") {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(ZIP_BYTES.length),
      });
      return res.end(ZIP_BYTES);
    }
    if (key === "GET /repos/dimalaxyt/mon-projet/tarball/main") {
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Length": String(TAR_BYTES.length),
      });
      return res.end(TAR_BYTES);
    }
    // Dépôt « legacy » : archive annoncée au-delà du plafond (250 Mo).
    if (key === "GET /repos/dimalaxyt/legacy/zipball/master") {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(300 * 1024 * 1024),
      });
      return res.end();
    }

    // --- Écritures --------------------------------------------------
    if (key === "PATCH /repos/dimalaxyt/mon-projet") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const patch = JSON.parse(body || "{}");
        patches.push(patch);
        return send(res, {
          ...REPOS[0],
          name: patch.name ?? REPOS[0].name,
          full_name: `dimalaxyt/${patch.name ?? REPOS[0].name}`,
          private: patch.private ?? REPOS[0].private,
          description:
            patch.description !== undefined ? patch.description : REPOS[0].description,
        });
      });
      return;
    }
    if (key === "DELETE /repos/dimalaxyt/mon-projet") {
      res.writeHead(204);
      return res.end();
    }
    // Dépôt qui simule un quota épuisé : 403 + X-RateLimit-Remaining: 0.
    if (key === "GET /repos/dimalaxyt/epuise") {
      res.writeHead(403, {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "0",
      });
      return res.end(JSON.stringify({ message: "API rate limit exceeded" }));
    }
    // « legacy » simule un jeton sans le scope delete_repo : GitHub répond 404.
    if (key === "DELETE /repos/dimalaxyt/legacy") {
      return send(res, { message: "Not Found" }, 404);
    }

    return send(res, { message: `aucune route mock pour ${key}` }, 404);
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  origin = `http://127.0.0.1:${actual}`;

  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    calls,
    patches,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// Exécution directe : sert sur le port donné (défaut 4599) pour un test manuel
// ou pour le smoke-test HTTP de la CI.
if (process.argv[1] && process.argv[1].endsWith("mock-github.mjs")) {
  const port = Number.parseInt(process.env.MOCK_GITHUB_PORT ?? "4599", 10);
  startMockGithub({ port }).then((m) => {
    console.log(`[mock-github] prêt sur ${m.url}`);
  });
}
