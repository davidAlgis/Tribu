"""Transforme un fichier GEDCOM de généalogie en liste de participants.

    ┌──────────────┐     ┌───────────────┐     ┌─────────────┐     ┌────────┐
    │ *.ged        │ ──> │importer_ged.py│ ──> │ famille.txt │ ──> │ .sql   │
    │ (hors projet)│     │  (ce fichier) │     │  (éditable) │     │Supabase│
    └──────────────┘     └───────────────┘     └─────────────┘     └────────┘
                                 ▲                            generer_participants.py
                                 │
                         ┌───────────────┐
                         │exclusions.txt │  <- qui ne vient pas
                         └───────────────┘

USAGE COURANT

    python importer_ged.py --ged "D:/.../genealogie.ged" --racine "Prenom Nom" --generer

Le `.ged` reste où il est : il n'est jamais copié dans le projet, jamais
versionné. Seul `famille.txt` est produit ici, et il est lui-même ignoré
par git.

POUR RETIRER QUELQU'UN

Ajoute son prénom (ou « Prénom Nom ») dans `exclusions.txt`, une ligne par
personne, et relance. Les exclusions survivent à chaque réimport, alors
qu'une ligne effacée à la main dans `famille.txt` serait écrasée.

Retirer une personne ne coupe pas la branche : ses enfants remontent d'un
cran et se rattachent à leur grand-parent, sauf si son conjoint reste, ce
qui les garde sous lui.

CE QUI EST DÉDUIT DU GEDCOM

  * les couples, lus dans les enregistrements FAM (HUSB / WIFE) ;
  * la filiation, lue dans les CHIL ;
  * la catégorie d'âge, calculée depuis BIRT DATE à la date du séjour ;
  * les personnes décédées, écartées d'office (DEAT).
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

MOIS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


@dataclass
class Individu:
    id: str
    prenom: str
    nom: str
    naissance: date | None = None
    decede: bool = False

    @property
    def complet(self) -> str:
        return f"{self.prenom} {self.nom}".strip()


@dataclass
class Famille:
    epoux: str = ""
    epouse: str = ""
    enfants: list[str] = field(default_factory=list)


def normaliser(texte: str) -> str:
    """Minuscules, sans accent, espaces tasses : pour comparer des noms."""
    decompose = unicodedata.normalize("NFD", texte)
    sans_accent = "".join(c for c in decompose if unicodedata.category(c) != "Mn")
    return " ".join(sans_accent.lower().split())


def _lire_date(valeur: str) -> date | None:
    """Une date GEDCOM ressemble a `12 MAR 1978`, parfois `ABT 1978`."""
    if not valeur:
        return None
    annee = re.search(r"\b(\d{4})\b", valeur)
    if not annee:
        return None

    mois = 1
    for indice, code in enumerate(MOIS, start=1):
        if code in valeur.upper():
            mois = indice
            break

    jour = 1
    jours = [int(n) for n in re.findall(r"\b(\d{1,2})\b", valeur)]
    if jours:
        jour = min(max(jours[0], 1), 28)  # on ne cherche pas la precision au jour

    return date(int(annee.group(1)), mois, jour)


def lire_gedcom(chemin: Path) -> tuple[dict[str, Individu], dict[str, Famille]]:
    individus: dict[str, Individu] = {}
    familles: dict[str, Famille] = {}
    courant = courant_type = sous_tag = None

    with open(chemin, "r", encoding="utf-8-sig", errors="replace") as fichier:
        for ligne_brute in fichier:
            ligne = ligne_brute.strip()
            if not ligne:
                continue
            morceaux = ligne.split(" ", 2)
            if not morceaux[0].isdigit():
                continue
            niveau = int(morceaux[0])
            tag = morceaux[1] if len(morceaux) > 1 else ""
            valeur = morceaux[2] if len(morceaux) > 2 else ""

            if niveau == 0:
                sous_tag = None
                if valeur in ("INDI", "FAM") and tag.startswith("@"):
                    courant, courant_type = tag, valeur
                    if valeur == "INDI":
                        individus[tag] = Individu(id=tag, prenom="", nom="")
                    else:
                        familles[tag] = Famille()
                else:
                    courant = courant_type = None
                continue

            if not courant:
                continue

            if niveau == 1:
                sous_tag = tag
                if courant_type == "INDI":
                    if tag == "NAME":
                        # Le GEDCOM entoure le nom de famille de barres obliques :
                        # "Marie-Claire /Durand/". C'est ce qui separe prenom et nom.
                        trouve = re.match(r"^(.*?)\s*/(.*?)/", valeur)
                        if trouve:
                            individus[courant].prenom = trouve.group(1).strip()
                            individus[courant].nom = trouve.group(2).strip()
                        else:
                            individus[courant].prenom = valeur.strip()
                    elif tag == "DEAT":
                        individus[courant].decede = True
                elif courant_type == "FAM":
                    if tag == "HUSB":
                        familles[courant].epoux = valeur
                    elif tag == "WIFE":
                        familles[courant].epouse = valeur
                    elif tag == "CHIL":
                        familles[courant].enfants.append(valeur)

            elif niveau == 2 and tag == "DATE" and sous_tag == "BIRT":
                if courant_type == "INDI":
                    individus[courant].naissance = _lire_date(valeur)

    return individus, familles


class Arbre:
    def __init__(self, individus: dict[str, Individu], familles: dict[str, Famille]):
        self.individus = individus
        self.familles = familles

    def enfants_de(self, pid: str) -> list[str]:
        enfants = []
        for famille in self.familles.values():
            if pid in (famille.epoux, famille.epouse):
                enfants.extend(famille.enfants)
        return enfants

    def conjoints_de(self, pid: str) -> list[str]:
        conjoints = []
        for famille in self.familles.values():
            if famille.epoux == pid and famille.epouse:
                conjoints.append(famille.epouse)
            elif famille.epouse == pid and famille.epoux:
                conjoints.append(famille.epoux)
        return conjoints

    def chercher(self, requete: str) -> list[str]:
        """Tous ceux dont le nom contient chaque mot de la requete."""
        mots = normaliser(requete).split()
        return [
            pid
            for pid, individu in self.individus.items()
            if all(mot in normaliser(individu.complet) for mot in mots)
        ]

    def naissance(self, pid: str) -> tuple:
        date_naissance = self.individus[pid].naissance
        return (date_naissance.toordinal(),) if date_naissance else (10**7,)


def categorie_age(individu: Individu, jour: date, seuil_bebe: int, seuil_enfant: int) -> str:
    if individu.naissance is None:
        return "adulte"  # sans date, on ne devine pas : l'humain corrigera
    ans = jour.year - individu.naissance.year
    if (jour.month, jour.day) < (individu.naissance.month, individu.naissance.day):
        ans -= 1
    if ans < seuil_bebe:
        return "bebe"
    if ans < seuil_enfant:
        return "enfant"
    return "adulte"


@dataclass
class Rapport:
    lignes: list[str] = field(default_factory=list)
    retenus: int = 0
    exclus: list[str] = field(default_factory=list)
    decedes: list[str] = field(default_factory=list)
    sans_date: list[str] = field(default_factory=list)
    exclusions_inutiles: list[str] = field(default_factory=list)


def construire(
    arbre: Arbre,
    racine: str,
    exclusions: set[str],
    jour: date,
    seuil_bebe: int,
    seuil_enfant: int,
) -> Rapport:
    rapport = Rapport()
    vus: set[str] = set()
    exclusions_servies: set[str] = set()

    def est_ecarte(pid: str) -> bool:
        individu = arbre.individus[pid]
        if individu.decede:
            rapport.decedes.append(individu.complet)
            return True
        for cle in (normaliser(individu.complet), normaliser(individu.prenom)):
            if cle in exclusions:
                exclusions_servies.add(cle)
                rapport.exclus.append(individu.complet)
                return True
        return False

    def descendre(pid: str, generation: int) -> None:
        if pid in vus or pid not in arbre.individus:
            return
        vus.add(pid)

        foyer = [pid]
        for conjoint in arbre.conjoints_de(pid):
            if conjoint not in vus and conjoint in arbre.individus:
                vus.add(conjoint)
                foyer.append(conjoint)

        retenus = [p for p in foyer if not est_ecarte(p)]

        if retenus:
            noms = []
            for membre in retenus[:2]:
                individu = arbre.individus[membre]
                age = categorie_age(individu, jour, seuil_bebe, seuil_enfant)
                if individu.naissance is None:
                    rapport.sans_date.append(individu.complet)
                noms.append(individu.prenom + ("" if age == "adulte" else f" ({age})"))

            rapport.lignes.append("─" * (2 * generation) + (" " if generation else "") + " + ".join(noms))
            rapport.retenus += len(retenus[:2])
            generation_enfants = generation + 1
        else:
            # Personne ne reste dans ce foyer : les enfants remontent d'un cran
            # et se rattacheront a leur grand-parent.
            generation_enfants = generation

        enfants = sorted(set(arbre.enfants_de(pid)), key=arbre.naissance)
        for conjoint in foyer[1:]:
            for enfant in sorted(set(arbre.enfants_de(conjoint)), key=arbre.naissance):
                if enfant not in enfants:
                    enfants.append(enfant)

        for enfant in enfants:
            descendre(enfant, generation_enfants)

    for branche in sorted(set(arbre.enfants_de(racine)), key=arbre.naissance):
        if branche in vus:
            continue
        depart = len(rapport.lignes)
        descendre(branche, 0)
        if len(rapport.lignes) > depart:
            # Le nom de famille du bloc : le prenom du chef de branche. C'est
            # ce qui regroupe les totaux dans l'export destine a l'hotel.
            chef = rapport.lignes[depart].split(" + ")[0].strip()
            chef = re.sub(r"\s*\(.*\)$", "", chef)
            rapport.lignes.insert(depart, f"\n## {chef}\n")

    rapport.exclusions_inutiles = sorted(exclusions - exclusions_servies)
    return rapport


def lire_exclusions(chemin: Path) -> set[str]:
    if not chemin.exists():
        return set()
    exclusions = set()
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        ligne = ligne.split("#")[0].strip()
        if ligne:
            exclusions.add(normaliser(ligne))
    return exclusions


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--ged", required=True, help="chemin du fichier GEDCOM (hors projet)")
    # Pas de valeur par defaut : le nom de l'ancetre est une donnee
    # personnelle, elle n'a rien a faire dans un depot public.
    parseur.add_argument(
        "--racine", required=True, help="l'ancetre dont on prend les descendants"
    )
    parseur.add_argument("--exclusions", default="exclusions.txt")
    parseur.add_argument("--sortie", default="famille.txt")
    parseur.add_argument("--date-sejour", default="2027-07-10", help="pour calculer les ages")
    parseur.add_argument("--age-bebe", type=int, default=3, help="moins de N ans = bebe")
    parseur.add_argument("--age-enfant", type=int, default=12, help="moins de N ans = enfant")
    parseur.add_argument("--generer", action="store_true", help="enchaine sur generer_participants.py")
    args = parseur.parse_args()

    source = Path(args.ged)
    if not source.exists():
        print(f"GEDCOM introuvable : {source}", file=sys.stderr)
        return 1

    individus, familles = lire_gedcom(source)
    arbre = Arbre(individus, familles)
    print(f"{len(individus)} individus et {len(familles)} familles lus dans {source.name}")

    trouves = arbre.chercher(args.racine)
    if not trouves:
        print(f"Aucun individu ne correspond a « {args.racine} ».", file=sys.stderr)
        return 1
    if len(trouves) > 1:
        print(f"« {args.racine} » est ambigu :", file=sys.stderr)
        for pid in trouves:
            print(f"    {individus[pid].complet}", file=sys.stderr)
        return 1

    racine = trouves[0]
    jour = date.fromisoformat(args.date_sejour)
    exclusions = lire_exclusions(Path(args.exclusions))

    rapport = construire(arbre, racine, exclusions, jour, args.age_bebe, args.age_enfant)
    if not rapport.retenus:
        print(f"Aucun descendant retenu pour {individus[racine].complet}.", file=sys.stderr)
        return 1

    sortie = Path(args.sortie)
    if sortie.exists():
        # Le fichier est regenere a chaque import : on garde le precedent
        # sous la main, au cas ou il contenait des retouches manuelles.
        shutil.copy2(sortie, sortie.with_suffix(sortie.suffix + ".bak"))
        print(f"Ancienne version conservee dans {sortie}.bak")

    entete = [
        "# ============================================================",
        f"#  FICHIER GENERE par importer_ged.py depuis {source.name}",
        "# ============================================================",
        "#",
        f"#  Descendants de {individus[racine].complet}, ages calcules au {jour}.",
        "#",
        "#  Pour retirer quelqu'un : ajoute son prenom dans "
        f"{args.exclusions}, pas ici —",
        "#  ce fichier est ecrase a chaque import.",
        "#",
        "#  Les couples et la filiation viennent du GEDCOM : ils ne sont pas devines.",
        "# ============================================================",
    ]
    sortie.write_text("\n".join(entete + rapport.lignes) + "\n", encoding="utf-8")

    print(f"{rapport.retenus} participants retenus -> {sortie}")
    if rapport.decedes:
        print(f"  {len(rapport.decedes)} personne(s) decedee(s) ecartee(s) : {', '.join(rapport.decedes)}")
    if rapport.exclus:
        print(f"  {len(rapport.exclus)} exclusion(s) appliquee(s) : {', '.join(rapport.exclus)}")
    if rapport.sans_date:
        print(
            f"  ATTENTION  {len(rapport.sans_date)} sans date de naissance, comptes adultes : "
            f"{', '.join(rapport.sans_date)}"
        )
    for inutile in rapport.exclusions_inutiles:
        print(f"  ATTENTION  « {inutile} » dans {args.exclusions} ne correspond a personne (faute de frappe ?)")

    if args.generer:
        print()
        # Sans ce vidage, le sous-processus ecrit avant nous : le rapport
        # d'import apparaitrait apres celui de la generation.
        sys.stdout.flush()
        sys.stderr.flush()
        return subprocess.call([sys.executable, "generer_participants.py", "--droits"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
