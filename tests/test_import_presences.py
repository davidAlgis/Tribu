"""L'import du tableur pose-t-il les bons faits ?

Trois contrats sont vérifiés ici.

1. LA LECTURE. Un identifiant d'hébergement devient une catégorie et un
   supplément ; une case cochée sans nuit devient « ailleurs ».

2. LE PETIT-DÉJEUNER. Il n'existe pas dans la source. La règle — posé le
   lendemain d'une nuit en chambre, jamais après un gîte — n'est pas une
   convention interne : elle est confrontée ici à `engine/rules.py`, qui
   doit en tirer les mêmes régimes que ceux calculés par le tableur
   d'origine. Changer la règle sans changer ces tests casserait la
   facturation en silence.

3. LE RATTACHEMENT. La base ne stockant pas les noms de famille, deux
   personnes peuvent partager un prénom. Le script doit s'arrêter, jamais
   choisir.
"""

from datetime import date

import pytest

from engine.models import Presence
from engine.rules import (
    CHAMBRE,
    DEMI_PENSION_SOIR,
    EXTERIEUR,
    GITE,
    GITE_NUIT,
    PENSION_COMPLETE,
    calculer_prestations,
)
from importer_presences import (
    decouper_nom,
    hebergement_de,
    presences_de,
    rattacher,
)

DEBUT = date(2026, 10, 24)


def personne(cases, identifiant, prenom="Alice", nom="Durand", rang=3):
    """Une ligne du fichier, sous la forme que `lignes_du_csv` produit."""
    assert len(cases) == 13, "treize colonnes de présence"
    return {
        "rang": rang,
        "niveau": 0,
        "prenom": prenom,
        "nom": nom,
        "identifiant": identifiant,
        "cases": cases,
        "vide": not any(c.strip() for c in cases),
    }


def vers_presence(faits):
    return [
        Presence(
            personne_id="x",
            jour=date.fromisoformat(f["jour"]),
            hebergement=f["hebergement"],
            petit_dejeuner=f["petit_dejeuner"],
            dejeuner=f["dejeuner"],
            diner=f["diner"],
            vue_mer=f["vue_mer"],
        )
        for f in faits
    ]


def regimes(faits):
    p = calculer_prestations(vers_presence(faits))
    compte = {}
    for n in p.nuitees:
        compte[n.regime] = compte.get(n.regime, 0) + 1
    return compte, len(p.repas_hors_pension)


# ------------------------------------------------------ l'hébergement


@pytest.mark.parametrize(
    "identifiant, attendu, vue_mer",
    [
        ("chambre_3", CHAMBRE, False),
        ("chambre_vue_mer_1", CHAMBRE, True),
        ("gîte_4_pers_1", GITE, False),
        ("gite_6_pers_2", GITE, False),  # sans accent : le tableur varie
        ("Exterieur", EXTERIEUR, False),
        ("exterieur", EXTERIEUR, False),
    ],
)
def test_hebergement_reconnu(identifiant, attendu, vue_mer):
    assert hebergement_de(identifiant) == (attendu, vue_mer)


def test_hebergement_inconnu_ne_devine_pas():
    """Un identifiant nouveau doit arrêter l'import, pas tomber dans une case."""
    assert hebergement_de("péniche_2")[0] is None
    assert hebergement_de("")[0] is None


# ------------------------------------------------------------ le nom


@pytest.mark.parametrize(
    "cellule, niveau, prenom, nom",
    [
        ("Alice Durand", 0, "Alice", "Durand"),
        ("── Bruno Petit", 1, "Bruno", "Petit"),
        ("──── Chloe Martin", 2, "Chloe", "Martin"),
        ("── Lea Petit ?", 1, "Lea", "Petit"),  # le point d'interrogation tombe
        ("Emma", 0, "Emma", ""),
        ("──── David Petit Durand", 2, "David", "Petit Durand"),
    ],
)
def test_decouper_nom(cellule, niveau, prenom, nom):
    assert decouper_nom(cellule) == (niveau, prenom, nom)


# --------------------------------------------- le petit-déjeuner

def test_chambre_le_petit_dejeuner_suit_chaque_nuit():
    # Deux nuits pleines : dîner + nuit, puis déjeuner et dîner le lendemain.
    cases = ["", "1", "1", "1", "1", "1", "1", "", "", "", "", "", ""]
    faits = presences_de(personne(cases, "chambre_3"), DEBUT)
    par_jour = {f["jour"]: f for f in faits}
    assert par_jour["2026-10-24"]["petit_dejeuner"] is False  # rien la veille
    assert par_jour["2026-10-25"]["petit_dejeuner"] is True
    assert par_jour["2026-10-26"]["petit_dejeuner"] is True


def test_gite_jamais_de_petit_dejeuner():
    """On y fait son café soi-même : le compter serait facturer un repas
    que personne ne prend."""
    cases = ["1"] * 13
    faits = presences_de(personne(cases, "gîte_4_pers_1"), DEBUT)
    assert not any(f["petit_dejeuner"] for f in faits)


def test_le_jour_du_depart_nait_du_petit_dejeuner():
    """Une seule nuit en chambre : le lendemain n'est coché nulle part dans
    la source, et doit pourtant exister pour porter le petit-déjeuner."""
    cases = ["", "1", "1", "", "", "", "", "", "", "", "", "", ""]
    faits = presences_de(personne(cases, "chambre_3"), DEBUT)
    assert [f["jour"] for f in faits] == ["2026-10-24", "2026-10-25"]
    depart = faits[1]
    assert depart["hebergement"] == EXTERIEUR
    assert depart["petit_dejeuner"] is True
    assert depart["dejeuner"] is False and depart["diner"] is False


# ------------------------- la confrontation à engine/rules.py


def test_chambre_quatre_nuits_donne_trois_pensions_completes():
    """Le cas le plus courant du tableur : arrivée au dîner, départ après
    le petit-déjeuner du dernier matin."""
    cases = ["", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", ""]
    compte, hors_pension = regimes(presences_de(personne(cases, "chambre_6"), DEBUT))
    assert compte.get(PENSION_COMPLETE) == 3
    assert compte.get(DEMI_PENSION_SOIR) == 1
    assert hors_pension == 0


def test_gite_quatre_nuits_ne_donne_que_des_repas_hors_pension():
    """Le gîte n'inclut aucun repas : les onze cases cochées ressortent
    entières, sans petit-déjeuner ajouté."""
    cases = ["", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", ""]
    compte, hors_pension = regimes(presences_de(personne(cases, "gîte_4_pers_1"), DEBUT))
    assert compte.get(GITE_NUIT) == 4
    assert compte.get(PENSION_COMPLETE) is None
    assert hors_pension == 7  # 1 dîner + 3 × (déjeuner + dîner)


def test_exterieur_aucune_nuit_tous_les_repas_hors_pension():
    cases = ["1", "1", "", "1", "1", "", "1", "1", "", "1", "", "", ""]
    compte, hors_pension = regimes(presences_de(personne(cases, "Exterieur"), DEBUT))
    assert compte == {}
    assert hors_pension == 7


def test_le_supplement_vue_mer_ne_tient_qu_aux_nuits():
    cases = ["1", "1", "1", "1", "", "", "", "", "", "", "", "", ""]
    faits = presences_de(personne(cases, "chambre_vue_mer_1"), DEBUT)
    par_jour = {f["jour"]: f for f in faits}
    assert par_jour["2026-10-24"]["vue_mer"] is True  # la nuit
    assert par_jour["2026-10-25"]["vue_mer"] is False  # le départ, ailleurs


# ------------------------------------------------------ le rattachement


def base(*gens):
    """Ce que renvoie `admin_lister` : prénom, branche, liens de foyer."""
    return [
        dict(id=i, prenom=p, famille=f, parent_id=pa, conjoint_id=co)
        for i, p, f, pa, co in gens
    ]


def test_un_prenom_unique_se_rattache_seul():
    gens = [personne(["1"] * 13, "chambre_3", prenom="Alice")]
    r = rattacher(gens, base(("id-1", "Alice", "Alice", None, None)), {}, interactif=False)
    assert r["correspondances"] == {3: "id-1"}
    assert not r["absents"] and not r["ambigus"]


def test_un_prenom_partage_arrete_tout():
    """Deux Emma en base : le script ne doit pas en choisir une."""
    gens = [personne(["1"] * 13, "chambre_3", prenom="Emma", nom="Durand")]
    participants = base(
        ("id-1", "Emma", "Alice", None, "id-9"),
        ("id-2", "Emma", "Bruno", None, None),
    )
    r = rattacher(gens, participants, {}, interactif=False)
    assert r["correspondances"] == {}
    assert len(r["ambigus"]) == 1
    assert [c["id"] for c in r["ambigus"][0][1]] == ["id-1", "id-2"]


def test_lier_tranche_un_homonyme():
    gens = [personne(["1"] * 13, "chambre_3", prenom="Emma", nom="Durand")]
    participants = base(
        ("id-1", "Emma", "Alice", None, None),
        ("id-2", "Emma", "Bruno", None, None),
    )
    r = rattacher(gens, participants, {"Emma Durand": "id-2"}, interactif=False)
    assert r["correspondances"] == {3: "id-2"}
    assert not r["ambigus"]


def test_un_prenom_absent_est_signale():
    gens = [personne(["1"] * 13, "chambre_3", prenom="Zora")]
    r = rattacher(gens, base(("id-1", "Alice", "Alice", None, None)), {}, interactif=False)
    assert r["correspondances"] == {}
    assert [g["prenom"] for g in r["absents"]] == ["Zora"]


def test_le_rattachement_ignore_la_casse():
    gens = [personne(["1"] * 13, "chambre_3", prenom="alice")]
    r = rattacher(gens, base(("id-1", "Alice", "Alice", None, None)), {}, interactif=False)
    assert r["correspondances"] == {3: "id-1"}
