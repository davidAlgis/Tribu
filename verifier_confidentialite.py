"""Cherche des noms de la vraie famille dans ce que git s'apprête à publier.

    python verifier_confidentialite.py --ged "D:/.../genealogie.ged"

À lancer AVANT chaque `git push`. Le dépôt est public : un prénom poussé
par erreur reste dans l'historique même après suppression du fichier.

Le script lit les prénoms du GEDCOM — la seule liste complète, et elle
reste hors du projet — et les cherche dans tout ce que git publie.


DEUX NIVEAUX DE SIGNALEMENT

  FUITE       un nom de la famille absent des fichiers d'exemple. C'est
              une vraie fuite : à corriger avant de pousser.

  coïncidence un prénom courant déclaré dans `prenoms_inventes.txt`.
              Il vient d'un exemple ou d'un test, et n'identifie
              personne — le même prénom se lit dans n'importe quel
              tutoriel. Affiché pour que tu juges, pas pour t'alarmer.

Le script sort en erreur uniquement s'il trouve une vraie fuite, ce qui
permet de l'enchaîner : `python verifier_confidentialite.py && git push`
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

from importer_ged import lire_gedcom

INVENTES = Path("prenoms_inventes.txt")


def noms_declares(chemin: Path) -> set[str]:
    """Les prenoms volontairement fictifs, un par mot."""
    if not chemin.exists():
        return set()
    noms: set[str] = set()
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        for mot in ligne.split("#")[0].split():
            if len(mot) > 2:
                noms.add(mot)
    return noms


def noms_du_gedcom(chemin: Path) -> set[str]:
    """Tous les prenoms et patronymes du fichier genealogique."""
    individus, _ = lire_gedcom(chemin)
    noms: set[str] = set()
    for individu in individus.values():
        for mot in (individu.prenom + " " + individu.nom).replace("-", " ").split():
            if len(mot) > 2:
                noms.add(mot)
    return noms


def fichiers_suivis() -> list[Path]:
    sortie = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout
    return [Path(c) for c in sortie.split("\n") if c.strip()]


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--ged", required=True, help="le GEDCOM de la famille")
    args = parseur.parse_args()

    source = Path(args.ged)
    if not source.exists():
        print(f"GEDCOM introuvable : {source}", file=sys.stderr)
        return 1

    reels = noms_du_gedcom(source)
    inventes = {n.lower() for n in noms_declares(INVENTES)}
    if not reels:
        print(f"{source} ne contient aucun nom.")
        return 0

    fuites: list[tuple[str, str]] = []
    coincidences: set[str] = set()

    for chemin in fichiers_suivis():
        try:
            contenu = chemin.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            continue
        for nom in reels:
            if not re.search(r"\b" + re.escape(nom.lower()) + r"\b", contenu):
                continue
            # Un prenom declare comme invente est un homonyme, pas une
            # fuite : il n'apprend rien sur personne.
            if nom.lower() in inventes:
                coincidences.add(nom)
            else:
                fuites.append((str(chemin), nom))

    print(f"{len(reels)} noms de {source.name} cherches dans les fichiers suivis par git.\n")

    if coincidences:
        print(f"  {len(coincidences)} coincidence(s) avec {INVENTES}, sans gravite :")
        print(f"    {', '.join(sorted(coincidences))}\n")

    if fuites:
        print(f"  {len(set(fuites))} FUITE(S) :")
        for chemin, nom in sorted(set(fuites)):
            print(f"    « {nom} »  dans  {chemin}")
        print("\nRetire ces noms AVANT de pousser. Une fois publies, ils")
        print("restent dans l'historique meme si le fichier est corrige.")
        return 1

    print("  Aucune fuite. Tu peux pousser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
