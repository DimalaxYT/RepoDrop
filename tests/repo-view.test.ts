/**
 * État de navigation de /repos sérialisé dans l'URL.
 *
 * L'enjeu est double : un rafraîchissement ou un lien partagé doit retrouver
 * l'écran en cours, et une URL hostile ou obsolète ne doit jamais casser la
 * page. D'où les tests de valeurs invalides, aussi nombreux que les cas nominaux.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPO_VIEW,
  isDefaultRepoView,
  parseRepoView,
  serializeRepoView,
} from "@/lib/repo-view";

const parse = (qs: string) => parseRepoView(new URLSearchParams(qs));

describe("parseRepoView", () => {
  it("une query string vide donne l'état par défaut", () => {
    expect(parse("")).toEqual(DEFAULT_REPO_VIEW);
  });

  it("lit un dépôt, un filtre, un tri et « les miens »", () => {
    expect(parse("repo=dimalaxyt/mon-projet&q=api&sort=name&mine=1")).toEqual({
      repo: "dimalaxyt/mon-projet",
      query: "api",
      sort: "name",
      onlyMine: true,
      ref: "",
      path: "",
      file: "",
    });
  });

  it("accepte les trois tris connus", () => {
    expect(parse("sort=pushed").sort).toBe("pushed");
    expect(parse("sort=name").sort).toBe("name");
    expect(parse("sort=size").sort).toBe("size");
  });

  it("un tri inconnu retombe sur le tri par défaut", () => {
    // Lien ancien ou paramètre tapé à la main : on affiche quelque chose de
    // cohérent plutôt qu'une liste non triée.
    expect(parse("sort=bidule").sort).toBe(DEFAULT_REPO_VIEW.sort);
    expect(parse("sort=").sort).toBe(DEFAULT_REPO_VIEW.sort);
    expect(parse("sort=PUSHEE").sort).toBe(DEFAULT_REPO_VIEW.sort);
  });

  it("refuse un nom de dépôt qui n'est pas owner/repo", () => {
    for (const bad of [
      "mon-projet", // pas de propriétaire
      "a/b/c", // trop de segments
      "../etc/passwd",
      "..%2f..%2fetc",
      "/mon-projet",
      "dimalaxyt/",
      "",
      "dimalaxyt/mon projet",
      "dimalaxyt/mon%2Fprojet",
    ]) {
      expect(parse(`repo=${encodeURIComponent(bad)}`).repo).toBe("");
    }
  });

  it("accepte les caractères autorisés par GitHub", () => {
    expect(parse("repo=dimalaxyt/mon-projet").repo).toBe("dimalaxyt/mon-projet");
    expect(parse("repo=autre-org/lecture.seule_2").repo).toBe("autre-org/lecture.seule_2");
  });

  it("seul « mine=1 » active le filtre propriétaire", () => {
    expect(parse("mine=1").onlyMine).toBe(true);
    expect(parse("mine=0").onlyMine).toBe(false);
    expect(parse("mine=").onlyMine).toBe(false);
    expect(parse("mine=true").onlyMine).toBe(false);
    expect(parse("").onlyMine).toBe(false);
  });

  it("un filtre vide reste vide", () => {
    expect(parse("q=").query).toBe("");
    expect(parse("q=api").query).toBe("api");
  });
});

describe("navigation profonde dans le dépôt", () => {
  it("lit branche, dossier et fichier depuis un lien partagé", () => {
    expect(
      parse("repo=dimalaxyt/mon-projet&ref=feature%2Fapi&path=src%2Fapp&file=src%2Fapp%2Fpage.tsx"),
    ).toMatchObject({
      repo: "dimalaxyt/mon-projet",
      ref: "feature/api",
      path: "src/app",
      file: "src/app/page.tsx",
    });
  });

  it("encode et restaure les espaces et caractères Unicode des chemins", () => {
    const view = {
      ...DEFAULT_REPO_VIEW,
      repo: "dimalaxyt/mon-projet",
      ref: "main",
      path: "docs/À propos",
      file: "docs/À propos/été #1.md",
    };
    const roundTrip = parseRepoView(
      new URLSearchParams(serializeRepoView(view).slice(1)),
    );
    expect(roundTrip).toEqual(view);
  });

  it("rejette les chemins de traversée, absolus et les antislashs", () => {
    for (const bad of ["../secret", "src/../../secret", "/etc/passwd", "src\\secret", "a//b", "a/./b"]) {
      expect(parse(`repo=alice/project&path=${encodeURIComponent(bad)}`).path).toBe("");
      expect(parse(`repo=alice/project&file=${encodeURIComponent(bad)}`).file).toBe("");
    }
  });

  it("rejette une référence de branche mal formée", () => {
    for (const bad of ["feature branch", "a//b", "a\\b", "main~1", "x".repeat(256)]) {
      expect(parse(`repo=alice/project&ref=${encodeURIComponent(bad)}`).ref).toBe("");
    }
  });

  it("un dépôt invalide efface également branche, chemin et fichier", () => {
    expect(parse("repo=../etc&ref=main&path=src&file=src%2Findex.ts")).toMatchObject({
      repo: "",
      ref: "",
      path: "",
      file: "",
    });
  });

  it("ne sérialise pas les sous-états sans dépôt sélectionné", () => {
    expect(
      serializeRepoView({ ...DEFAULT_REPO_VIEW, ref: "main", path: "src", file: "src/a.ts" }),
    ).toBe("");
  });
});

describe("serializeRepoView", () => {
  it("l'état par défaut produit une URL propre", () => {
    expect(serializeRepoView(DEFAULT_REPO_VIEW)).toBe("");
    expect(isDefaultRepoView(DEFAULT_REPO_VIEW)).toBe(true);
  });

  it("omet les valeurs par défaut", () => {
    // Pas de ?sort=pushed&q=&mine=0 : l'URL reste lisible et partageable.
    expect(serializeRepoView({ ...DEFAULT_REPO_VIEW, repo: "a/b" })).toBe(
      "?repo=a%2Fb",
    );
  });

  it("porte toutes les valeurs non par défaut", () => {
    const qs = serializeRepoView({
      repo: "dimalaxyt/mon-projet",
      query: "api",
      sort: "name",
      onlyMine: true,
      ref: "",
      path: "",
      file: "",
    });
    expect(qs).toContain("repo=dimalaxyt%2Fmon-projet");
    expect(qs).toContain("q=api");
    expect(qs).toContain("sort=name");
    expect(qs).toContain("mine=1");
  });
});

describe("aller-retour URL <-> état", () => {
  it("est stable pour un état complet", () => {
    const view = {
      repo: "dimalaxyt/mon-projet",
      query: "démo",
      sort: "size" as const,
      onlyMine: true,
      ref: "",
      path: "",
      file: "",
    };
    expect(parseRepoView(new URLSearchParams(serializeRepoView(view).slice(1)))).toEqual(view);
  });

  it("est stable pour l'état par défaut", () => {
    expect(parseRepoView(new URLSearchParams(serializeRepoView(DEFAULT_REPO_VIEW)))).toEqual(
      DEFAULT_REPO_VIEW,
    );
  });

  it("normalise une URL invalide en état sain", () => {
    // Deux passes : la sortie de la première doit être acceptée telle quelle.
    const dirty = parse("repo=../etc&sort=bidule&mine=peutetre");
    expect(dirty).toEqual(DEFAULT_REPO_VIEW);
    expect(parseRepoView(new URLSearchParams(serializeRepoView(dirty)))).toEqual(DEFAULT_REPO_VIEW);
  });

  it("un dépôt valide survit à l'aller-retour", () => {
    const once = parse("repo=dimalaxyt/mon-projet");
    const twice = parseRepoView(new URLSearchParams(serializeRepoView(once)));
    expect(twice.repo).toBe("dimalaxyt/mon-projet");
  });
});
