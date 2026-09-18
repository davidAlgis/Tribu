"""Transforme la liste de la famille en SQL prêt à coller dans Supabase.

    ┌──────────────────┐      ┌────────────────────────┐      ┌──────────────┐
    │   famille.txt    │ ───> │ generer_participants.py│ ───> │participants. │
    │ (tu édites ceci) │      │      (ce fichier)      │      │     sql      │
    └──────────────────┘      └────────────────────────┘      └──────────────┘

POUR AJOUTER QUELQU'UN : ouvre `famille.txt`, ajoute une ligne, relance

    python generer_participants.py

puis colle le `participants.sql` produit dans le SQL Editor de Supabase.
Tu n'écris jamais de SQL à la main.

`famille.txt` n'est PAS versionné (cf. .gitignore) : le dépôt est public,
les prénoms de la famille n'ont rien à y faire. Seul `famille.exemple.txt`,
avec des prénoms inventés, est public.

Format de `famille.txt`
-----------------------

    ## Famille Durand              <- optionnel : nom de famille du bloc
    Marie-Odille                   <- génération 0
    ── Sylvain + Nathalie          <- génération 1, un couple
    ──── Matthieu (enfant)         <- génération 2, leur fils
    ──── Noémie (enfant)
    ── Rémi                        <- génération 1, seul
    # une ligne commençant par # est un commentaire

  * l'indentation (deux tirets par génération) donne la filiation ;
  * `+` réunit un couple sur une ligne ;
  * `(enfant)` ou `(bebe)` en fin de ligne ; sans rien, c'est `(adulte)` ;
  * `## Nom` fixe le nom de famille jusqu'au prochain `##`. Sans lui, le
    nom de famille est le prénom de l'ancêtre de génération 0.

Ces deux informations suffisent à dériver les droits : chacun couvre son
conjoint, ses descendants, et les conjoints de ses descendants.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

TIRETS = "─-—–"
AGES = ("adulte", "enfant", "bebe")


@dataclass
class Personne:
    id: str
    prenom: str
    famille: str
    categorie_age: str
    parent: str | None = None
    conjoint: str | None = None


@dataclass
class Lecture:
    personnes: list[Personne] = field(default_factory=list)
    avertissements: list[str] = field(default_factory=list)
    erreurs: list[str] = field(default_factory=list)


def _sans_accent(texte: str) -> str:
    decompose = unicodedata.normalize("NFD", texte)
    return "".join(c for c in decompose if unicodedata.category(c) != "Mn")


def _decouper(ligne: str) -> tuple[int, str, int]:
    """Renvoie (generation, reste de la ligne, nombre de tirets lus)."""
    texte = ligne.strip()
    n = 0
    while n < len(texte) and texte[n] in TIRETS:
        n += 1
    return n // 2, texte[n:].strip(), n


def _lire_age(nom: str) -> tuple[str, str | None]:
    """Extrait `(enfant)` en fin de prenom. Renvoie (prenom, age ou None)."""
    trouve = re.search(r"\(([^)]*)\)\s*$", nom)
    if not trouve:
        return nom.strip(), None

    age = _sans_accent(trouve.group(1).strip().lower())
    return nom[: trouve.start()].strip(), age


def analyser(texte: str) -> Lecture:
    """Lit le fichier famille et en tire la liste des personnes."""
    lecture = Lecture()
    famille_courante: str | None = None
    dernier_par_generation: dict[int, Personne] = {}

    for numero, ligne_brute in enumerate(texte.splitlines(), start=1):
        ligne = ligne_brute.rstrip()
        if not ligne.strip():
            continue

        if ligne.strip().startswith("##"):
            famille_courante = ligne.strip().lstrip("#").strip() or None
            continue
        if ligne.strip().startswith("#"):
            continue

        generation, reste, tirets = _decouper(ligne)
        if not reste:
            lecture.erreurs.append(f"ligne {numero} : des tirets sans prenom")
            continue
        if tirets % 2:
            lecture.avertissements.append(
                f"ligne {numero} : {tirets} tiret(s), un nombre impair — "
                f"j'ai compris generation {generation}"
            )

        # Le parent est la premiere personne de la generation precedente.
        parent = None
        if generation > 0:
            parent = dernier_par_generation.get(generation - 1)
            if parent is None:
                # Saut de generation : on rattache a l'ancetre le plus proche
                # plutot que d'inventer une personne intermediaire.
                for niveau in range(generation - 2, -1, -1):
                    if niveau in dernier_par_generation:
                        parent = dernier_par_generation[niveau]
                        lecture.avertissements.append(
                            f"ligne {numero} ({reste}) : saut de generation — "
                            f"rattache a {parent.prenom}. Verifie si c'est voulu."
                        )
                        break
                else:
                    lecture.erreurs.append(
                        f"ligne {numero} ({reste}) : indentee mais sans aucun ancetre"
                    )
                    continue

        membres: list[Personne] = []
        for brut in reste.split("+"):
            prenom, age = _lire_age(brut)
            if not prenom:
                lecture.erreurs.append(f"ligne {numero} : prenom vide autour du '+'")
                continue
            if age is not None and age not in AGES:
                lecture.erreurs.append(
                    f"ligne {numero} ({prenom}) : categorie '{age}' inconnue "
                    f"(attendu : {', '.join(AGES)})"
                )
                continue

            membres.append(
                Personne(
                    id=str(uuid.uuid4()),
                    prenom=prenom,
                    famille=famille_courante or "",
                    categorie_age=age or "adulte",
                    parent=parent.id if parent else None,
                )
            )

        if not membres:
            continue
        if len(membres) > 2:
            lecture.avertissements.append(
                f"ligne {numero} : plus de deux personnes reliees par '+' — "
                f"seules les deux premieres forment un couple"
            )

        if len(membres) >= 2:
            membres[0].conjoint = membres[1].id
            membres[1].conjoint = membres[0].id

        # Sans `## Nom`, le nom de famille est le prenom de la racine.
        if not famille_courante:
            racine = dernier_par_generation.get(0) if generation else membres[0]
            for membre in membres:
                membre.famille = racine.prenom if racine else membres[0].prenom

        lecture.personnes.extend(membres)

        # Les enfants se rattachent au premier membre du couple : l'autre
        # les couvre via le lien de conjoint.
        dernier_par_generation[generation] = membres[0]
        for plus_profond in [g for g in dernier_par_generation if g > generation]:
            del dernier_par_generation[plus_profond]

    return lecture


def portee(personnes: list[Personne], depart: str) -> set[str]:
    """Qui `depart` peut modifier. Reproduit la regle SQL, pour verification."""
    enfants: dict[str, list[str]] = defaultdict(list)
    conjoints: dict[str, list[str]] = defaultdict(list)
    for p in personnes:
        if p.parent:
            enfants[p.parent].append(p.id)
        if p.conjoint:
            conjoints[p.id].append(p.conjoint)
            conjoints[p.conjoint].append(p.id)

    vus: set[str] = set()
    pile = [depart]
    while pile:
        courant = pile.pop()
        if courant in vus:
            continue
        vus.add(courant)
        pile.extend(enfants[courant])
        pile.extend(conjoints[courant])
    return vus


def _txt(valeur: str | None) -> str:
    if valeur is None:
        return "null"
    return "'" + valeur.replace("'", "''") + "'"


def vers_sql(personnes: list[Personne], source: str) -> str:
    lignes = [
        "-- ============================================================",
        "--  Participants - FICHIER GENERE, NE PAS EDITER A LA MAIN",
        "-- ============================================================",
        "--",
        f"--  Produit par generer_participants.py a partir de {source}.",
        "--  Pour changer la liste : edite ce fichier .txt et relance",
        "--",
        "--      python generer_participants.py",
        "--",
        "--  Les identifiants sont poses ici plutot que tires par Postgres :",
        "--  cela permet de lier parents et conjoints en un seul insert, sans",
        "--  dependre de l'unicite des prenoms.",
        "-- ============================================================",
        "",
        "delete from private.participants;",
        "",
        "insert into private.participants",
        "  (id, prenom, famille, categorie_age, parent_id, conjoint_id)",
        "values",
    ]

    corps = []
    for p in personnes:
        corps.append(
            f"  ({_txt(p.id)}, {_txt(p.prenom)}, {_txt(p.famille)}, "
            f"{_txt(p.categorie_age)}, {_txt(p.parent)}, {_txt(p.conjoint)})"
        )
    lignes.append(",\n".join(corps) + ";")

    lignes += [
        "",
        "-- Verification : qui peut modifier qui.",
        "-- A lire une fois avant d'ouvrir la saisie a la famille.",
        "select",
        '  acteur.prenom as "peut modifier",',
        "  count(*) as \"nb\",",
        "  string_agg(cible.prenom, ', ' order by cible.prenom) as \"ces personnes\"",
        "from private.participants acteur",
        "cross join lateral private.personnes_modifiables(acteur.id) m",
        "join private.participants cible on cible.id = m.id",
        "group by acteur.prenom",
        "order by acteur.prenom;",
        "",
    ]
    return "\n".join(lignes)


def apercu_droits(personnes: list[Personne]) -> str:
    par_id = {p.id: p for p in personnes}
    largeur = max((len(p.prenom) for p in personnes), default=10)
    lignes = []
    for p in personnes:
        couverts = sorted(par_id[i].prenom for i in portee(personnes, p.id))
        lignes.append(f"  {p.prenom:<{largeur}} ({len(couverts):>2}) : {', '.join(couverts)}")
    return "\n".join(lignes)


def main() -> int:
    # La console Windows est en cp1252 par defaut : sans cela, les prenoms
    # accentues sortent en charabia.
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--source", default="famille.txt")
    parseur.add_argument("--sortie", default="participants.sql")
    parseur.add_argument(
        "--exemple",
        action="store_true",
        help="regenere l'exemple public a partir de famille.exemple.txt",
    )
    parseur.add_argument("--droits", action="store_true", help="affiche qui peut modifier qui")
    args = parseur.parse_args()

    source = Path("famille.exemple.txt" if args.exemple else args.source)
    sortie = Path("supabase/participants.exemple.sql" if args.exemple else args.sortie)

    if not source.exists():
        print(f"{source} est introuvable.", file=sys.stderr)
        if not args.exemple:
            print("Copie famille.exemple.txt en famille.txt et remplis-le.", file=sys.stderr)
        return 1

    lecture = analyser(source.read_text(encoding="utf-8"))

    for avertissement in lecture.avertissements:
        print(f"  ATTENTION  {avertissement}", file=sys.stderr)
    for erreur in lecture.erreurs:
        print(f"  ERREUR     {erreur}", file=sys.stderr)
    if lecture.erreurs:
        print("\nRien n'a ete ecrit : corrige le fichier et relance.", file=sys.stderr)
        return 1
    if not lecture.personnes:
        print(f"{source} ne contient aucun participant.", file=sys.stderr)
        return 1

    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_text(vers_sql(lecture.personnes, source.name), encoding="utf-8")

    if args.droits:
        print("\nQui peut modifier qui :")
        print(apercu_droits(lecture.personnes))

    couples = sum(1 for p in lecture.personnes if p.conjoint) // 2
    print(f"\n{len(lecture.personnes)} participants, {couples} couple(s) -> {sortie}")
    print("Colle ce fichier dans Supabase > SQL Editor.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
