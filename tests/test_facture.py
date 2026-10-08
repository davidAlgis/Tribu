"""Le calcul de la page dit-il la même chose que le moteur ?

`facture.js` est un SECOND exemplaire d'un calcul qui existe déjà en
Python — la page ne peut pas appeler le moteur, qui tourne sur la machine
de l'organisateur avec la clé secrète, et regarder ce que chacun doit ne
devrait pas demander de lancer un script.

Deux exemplaires d'une règle d'argent, c'est un risque. Ce test le tient :
les deux calculent les mêmes jeux de données, et leurs totaux doivent
coïncider au centime. Le jour où l'un des deux dérive — un régime oublié,
une remise appliquée dans le mauvais ordre, une taxe donnée à un mineur —
la suite le dit ici, et pas sur une facture.

DEUX JEUX, et non un seul. Celui de la démonstration montre le cas
courant ; le second va chercher ce qu'il ne contient pas — un gîte
partagé à trois, dont le prix ne tombe pas rond, et une nuit de week-end.
Un test de comparaison ne vaut que par ce qu'il compare.

Il a besoin de `node`. Sans lui, il se saute : une CI qui ne fait tourner
que Python ne doit pas échouer pour une absence d'outil.
"""

import json
import shutil
import subprocess
from statistics import mean, pstdev
from collections import defaultdict
from pathlib import Path

import pytest

from engine.pricing import facturer, grille_depuis
from engine.rules import LIBELLES_REPAS, calculer_prestations
from engine.source import charger_json

RACINE = Path(__file__).resolve().parent.parent
EXEMPLE = RACINE / "exemple_donnees.json"

# De quoi ranger une ligne de facture dans la bonne colonne de la page.
REPAS = set(LIBELLES_REPAS.values())
TAXE = "Taxe de sejour"
REDUCTION = "Reduction"

# Un gîte à 100 partagé par trois : 33,34 + 33,33 + 33,33. C'est l'endroit
# où deux arrondis peuvent se séparer d'un centime.
PARTAGE = {
    "_commentaire": "Jeu de test : un gîte partagé, un week-end, des âges mêlés.",
    "personnes": [
        {"id": "a1", "prenom": "Alice", "famille": "A", "categorie_age": "adulte"},
        {"id": "a2", "prenom": "Bruno", "famille": "A", "categorie_age": "adulte"},
        {"id": "a3", "prenom": "Chloe", "famille": "A", "categorie_age": "adulte"},
        {"id": "j1", "prenom": "Lea", "famille": "B", "categorie_age": "jeune"},
        {"id": "b1", "prenom": "Zora", "famille": "B", "categorie_age": "bebe"},
    ],
    # 2027-07-09 est un vendredi (tarif week-end), le 11 un dimanche.
    "presences": [
        {"personne_id": "a1", "jour": "2027-07-09", "hebergement": "gite",
         "logement_id": "lg", "diner": True},
        {"personne_id": "a2", "jour": "2027-07-09", "hebergement": "gite",
         "logement_id": "lg", "diner": True},
        {"personne_id": "a3", "jour": "2027-07-09", "hebergement": "gite",
         "logement_id": "lg"},
        {"personne_id": "j1", "jour": "2027-07-09", "hebergement": "chambre",
         "logement_id": "lm", "vue_mer": True, "diner": True},
        {"personne_id": "b1", "jour": "2027-07-09", "hebergement": "chambre",
         "logement_id": "lc"},
        # Le lendemain porte les repas que la nuit englobe.
        {"personne_id": "a1", "jour": "2027-07-10", "hebergement": "chambre",
         "logement_id": "lc", "petit_dejeuner": True, "dejeuner": True, "diner": True},
        {"personne_id": "a2", "jour": "2027-07-10", "hebergement": "chambre",
         "logement_id": "lc", "petit_dejeuner": True, "diner": True},
        {"personne_id": "a3", "jour": "2027-07-10", "hebergement": "exterieur",
         "dejeuner": True},
        {"personne_id": "j1", "jour": "2027-07-10", "hebergement": "chambre",
         "logement_id": "lm", "vue_mer": True, "petit_dejeuner": True, "dejeuner": True},
        {"personne_id": "b1", "jour": "2027-07-10", "hebergement": "chambre",
         "logement_id": "lc", "petit_dejeuner": True},
        {"personne_id": "a1", "jour": "2027-07-11", "hebergement": "exterieur",
         "petit_dejeuner": True, "dejeuner": True},
        {"personne_id": "a2", "jour": "2027-07-11", "hebergement": "exterieur",
         "petit_dejeuner": True},
        {"personne_id": "j1", "jour": "2027-07-11", "hebergement": "exterieur",
         "petit_dejeuner": True},
        {"personne_id": "b1", "jour": "2027-07-11", "hebergement": "exterieur"},
    ],
    "grille": {
        "logements": [
            {"id": "lc", "categorie": "chambre", "capacite": 2, "nombre": 4, "vue_mer": False},
            {"id": "lm", "categorie": "chambre", "capacite": 2, "nombre": 1, "vue_mer": True},
            {"id": "lg", "categorie": "gite", "capacite": 6, "nombre": 1, "vue_mer": False},
        ],
        "tarifs": [
            {"logement_id": "lc", "tranche": "adulte", "semaine": 97, "weekend": 111, "remise": 7},
            {"logement_id": "lc", "tranche": "jeune", "semaine": 71, "weekend": 0, "remise": 0},
            {"logement_id": "lc", "tranche": "bebe", "semaine": 0, "weekend": 0, "remise": 0},
            {"logement_id": "lm", "tranche": "adulte", "semaine": 97, "weekend": 111, "remise": 7},
            {"logement_id": "lm", "tranche": "jeune", "semaine": 71, "weekend": 0, "remise": 0},
            {"logement_id": "lg", "tranche": "entier", "semaine": 100, "weekend": 100, "remise": 0},
        ],
        "annexes": [
            {"cle": "vue_mer", "tranche": "", "montant": 17},
            {"cle": "taxe_sejour", "tranche": "", "montant": 0.88},
            {"cle": "demi_pension_soir", "tranche": "", "montant": 13},
            {"cle": "demi_pension_midi", "tranche": "", "montant": 13},
            {"cle": "nuit_petit_dejeuner", "tranche": "", "montant": 29},
            {"cle": "nuit_seule", "tranche": "", "montant": 41},
            {"cle": "petit_dejeuner", "tranche": "adulte", "montant": 11},
            {"cle": "dejeuner", "tranche": "adulte", "montant": 23},
            {"cle": "diner", "tranche": "adulte", "montant": 27},
            {"cle": "dejeuner", "tranche": "jeune", "montant": 17},
            {"cle": "petit_dejeuner", "tranche": "jeune", "montant": 8},
        ],
        "repas_jour": [
            {"jour": "2027-07-11", "repas": "dejeuner", "tranche": "adulte", "montant": 39}
        ],
        "jours_weekend": [4, 5],
        "couchages": [
            {"personne_id": "a1", "jour": "2027-07-09", "logement_id": "lg", "numero": 1},
            {"personne_id": "a2", "jour": "2027-07-09", "logement_id": "lg", "numero": 1},
            {"personne_id": "a3", "jour": "2027-07-09", "logement_id": "lg", "numero": 1},
        ],
    },
}


# L'hôtel de l'an prochain : on paie la chambre ET la personne, et rien
# n'est compris. Les deux parts s'additionnent, et tous les repas tombent
# hors pension — ce qu'aucun des deux autres jeux n'exerce.
#
# `ch3` va plus loin : son prix dépend du nombre d'occupants. Deux nuits,
# deux occupations différentes, deux prix différents pour la même chambre.
HOTEL = {
    "_commentaire": "Jeu de test : deux parts qui s'additionnent, sans pension.",
    "personnes": [
        # Les trois facons d'etre reduit : une part, un montant, et un
        # montant plus gros que la note -- qui ne doit rien rendre.
        {"id": "a1", "prenom": "Alice", "famille": "A", "categorie_age": "adulte",
         "reduction_type": "pourcentage", "reduction_valeur": 12.5},
        {"id": "a2", "prenom": "Bruno", "famille": "A", "categorie_age": "adulte",
         "reduction_type": "euros", "reduction_valeur": 7.3},
        {"id": "e1", "prenom": "Chloe", "famille": "A", "categorie_age": "enfant"},
        {"id": "d1", "prenom": "David", "famille": "D", "categorie_age": "adulte",
         "reduction_type": "euros", "reduction_valeur": 1000},
    ],
    # 2027-09-13 est un lundi : tout est au tarif semaine.
    "presences": [
        {"personne_id": "a1", "jour": "2027-09-13", "hebergement": "chambre",
         "logement_id": "ch2", "diner": True},
        {"personne_id": "e1", "jour": "2027-09-13", "hebergement": "chambre",
         "logement_id": "ch2", "diner": True},
        {"personne_id": "a2", "jour": "2027-09-13", "hebergement": "chambre",
         "logement_id": "ch3", "diner": True},
        {"personne_id": "d1", "jour": "2027-09-13", "hebergement": "chambre",
         "logement_id": "ch3"},
        {"personne_id": "a1", "jour": "2027-09-14", "hebergement": "chambre",
         "logement_id": "ch2", "petit_dejeuner": True, "dejeuner": True},
        {"personne_id": "e1", "jour": "2027-09-14", "hebergement": "chambre",
         "logement_id": "ch2", "petit_dejeuner": True},
        {"personne_id": "a2", "jour": "2027-09-14", "hebergement": "chambre",
         "logement_id": "ch3", "petit_dejeuner": True},
        {"personne_id": "d1", "jour": "2027-09-14", "hebergement": "exterieur",
         "petit_dejeuner": True},
        {"personne_id": "a1", "jour": "2027-09-15", "hebergement": "exterieur",
         "petit_dejeuner": True},
        {"personne_id": "e1", "jour": "2027-09-15", "hebergement": "exterieur"},
        {"personne_id": "a2", "jour": "2027-09-15", "hebergement": "exterieur",
         "petit_dejeuner": True},
    ],
    "grille": {
        "logements": [
            {"id": "ch2", "categorie": "chambre", "capacite": 2, "nombre": 3,
             "vue_mer": False, "part_logement": "fixe",
             "part_personne": "par_occupant", "repas_compris": []},
            {"id": "ch3", "categorie": "chambre", "capacite": 3, "nombre": 1,
             "vue_mer": False, "part_logement": "selon_occupation",
             "part_personne": "par_occupant", "repas_compris": []},
        ],
        "tarifs": [
            {"logement_id": "ch2", "tranche": "entier", "semaine": 60, "weekend": 70,
             "remise": 0},
            {"logement_id": "ch2", "tranche": "adulte", "semaine": 25, "weekend": 25,
             "remise": 0},
            {"logement_id": "ch2", "tranche": "enfant", "semaine": 12, "weekend": 12,
             "remise": 10},
            {"logement_id": "ch3", "tranche": "entier_1", "semaine": 55, "weekend": 55,
             "remise": 0},
            {"logement_id": "ch3", "tranche": "entier_2", "semaine": 71, "weekend": 71,
             "remise": 0},
            {"logement_id": "ch3", "tranche": "entier_3", "semaine": 80, "weekend": 80,
             "remise": 0},
            {"logement_id": "ch3", "tranche": "adulte", "semaine": 25, "weekend": 25,
             "remise": 0},
        ],
        "annexes": [
            {"cle": "taxe_sejour", "tranche": "", "montant": 1.10},
            {"cle": "petit_dejeuner", "tranche": "adulte", "montant": 9},
            {"cle": "petit_dejeuner", "tranche": "enfant", "montant": 5},
            {"cle": "dejeuner", "tranche": "adulte", "montant": 19},
            {"cle": "diner", "tranche": "adulte", "montant": 31},
            {"cle": "diner", "tranche": "enfant", "montant": 16},
        ],
        "repas_jour": [],
        "jours_weekend": [4, 5],
        "couchages": [
            {"personne_id": "a1", "jour": "2027-09-13", "logement_id": "ch2", "numero": 1},
            {"personne_id": "e1", "jour": "2027-09-13", "logement_id": "ch2", "numero": 1},
            {"personne_id": "a2", "jour": "2027-09-13", "logement_id": "ch3", "numero": 1},
            {"personne_id": "d1", "jour": "2027-09-13", "logement_id": "ch3", "numero": 1},
            {"personne_id": "a1", "jour": "2027-09-14", "logement_id": "ch2", "numero": 1},
            {"personne_id": "e1", "jour": "2027-09-14", "logement_id": "ch2", "numero": 1},
            {"personne_id": "a2", "jour": "2027-09-14", "logement_id": "ch3", "numero": 1},
        ],
    },
}


def colonnes_python(chemin: Path) -> dict:
    """Ce que le moteur facture, réparti comme la page l'affiche."""
    personnes, presences, brute = charger_json(chemin)
    grille = grille_depuis(brute)
    # L'INVENTAIRE PASSE AUX REGLES, comme dans `run_export.py` : c'est lui
    # qui dit ce que la nuit de chaque type comprend. L'oublier ferait
    # retomber le Python sur la règle d'avant — une chambre comprend tout —
    # pendant que le JavaScript lirait le réglage. Les deux se sépareraient
    # sur le seul jeu qui l'exerce.
    facturation = facturer(calculer_prestations(presences, grille.logements), personnes, grille)

    compte = defaultdict(
        lambda: {"hebergement": 0.0, "repas": 0.0, "taxe": 0.0, "reduction": 0.0}
    )
    for ligne in facturation.lignes:
        if ligne.libelle == REDUCTION:
            # Positive, comme la page la tient : ce qu'on retire.
            compte[ligne.personne_id]["reduction"] -= ligne.prix
            continue
        if ligne.libelle == TAXE:
            colonne = "taxe"
        elif ligne.libelle in REPAS and ligne.detail.startswith("hors pension"):
            colonne = "repas"
        else:
            colonne = "hebergement"
        compte[ligne.personne_id][colonne] += ligne.prix

    return {
        qui: {k: round(v, 2) for k, v in valeurs.items()}
        for qui, valeurs in compte.items()
    }


def colonnes_js(chemin: Path) -> dict:
    script = f"""
      const fs = require("fs");
      const fenetre = {{}};
      new Function("window", fs.readFileSync({str(RACINE / "facture.js")!r}, "utf8"))(fenetre);
      const donnees = JSON.parse(fs.readFileSync({str(chemin)!r}, "utf8"));
      const grille = donnees.grille || {{}};
      const resultat = fenetre.FACTURE.calculer(
        {{
          personnes: donnees.personnes,
          presences: donnees.presences,
          couchages: grille.couchages || [],
        }},
        grille
      );
      const par = {{}};
      for (const l of resultat.lignes) {{
        par[l.personne_id] = {{
          hebergement: l.hebergement, repas: l.repas, taxe: l.taxe, nuits: l.nuits,
          reduction: l.reduction, brut: l.brut, total: l.total,
          parNuit: l.parNuit, parRepas: l.parRepas,
        }};
      }}
      process.stdout.write(JSON.stringify({{
        par, total: resultat.total, brut: resultat.brut, reductions: resultat.reductions,
        colonnesNuits: resultat.nuits,
        colonnesRepas: resultat.repasColonnes.map((c) => c.cle),
        prestations: resultat.prestations,
        synthese: fenetre.FACTURE.synthese(resultat.lignes),
      }}));
    """
    # `encoding` explicite : sans lui, Python decode la sortie de node avec
    # l'encodage de la console -- cp1252 sous Windows -- et les accents des
    # libelles reviennent en mojibake. Les nombres passaient, les mots non.
    sortie = subprocess.run(
        ["node", "-e", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return json.loads(sortie.stdout)


@pytest.fixture(scope="module")
def ecrits(tmp_path_factory) -> dict:
    """Les jeux definis ici, poses sur disque : `charger_json` prend un
    chemin, et `node` doit pouvoir les relire."""
    dossier = tmp_path_factory.mktemp("facture")
    chemins = {"exemple": EXEMPLE}
    for nom, donnees in (("partage", PARTAGE), ("hotel", HOTEL)):
        chemin = dossier / f"{nom}.json"
        chemin.write_text(json.dumps(donnees, ensure_ascii=False), encoding="utf-8")
        chemins[nom] = chemin
    return chemins


@pytest.fixture
def jeux(request, ecrits):
    if not shutil.which("node"):
        pytest.skip("node absent : la comparaison des deux calculs se saute")
    chemin = ecrits[request.param]
    return colonnes_python(chemin), colonnes_js(chemin)


# TROIS JEUX, et non un seul. Celui de la demonstration montre le cas
# courant ; `partage` va chercher le gite divise a trois, dont le prix ne
# tombe pas rond ; `hotel` exerce ce qu'aucun des deux ne contient -- deux
# parts qui s'additionnent, un prix qui depend de l'occupation, et pas une
# miette de pension.
JEUX = pytest.mark.parametrize("jeux", ["exemple", "partage", "hotel"], indirect=True)


@JEUX
def test_les_deux_calculs_connaissent_les_memes_personnes(jeux):
    python, js = jeux
    assert sorted(python) == sorted(js["par"])


@JEUX
@pytest.mark.parametrize("colonne", ["hebergement", "repas", "taxe", "reduction"])
def test_chaque_colonne_tombe_au_centime_pres(jeux, colonne):
    """Régimes, remises, supplément vue mer, part d'un gîte partagé,
    exception de repas, taxe réservée aux adultes : tout est là-dedans."""
    python, js = jeux
    ecarts = {
        qui: (valeurs[colonne], js["par"][qui][colonne])
        for qui, valeurs in python.items()
        if round(valeurs[colonne], 2) != round(js["par"][qui][colonne], 2)
    }
    assert ecarts == {}


@JEUX
def test_le_total_est_le_meme_des_deux_cotes(jeux):
    python, js = jeux
    somme = round(
        sum(v["hebergement"] + v["repas"] + v["taxe"] - v["reduction"]
            for v in python.values()),
        2,
    )
    assert somme == round(js["total"], 2)


def test_le_gite_partage_tombe_bien_a_trois():
    """Le cas que le jeu de démonstration ne contient pas : 100 € divisés
    par trois, sans qu'un centime se perde."""
    personnes, presences, brute = charger_json_dict(PARTAGE)
    grille = grille_depuis(brute)
    facturation = facturer(calculer_prestations(presences, grille.logements), personnes, grille)
    # « Le logement » et non plus « Gite… » : la part du logement n'est pas
    # un régime, et une chambre peut désormais la porter.
    gite = [l for l in facturation.lignes if l.libelle == "Le logement"]
    assert sorted(l.prix for l in gite) == [33.33, 33.33, 33.34]
    assert round(sum(l.prix for l in gite), 2) == 100.0


def charger_json_dict(donnees: dict):
    """`charger_json` prend un chemin ; ici on a déjà le contenu."""
    from engine.models import Personne, Presence
    from datetime import date

    personnes = {
        p["id"]: Personne(
            id=p["id"], prenom=p["prenom"], famille=p["famille"],
            categorie_age=p["categorie_age"],
        )
        for p in donnees["personnes"]
    }
    presences = [
        Presence(
            personne_id=p["personne_id"],
            jour=date.fromisoformat(p["jour"]),
            hebergement=p["hebergement"],
            petit_dejeuner=bool(p.get("petit_dejeuner")),
            dejeuner=bool(p.get("dejeuner")),
            diner=bool(p.get("diner")),
            vue_mer=bool(p.get("vue_mer")),
            logement_id=p.get("logement_id"),
        )
        for p in donnees["presences"]
    ]
    return personnes, presences, donnees["grille"]

@JEUX
def test_le_detail_fait_la_somme(jeux):
    """La page montre une colonne par nuit et une par repas ; le total de
    la même ligne en est la somme. Deux façons de compter la même chose,
    et celle qu'on lit en diagonale doit valoir l'autre."""
    _, js = jeux
    for qui, valeurs in js["par"].items():
        nuits = round(sum(valeurs["parNuit"].values()), 2)
        repas = round(sum(valeurs["parRepas"].values()), 2)
        assert nuits == round(valeurs["hebergement"], 2), f"{qui} : nuits"
        assert repas == round(valeurs["repas"], 2), f"{qui} : repas"


@JEUX
def test_chaque_colonne_sert_a_quelqu_un(jeux):
    """Une colonne n'a de raison d'être que si quelqu'un a quelque chose
    dedans : cinq nuits et trois repas par jour font vite un tableau de
    seize colonnes qu'on ne lit plus."""
    _, js = jeux
    vues_nuits = set()
    vues_repas = set()
    for valeurs in js["par"].values():
        vues_nuits |= set(valeurs["parNuit"])
        vues_repas |= set(valeurs["parRepas"])
    assert sorted(js["colonnesNuits"]) == sorted(vues_nuits)
    assert sorted(js["colonnesRepas"]) == sorted(vues_repas)

@JEUX
def test_le_detail_du_sejour_totalise_la_facture(jeux):
    """L'onglet Hôtel regroupe le même argent par prestation — une ligne
    par régime, par couchage, par repas — pour qu'on puisse le poser à
    côté du contrat de l'hôtel.

    Deux façons de compter la même chose : par personne, par prestation.
    Si elles ne tombent pas sur le même total, l'une des deux oublie
    quelque chose — et c'est celle qu'on envoie à l'hôtel qui ferait foi.
    """
    _, js = jeux
    detail = round(sum(l["montant"] for l in js["prestations"]), 2)
    # Le BRUT, pas le total : la reduction est une affaire de famille, et
    # le detail envoye a l'hotel n'a pas a la connaitre.
    assert detail == round(js["brut"], 2)


@JEUX
def test_chaque_prestation_se_verifie_a_la_main(jeux):
    """Un hôtel relit une ligne : quantité fois prix unitaire, moins la
    remise. Si le montant ne s'en déduit pas, la ligne est indéfendable."""
    _, js = jeux
    for ligne in js["prestations"]:
        attendu = ligne["quantite"] * ligne["unitaire"] * (1 - ligne["remise"] / 100)
        # Chaque nuitée est arrondie au centime avant d'être additionnée :
        # l'écart ne peut dépasser un centime par unité.
        assert abs(attendu - ligne["montant"]) <= 0.01 * ligne["quantite"], ligne


@JEUX
def test_les_regimes_sont_nommes_comme_l_hotel_les_nomme(jeux):
    """« Pension complète », « Demi-pension soir », « Demi-pension
    déjeuner » : les mots du contrat, pour qu'une ligne se retrouve d'un
    document à l'autre sans traduction."""
    _, js = jeux
    nuits = [l for l in js["prestations"] if l["ordre"] == 1]
    assert nuits, "aucune nuit en chambre dans ce jeu"
    connus = (
        "Pension complète",
        "Demi-pension soir",
        "Demi-pension déjeuner",
        "Nuit + petit-déjeuner",
        "Nuit seule",
        # Une nuit dont rien n'est compris. Ce n'est plus l'affaire des
        # seuls gîtes : une chambre d'hôtel sans pension la porte aussi.
        "Nuit sans pension",
    )
    for ligne in nuits:
        assert ligne["libelle"].startswith(connus), ligne["libelle"]

@JEUX
def test_la_synthese_se_relit_avec_statistics(jeux):
    """Moyenne, écart-type, minimum, maximum : quatre nombres qu'un
    tableau de soixante lignes ne laisse pas vérifier à l'œil.

    Le calcul est en JavaScript, comme le reste de la facture. On le
    relit ici avec le module `statistics` de la bibliothèque standard,
    sur les mêmes lignes — deux implémentations indépendantes qui doivent
    tomber au centime.

    `pstdev` et non `stdev` : c'est l'écart-type de la POPULATION. On a
    tout le monde sous la main, on n'estime rien, et diviser par n-1
    gonflerait un chiffre dont la seule utilité est de dire si la dépense
    est égale ou dispersée.
    """
    _, js = jeux
    lignes = list(js["par"].values())
    assert lignes, "aucune ligne : le test ne sert à rien"

    # Ce que chacun PAIE : la reduction de l'organisateur deduite.
    totaux = {
        qui: round(v["hebergement"] + v["repas"] + v["taxe"] - v["reduction"], 2)
        for qui, v in js["par"].items()
    }
    dormeurs = [v for v in js["par"].values() if v["nuits"] > 0]

    attendu = {
        "repas": [v["repas"] for v in lignes],
        "hebergement": [round(v["hebergement"] + v["taxe"], 2) for v in lignes],
        "total": list(totaux.values()),
        "nuitee": [
            (v["hebergement"] + v["repas"] + v["taxe"] - v["reduction"]) / v["nuits"]
            for v in dormeurs
        ],
    }

    par_cle = {serie["cle"]: serie for serie in js["synthese"]}
    assert sorted(par_cle) == sorted(attendu), "les quatre séries, et pas d'autres"

    for cle, valeurs in attendu.items():
        serie = par_cle[cle]
        assert serie["personnes"] == len(valeurs), f"{cle} : effectif"
        assert serie["moyenne"] == pytest.approx(mean(valeurs), abs=0.01), f"{cle} : moyenne"
        assert serie["ecartType"] == pytest.approx(pstdev(valeurs), abs=0.01), f"{cle} : écart-type"
        assert serie["min"] == pytest.approx(min(valeurs), abs=0.01), f"{cle} : min"
        assert serie["max"] == pytest.approx(max(valeurs), abs=0.01), f"{cle} : max"


@JEUX
def test_la_derniere_serie_laisse_dehors_ceux_qui_ne_dorment_pas(jeux):
    """Un prix par nuit n'existe pas pour qui n'a déclaré aucune nuit.

    Le compter zéro tirerait la moyenne vers le bas en répondant à une
    autre question — et c'est l'erreur facile, puisque toutes les autres
    séries, elles, comptent bien tout le monde.
    """
    _, js = jeux
    par_cle = {serie["cle"]: serie for serie in js["synthese"]}
    dormeurs = [v for v in js["par"].values() if v["nuits"] > 0]

    assert par_cle["nuitee"]["personnes"] == len(dormeurs)
    for cle in ("repas", "hebergement", "total"):
        assert par_cle[cle]["personnes"] == len(js["par"]), cle


def test_une_synthese_sans_personne_ne_ment_pas():
    """Aucune ligne facturée : il n'y a pas de moyenne, et zéro n'est pas
    la bonne réponse — la page doit pouvoir montrer un tiret."""
    sortie = subprocess.run(
        [
            "node",
            "-e",
            f"""
              const fs = require("fs");
              const fenetre = {{}};
              new Function("window", fs.readFileSync({str(RACINE / "facture.js")!r}, "utf8"))(fenetre);
              process.stdout.write(JSON.stringify(fenetre.FACTURE.synthese([])));
            """,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    for serie in json.loads(sortie.stdout):
        assert serie["personnes"] == 0
        assert serie["moyenne"] is None, serie["cle"]
        assert serie["ecartType"] is None and serie["min"] is None and serie["max"] is None


def test_seuls_les_repas_factures_se_comptent():
    """Le prix moyen d'un repas se divise par les repas PAYÉS.

    Un dîner compris dans une pension complète est déjà payé avec la
    nuit ; le compter ferait baisser le prix moyen d'un repas sans que
    personne n'ait payé moins.
    """
    sortie = subprocess.run(
        [
            "node",
            "-e",
            f"""
              const fs = require("fs");
              const fenetre = {{}};
              new Function("window", fs.readFileSync({str(RACINE / "facture.js")!r}, "utf8"))(fenetre);
              process.stdout.write(JSON.stringify([
                fenetre.FACTURE.repasFactures({{ parRepas: {{}} }}),
                fenetre.FACTURE.repasFactures({{ parRepas: {{ "a|diner": 12, "b|dejeuner": 0 }} }}),
                fenetre.FACTURE.repasFactures({{}}),
              ]));
            """,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    # Un repas facturé zéro reste un repas : c'est un prix manquant, pas
    # un repas absent — et la ligne rouge de l'onglet le dit déjà.
    assert json.loads(sortie.stdout) == [0, 2, 0]


@pytest.mark.parametrize("jeux", ["hotel"], indirect=True)
def test_une_reduction_porte_sur_la_note_entiere_et_ne_rend_rien(jeux):
    """Un pourcentage se prend sur toute la note, taxe comprise ; un
    montant plus gros que la note la ramène à zéro, jamais en dessous. Et
    le détail par prestation, celui de l'hôtel, ne la voit pas."""
    _, js = jeux
    alice, bruno, chloe, david = (js["par"][q] for q in ("a1", "a2", "e1", "d1"))

    # 12,5 % de 180,20 font 22,525 : le demi-centime monte, des deux côtés.
    assert alice["brut"] == 180.2 and alice["reduction"] == 22.53
    assert bruno["reduction"] == 7.3
    assert chloe["reduction"] == 0
    assert david["reduction"] == david["brut"] and david["total"] == 0

    for valeurs in js["par"].values():
        assert valeurs["total"] == round(valeurs["brut"] - valeurs["reduction"], 2)
    assert js["reductions"] > 0
    assert round(js["brut"] - js["reductions"], 2) == round(js["total"], 2)
