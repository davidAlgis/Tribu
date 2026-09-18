"""AMORÇAGE — remplit la liste des participants depuis un fichier GEDCOM.

    ┌───────────────┐      ┌────────────────┐      ┌──────────┐
    │ genealogie.ged│ ───> │ importer_ged.py│ ───> │ Supabase │
    │ (hors projet) │      │  (ce fichier)  │      │          │
    └───────────────┘      └────────────────┘      └──────────┘

À LANCER UNE SEULE FOIS.

Ensuite, **la base fait foi** : ajouts, retraits et corrections passent par
`admin.html`, pas par ce script. Le relancer écraserait toute la liste, et
avec elle les présences déjà saisies — il demande confirmation avant.

    python importer_ged.py --ged "D:/.../genealogie.ged" --racine "Prenom Nom"
    python importer_ged.py --ged "..." --racine "..." --apercu   # sans rien ecrire

Le `.ged` reste où il est : il n'est jamais copié dans le projet, jamais
versionné.

CE QUI EST DÉDUIT DU GEDCOM

  * les couples, lus dans les enregistrements FAM (HUSB / WIFE) ;
  * la filiation, lue dans les CHIL, d'où découlent les droits ;
  * la catégorie d'âge, calculée depuis BIRT DATE à la date du séjour ;
  * les personnes décédées, écartées d'office (DEAT).

`exclusions.txt` permet d'écarter d'emblée ceux qui ne viennent pas, pour
éviter d'importer cent personnes qu'il faudrait retirer une à une ensuite.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
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
                        # "Marie /Durand/". C'est ce qui separe prenom et nom.
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
class Participant:
    """Une ligne prete a partir vers private.participants."""

    id: str
    prenom: str
    famille: str
    categorie_age: str
    parent_id: str | None = None
    conjoint_id: str | None = None
    invite: bool = False
    generation: int = 0  # sert uniquement a l'apercu

    def vers_json(self) -> dict:
        return {
            "id": self.id,
            "prenom": self.prenom,
            "famille": self.famille,
            "categorie_age": self.categorie_age,
            "parent_id": self.parent_id,
            "conjoint_id": self.conjoint_id,
            "invite": self.invite,
        }


@dataclass
class Rapport:
    participants: list[Participant] = field(default_factory=list)
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
    """Traduit la descendance d'une personne en participants."""
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

    def descendre(pid: str, generation: int, parent: str | None) -> None:
        if pid in vus or pid not in arbre.individus:
            return
        vus.add(pid)

        foyer = [pid]
        for conjoint in arbre.conjoints_de(pid):
            if conjoint not in vus and conjoint in arbre.individus:
                vus.add(conjoint)
                foyer.append(conjoint)

        retenus = [p for p in foyer if not est_ecarte(p)][:2]
        nouveaux: list[Participant] = []

        for membre in retenus:
            individu = arbre.individus[membre]
            if individu.naissance is None:
                rapport.sans_date.append(individu.complet)
            nouveaux.append(
                Participant(
                    id=str(uuid.uuid4()),
                    prenom=individu.prenom,
                    famille="",  # pose plus bas, au niveau de la branche
                    categorie_age=categorie_age(individu, jour, seuil_bebe, seuil_enfant),
                    parent_id=parent,
                    generation=generation,
                )
            )

        if len(nouveaux) == 2:
            nouveaux[0].conjoint_id = nouveaux[1].id
            nouveaux[1].conjoint_id = nouveaux[0].id

        rapport.participants.extend(nouveaux)

        if nouveaux:
            # Les enfants se rattachent au premier membre du foyer : l'autre
            # les couvre via le lien de conjoint.
            parent_enfants = nouveaux[0].id
            generation_enfants = generation + 1
        else:
            # Personne ne reste dans ce foyer : les enfants remontent d'un
            # cran et se rattachent au grand-parent.
            parent_enfants = parent
            generation_enfants = generation

        enfants = sorted(set(arbre.enfants_de(pid)), key=arbre.naissance)
        for conjoint in foyer[1:]:
            for enfant in sorted(set(arbre.enfants_de(conjoint)), key=arbre.naissance):
                if enfant not in enfants:
                    enfants.append(enfant)

        for enfant in enfants:
            descendre(enfant, generation_enfants, parent_enfants)

    for branche in sorted(set(arbre.enfants_de(racine)), key=arbre.naissance):
        if branche in vus:
            continue
        depart = len(rapport.participants)
        descendre(branche, 0, None)
        # Le nom de famille du bloc, c'est le prenom du chef de branche :
        # c'est ainsi que l'export regroupe les totaux pour l'hotel.
        if len(rapport.participants) > depart:
            chef = rapport.participants[depart].prenom
            for participant in rapport.participants[depart:]:
                participant.famille = chef

    rapport.exclusions_inutiles = sorted(exclusions - exclusions_servies)
    return rapport


def portee(participants: list[Participant], depart: str) -> set[str]:
    """Qui `depart` peut modifier. Reproduit la regle SQL, pour verification.

    C'est le pendant Python de `private.personnes_modifiables` : si les deux
    divergent un jour, les tests s'en apercoivent.
    """
    enfants: dict[str, list[str]] = defaultdict(list)
    conjoints: dict[str, list[str]] = defaultdict(list)
    for p in participants:
        if p.parent_id:
            enfants[p.parent_id].append(p.id)
        if p.conjoint_id:
            conjoints[p.id].append(p.conjoint_id)
            conjoints[p.conjoint_id].append(p.id)

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


def lire_exclusions(chemin: Path) -> set[str]:
    if not chemin.exists():
        return set()
    exclusions = set()
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        ligne = ligne.split("#")[0].strip()
        if ligne:
            exclusions.add(normaliser(ligne))
    return exclusions


def apercu(rapport: Rapport) -> str:
    """L'arbre tel qu'il partira en base, pour relecture avant envoi."""
    lignes = []
    famille_courante = None
    deja: set[str] = set()

    for participant in rapport.participants:
        if participant.id in deja:
            continue
        if participant.famille != famille_courante:
            famille_courante = participant.famille
            # Sans le mot « Branche », l'entete et la premiere ligne portent
            # le meme prenom et se lisent comme un doublon.
            lignes.append(f"\n  ── Branche {famille_courante} " + "─" * 16)

        noms = [participant]
        conjoint = next(
            (p for p in rapport.participants if p.id == participant.conjoint_id), None
        )
        if conjoint:
            noms.append(conjoint)
        deja.update(p.id for p in noms)

        texte = " + ".join(
            p.prenom + ("" if p.categorie_age == "adulte" else f" ({p.categorie_age})")
            for p in noms
        )
        lignes.append("    " + "    " * participant.generation + texte)

    return "\n".join(lignes)


def envoyer(url: str, cle: str, code_admin: str, participants: list[Participant]) -> dict:
    """Remplace toute la liste par POST sur la fonction admin_importer."""
    entetes = {"Content-Type": "application/json", "apikey": cle}
    if cle.startswith("eyJ"):
        entetes["Authorization"] = f"Bearer {cle}"

    corps = json.dumps(
        {"p_code": code_admin, "p_participants": [p.vers_json() for p in participants]}
    ).encode("utf-8")

    requete = urllib.request.Request(
        f"{url}/rest/v1/rpc/admin_importer", data=corps, headers=entetes, method="POST"
    )
    try:
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            return json.loads(reponse.read().decode("utf-8"))
    except urllib.error.HTTPError as erreur:
        detail = erreur.read().decode("utf-8", errors="replace")
        if "CODE_REFUSE" in detail:
            raise SystemExit("Code organisateur refuse.") from None
        raise SystemExit(f"Supabase a refuse l'import : {detail}") from None


def config_js(chemin: Path) -> tuple[str, str]:
    """Relit l'URL et la cle publishable la ou elles sont deja : config.js."""
    texte = chemin.read_text(encoding="utf-8")
    url = re.search(r'SUPABASE_URL:\s*"([^"]+)"', texte)
    cle = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', texte)
    if not url or not cle:
        raise SystemExit(f"{chemin} ne contient pas SUPABASE_URL / SUPABASE_ANON_KEY.")
    return url.group(1), cle.group(1)


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--ged", required=True, help="chemin du GEDCOM (hors projet)")
    # Pas de valeur par defaut : le nom de l'ancetre est une donnee
    # personnelle, elle n'a rien a faire dans un depot public.
    parseur.add_argument("--racine", required=True, help="l'ancetre dont on prend la descendance")
    parseur.add_argument("--exclusions", default="exclusions.txt")
    parseur.add_argument("--config", default="config.js")
    parseur.add_argument("--date-sejour", default="2027-07-10", help="pour calculer les ages")
    parseur.add_argument("--age-bebe", type=int, default=3, help="moins de N ans = bebe")
    parseur.add_argument("--age-enfant", type=int, default=12, help="moins de N ans = enfant")
    parseur.add_argument(
        "--apercu",
        action="store_true",
        help="afficher ce qui serait envoye, sans rien ecrire en base",
    )
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

    jour = date.fromisoformat(args.date_sejour)
    rapport = construire(
        arbre,
        trouves[0],
        lire_exclusions(Path(args.exclusions)),
        jour,
        args.age_bebe,
        args.age_enfant,
    )
    if not rapport.participants:
        print(f"Aucun descendant retenu pour {individus[trouves[0]].complet}.", file=sys.stderr)
        return 1

    print(apercu(rapport))
    print(f"\n{len(rapport.participants)} participants, ages calcules au {jour}.")
    if rapport.decedes:
        print(f"  {len(rapport.decedes)} decede(s) ecarte(s) : {', '.join(rapport.decedes)}")
    if rapport.exclus:
        print(
            f"  {len(rapport.exclus)} ecartee(s) par {args.exclusions} : "
            f"{', '.join(rapport.exclus)}"
        )
    if rapport.sans_date:
        print(
            f"  ATTENTION  {len(rapport.sans_date)} sans date de naissance, comptes adultes : "
            f"{', '.join(rapport.sans_date)}"
        )
    for inutile in rapport.exclusions_inutiles:
        print(
            f"  ATTENTION  « {inutile} » dans {args.exclusions} "
            f"ne correspond a personne (faute de frappe ?)"
        )

    if args.apercu:
        print("\nApercu seul : rien n'a ete envoye.")
        return 0

    print(
        "\nCet import REMPLACE toute la liste en base, et avec elle les"
        "\npresences deja saisies. Il n'est cense servir qu'une fois."
    )
    if input("Taper « oui » pour continuer : ").strip().lower() != "oui":
        print("Abandonne.")
        return 1

    url, cle = config_js(Path(args.config))
    # Le code ne passe ni par la ligne de commande ni par un fichier : il ne
    # se retrouve donc ni dans l'historique du shell, ni sur le disque.
    code_admin = os.environ.get("TRIBU_CODE_ADMIN") or getpass.getpass(
        "Code organisateur (invisible) : "
    )

    resultat = envoyer(url, cle, code_admin, rapport.participants)
    print(f"\n{resultat.get('importes', 0)} participants ecrits dans Supabase.")
    print("La base fait desormais foi : la suite se passe sur admin.html.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
