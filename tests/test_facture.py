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


def colonnes_python(chemin: Path) -> dict:
    """Ce que le moteur facture, réparti comme la page l'affiche."""
    personnes, presences, brute = charger_json(chemin)
    facturation = facturer(calculer_prestations(presences), personnes, grille_depuis(brute))

    compte = defaultdict(lambda: {"hebergement": 0.0, "repas": 0.0, "taxe": 0.0})
    for ligne in facturation.lignes:
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
        }};
      }}
      process.stdout.write(JSON.stringify({{ par, total: resultat.total }}));
    """
    sortie = subprocess.run(
        ["node", "-e", script], capture_output=True, text=True, check=True
    )
    return json.loads(sortie.stdout)


@pytest.fixture(scope="module")
def partage(tmp_path_factory) -> Path:
    chemin = tmp_path_factory.mktemp("facture") / "partage.json"
    chemin.write_text(json.dumps(PARTAGE, ensure_ascii=False), encoding="utf-8")
    return chemin


@pytest.fixture
def jeux(request, partage):
    if not shutil.which("node"):
        pytest.skip("node absent : la comparaison des deux calculs se saute")
    chemin = EXEMPLE if request.param == "exemple" else partage
    return colonnes_python(chemin), colonnes_js(chemin)


JEUX = pytest.mark.parametrize("jeux", ["exemple", "partage"], indirect=True)


@JEUX
def test_les_deux_calculs_connaissent_les_memes_personnes(jeux):
    python, js = jeux
    assert sorted(python) == sorted(js["par"])


@JEUX
@pytest.mark.parametrize("colonne", ["hebergement", "repas", "taxe"])
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
    somme = round(sum(sum(v.values()) for v in python.values()), 2)
    assert somme == round(js["total"], 2)


def test_le_gite_partage_tombe_bien_a_trois():
    """Le cas que le jeu de démonstration ne contient pas : 100 € divisés
    par trois, sans qu'un centime se perde."""
    personnes, presences, brute = charger_json_dict(PARTAGE)
    facturation = facturer(calculer_prestations(presences), personnes, grille_depuis(brute))
    gite = [l for l in facturation.lignes if l.libelle.startswith("Gite")]
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
