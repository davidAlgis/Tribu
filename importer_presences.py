"""Verse dans la base les présences déjà tenues dans un tableur.

    python importer_presences.py --csv "D:/chemin/vers/presences.csv" --debut 2026-10-24 --apercu
    python importer_presences.py --csv "D:/chemin/vers/presences.csv" --debut 2026-10-24

Le séjour a d'abord vécu dans un tableur. Le ressaisir à la main sur
`index.html`, soixante personnes et cinq jours durant, serait long et
fautif. Ce script le verse d'un coup.

⚠️ LE CSV RESTE OÙ IL EST. Comme le GEDCOM, il porte les vrais prénoms de
la famille et n'a rien à faire dans le dépôt, qui est public. Le script le
lit à son emplacement et n'en copie rien.

CE QUE LE FICHIER DOIT CONTENIR

Deux lignes d'en-tête, puis une ligne par personne :

    <bloc>,<nom>,J1 déj,J1 dîn,J1 nuit,J2 déj,…,J5 déj,<id hébergement>,…

soit treize colonnes de présence — quatre jours de trois cases, puis le
déjeuner du dernier jour — et un identifiant d'hébergement. Une case
remplie vaut oui, une case vide vaut non. Ce qui suit l'identifiant est
ignoré : les colonnes calculées du tableur ne sont pas des faits.

L'IDENTIFIANT D'HÉBERGEMENT

`chambre_…` devient une chambre, `chambre_vue_mer_…` une chambre avec le
supplément, `gîte_…` un gîte, `Exterieur` une présence sans nuit. Le NUMÉRO
se perd : la base retient trois catégories, pas quinze logements. Qui dort
dans quel gîte reste dans le tableur.

LE PETIT-DÉJEUNER, QUI N'EST PAS DANS LA SOURCE

Le tableur ne le note pas ; la base et le calcul des pensions l'exigent. Il
est donc posé le lendemain de chaque nuit EN CHAMBRE, et seulement là :
l'hôtel le sert, le gîte non — on y fait son café soi-même.

Ce n'est pas une supposition de confort. Le tableur calcule lui-même ses
colonnes Pension-Complète, Demi-Pension et Restauration-Hors-Pension, et
`engine/rules.py` ne retombe dessus qu'avec cette règle-là. Les tests la
vérifient sur les deux hébergements.

LE RATTACHEMENT AUX PARTICIPANTS

La base ne stocke pas les noms de famille : `importer_ged.py` met dans
`famille` le prénom du chef de branche. Le rapprochement se fait donc sur
le PRÉNOM. Quand deux personnes le partagent, le script s'arrête et
demande laquelle, en montrant leur branche et leur foyer — il ne devine
pas.
"""

from __future__ import annotations

import argparse
import csv
import getpass
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

# Les treize colonnes de présence, dans l'ordre du fichier : quatre jours
# de (déjeuner, dîner, nuit), puis le seul déjeuner du dernier jour.
GABARIT = [(j, r) for j in range(4) for r in ("dejeuner", "diner", "nuit")]
GABARIT.append((4, "dejeuner"))

CHAMBRE, GITE, EXTERIEUR = "chambre", "gite", "exterieur"


# ------------------------------------------------------------- lecture


def hebergement_de(identifiant: str) -> tuple[str | None, bool]:
    """`chambre_vue_mer_1` → ('chambre', True) ; `gîte_4_pers_2` → ('gite', False)."""
    i = (identifiant or "").strip().lower()
    if i.startswith("chambre"):
        return CHAMBRE, "vue_mer" in i
    # « gîte » ou « gite » : l'accent dépend de qui a tapé la ligne.
    if re.match(r"^g[iî]te", i):
        return GITE, False
    if i.startswith("ext"):
        return EXTERIEUR, False
    return None, False


def decouper_nom(cellule: str) -> tuple[int, str, str]:
    """« ──── Chloe Petit » → (2, 'Chloe', 'Petit').

    Les tirets disent la génération, et le premier mot est le prénom : c'est
    la seule partie que la base connaisse.
    """
    texte = cellule.strip().rstrip("?").strip()
    tirets = re.match(r"^(─*)", texte).group(1)
    reste = texte[len(tirets) :].strip()
    morceaux = reste.split()
    return len(tirets) // 2, (morceaux[0] if morceaux else ""), " ".join(morceaux[1:])


def lignes_du_csv(chemin: Path) -> list[dict]:
    """Une entrée par personne ayant au moins une case remplie."""
    with io.open(chemin, encoding="utf-8-sig", newline="") as f:
        brut = list(csv.reader(f))

    gens = []
    for rang, ligne in enumerate(brut[2:], start=3):
        if len(ligne) < 16 or not ligne[1].strip():
            continue
        if ligne[1].strip().lower().startswith("total"):
            continue

        niveau, prenom, nom = decouper_nom(ligne[1])
        cases = ligne[2:15]
        gens.append(
            {
                "rang": rang,
                "niveau": niveau,
                "prenom": prenom,
                "nom": nom,
                "identifiant": ligne[15].strip(),
                "cases": cases,
                "vide": not any(c.strip() for c in cases),
            }
        )
    return gens


def presences_de(personne: dict, debut: date) -> list[dict]:
    """Les faits d'une personne, jour par jour, prêts pour la base."""
    heberge, vue_mer = hebergement_de(personne["identifiant"])

    coches: dict[int, set[str]] = {}
    for (jour, repas), valeur in zip(GABARIT, personne["cases"]):
        if valeur.strip():
            coches.setdefault(jour, set()).add(repas)

    jours: dict[int, dict] = {}
    for jour, repas in coches.items():
        dort = "nuit" in repas
        jours[jour] = {
            # Présent sans dormir sur place : c'est « ailleurs », et c'est
            # aussi le cas du jour du départ.
            "hebergement": heberge if dort else EXTERIEUR,
            "vue_mer": bool(vue_mer) if dort and heberge == CHAMBRE else False,
            "dejeuner": "dejeuner" in repas,
            "diner": "diner" in repas,
            "petit_dejeuner": False,
        }

    # Le petit-déjeuner du lendemain d'une nuit en chambre. Il peut tomber
    # sur un jour que la personne n'a pas coché : elle part après avoir
    # déjeuné, sans rien prendre d'autre.
    for jour, fait in list(jours.items()):
        if fait["hebergement"] == CHAMBRE:
            suivant = jours.setdefault(
                jour + 1,
                {
                    "hebergement": EXTERIEUR,
                    "vue_mer": False,
                    "dejeuner": False,
                    "diner": False,
                    "petit_dejeuner": False,
                },
            )
            suivant["petit_dejeuner"] = True

    return [
        dict(jour=(debut + timedelta(days=j)).isoformat(), **fait)
        for j, fait in sorted(jours.items())
    ]


# --------------------------------------------------------- rattachement


def decrire(participant: dict, par_id: dict) -> str:
    """De quoi reconnaître un homonyme : sa branche et son foyer."""
    morceaux = [f"branche {participant.get('famille') or '?'}"]
    conjoint = par_id.get(participant.get("conjoint_id"))
    if conjoint:
        morceaux.append(f"avec {conjoint['prenom']}")
    parent = par_id.get(participant.get("parent_id"))
    if parent:
        morceaux.append(f"enfant de {parent['prenom']}")
    return ", ".join(morceaux)


def rattacher(gens: list[dict], participants: list[dict], liens: dict, interactif: bool) -> dict:
    """Associe chaque ligne du fichier à un participant de la base.

    Sur le prénom, et rien d'autre : la base ne connaît pas les noms de
    famille. Un prénom partagé n'est pas tranché en silence — c'est le
    genre de supposition qui fait manger quelqu'un à la place d'un autre
    pendant cinq jours.
    """
    par_id = {p["id"]: p for p in participants}
    par_prenom: dict[str, list[dict]] = {}
    for p in participants:
        par_prenom.setdefault(p["prenom"].strip().lower(), []).append(p)

    correspondances, absents, ambigus = {}, [], []

    for personne in gens:
        etiquette = f"{personne['prenom']} {personne['nom']}".strip()
        if etiquette in liens:
            correspondances[personne["rang"]] = liens[etiquette]
            continue

        candidats = par_prenom.get(personne["prenom"].strip().lower(), [])
        if len(candidats) == 1:
            correspondances[personne["rang"]] = candidats[0]["id"]
        elif not candidats:
            absents.append(personne)
        elif interactif:
            print(f"\n« {etiquette} » : {len(candidats)} personnes portent ce prénom.")
            for i, c in enumerate(candidats, start=1):
                print(f"   {i}. {c['prenom']} — {decrire(c, par_id)}")
            choix = input("   Laquelle ? (numéro, ou vide pour abandonner) ").strip()
            if not choix.isdigit() or not 1 <= int(choix) <= len(candidats):
                ambigus.append((personne, candidats))
            else:
                correspondances[personne["rang"]] = candidats[int(choix) - 1]["id"]
        else:
            ambigus.append((personne, candidats))

    return {
        "correspondances": correspondances,
        "absents": absents,
        "ambigus": ambigus,
        "par_id": par_id,
    }


# ------------------------------------------------------------- réseau


def config_js(chemin: Path) -> tuple[str, str]:
    """Relit l'URL et la clé publishable là où elles sont déjà : config.js."""
    texte = chemin.read_text(encoding="utf-8")
    url = re.search(r'SUPABASE_URL:\s*"([^"]+)"', texte)
    cle = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', texte)
    if not url or not cle:
        raise SystemExit(f"{chemin} ne contient pas SUPABASE_URL / SUPABASE_ANON_KEY.")
    return url.group(1), cle.group(1)


def rpc(url: str, cle: str, fonction: str, corps: dict):
    entetes = {"apikey": cle, "Content-Type": "application/json"}
    if cle.startswith("eyJ"):
        entetes["Authorization"] = f"Bearer {cle}"
    requete = urllib.request.Request(
        f"{url}/rest/v1/rpc/{fonction}",
        data=json.dumps(corps).encode("utf-8"),
        headers=entetes,
        method="POST",
    )
    try:
        with urllib.request.urlopen(requete, timeout=120) as reponse:
            return json.loads(reponse.read().decode("utf-8"))
    except urllib.error.HTTPError as erreur:
        detail = erreur.read().decode("utf-8", errors="replace")
        if "CODE_REFUSE" in detail:
            raise SystemExit("Code organisateur refusé.") from None
        raise SystemExit(f"Supabase a refusé l'appel {fonction} : {detail}") from None


# --------------------------------------------------------------- main


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--csv", required=True, help="le tableur exporté, là où il est")
    parseur.add_argument("--debut", required=True, help="date de la première colonne (AAAA-MM-JJ)")
    parseur.add_argument("--apercu", action="store_true", help="n'écrit rien")
    parseur.add_argument("--config", default="config.js")
    parseur.add_argument(
        "--lier",
        action="append",
        default=[],
        metavar="NOM=UUID",
        help="trancher un homonyme sans être interrogé (répétable)",
    )
    args = parseur.parse_args()

    chemin = Path(args.csv)
    if not chemin.exists():
        raise SystemExit(f"CSV introuvable : {chemin}")
    try:
        debut = date.fromisoformat(args.debut)
    except ValueError:
        raise SystemExit("--debut attend une date de la forme AAAA-MM-JJ.") from None

    liens = {}
    for paire in args.lier:
        if "=" not in paire:
            raise SystemExit(f"--lier attend NOM=UUID, reçu : {paire}")
        nom, identifiant = paire.split("=", 1)
        liens[nom.strip()] = identifiant.strip()

    gens = lignes_du_csv(chemin)
    actifs = [g for g in gens if not g["vide"]]
    print(f"{len(gens)} ligne(s) lues, dont {len(gens) - len(actifs)} sans aucune case cochée.")

    inconnus = [g for g in actifs if hebergement_de(g["identifiant"])[0] is None]
    if inconnus:
        print("\nHébergement non reconnu :", file=sys.stderr)
        for g in inconnus:
            print(f"   ligne {g['rang']} : « {g['identifiant']} »", file=sys.stderr)
        return 1

    url, cle = config_js(Path(args.config))
    code_admin = os.environ.get("TRIBU_CODE_ADMIN") or getpass.getpass("Code organisateur : ")

    participants = rpc(url, cle, "admin_lister", {"p_code": code_admin})
    print(f"{len(participants)} participant(s) en base.")

    resultat = rattacher(actifs, participants, liens, interactif=not args.apercu)
    if resultat["absents"] or resultat["ambigus"]:
        print("\nRattachement incomplet — rien n'a été écrit.", file=sys.stderr)
        for g in resultat["absents"]:
            print(f"   aucun «{g['prenom']}» en base (ligne {g['rang']})", file=sys.stderr)
        for g, candidats in resultat["ambigus"]:
            noms = " | ".join(
                f"{c['id']} ({decrire(c, resultat['par_id'])})" for c in candidats
            )
            print(f"   «{g['prenom']} {g['nom']}» : {noms}", file=sys.stderr)
        print("\n   Tranche avec --lier \"Prénom Nom=UUID\".", file=sys.stderr)
        return 1

    envoi = []
    for personne in actifs:
        pid = resultat["correspondances"][personne["rang"]]
        for fait in presences_de(personne, debut):
            envoi.append(dict(participant_id=pid, **fait))

    jours = sorted({l["jour"] for l in envoi})
    print(f"\n{len(envoi)} ligne(s) de présence pour {len(actifs)} personne(s),")
    print(f"du {jours[0]} au {jours[-1]}.")

    if args.apercu:
        print("\nAperçu — rien n'est écrit. Extrait :")
        for l in envoi[:8]:
            print("   ", json.dumps(l, ensure_ascii=False))
        return 0

    print("\nCela REMPLACE la saisie de ces personnes, et d'elles seules.")
    if input("Taper « oui » pour continuer : ").strip().lower() != "oui":
        print("Abandonné.")
        return 1

    reponse = rpc(url, cle, "admin_presences_importer", {"p_code": code_admin, "p_lignes": envoi})
    print("\n", json.dumps(reponse, ensure_ascii=False, indent=2))
    if reponse.get("recues") != reponse.get("ecrites"):
        print(
            "\n⚠️  Toutes les lignes n'ont pas été écrites : celles qui manquent\n"
            "    tombent hors des dates du séjour réglées en base\n"
            f"    ({reponse.get('date_debut')} → {reponse.get('date_fin')}).\n"
            "    Vérifie --debut, ou les dates dans private.reglages.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
