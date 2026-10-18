# Fixtures .rar

Archives de test récupérées depuis le sdist PyPI du projet
[`rarfile`](https://pypi.org/project/rarfile/) (`test/files/`), qui fournit
une belle couverture : RAR4/RAR5, sous-dossiers, noms Unicode, mot de passe,
symlinks, volumes.

Utilisées par `tests/extract-rar.test.ts` pour vérifier le worker d'extraction
(`scripts/rar-extract.mjs`).
