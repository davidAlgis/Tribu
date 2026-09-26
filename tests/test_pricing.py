"""Ce que coûte une nuit, une fois les régimes calculés.

Les prix viennent de la base depuis que l'organisateur les règle depuis
la page. Ce fichier vérifie la traduction : une grille d'un côté, des
nuitées de l'autre, et une facture entre les deux.

Deux règles s'y jouent qui ne se voient nulle part ailleurs :

  - une **chambre** se facture par personne, et le prix de la ligne est
    celui de la pension complète — les autres régimes s'en retranchent ;
  - un **gîte** se facture entier, et la note se partage entre ceux qui
    y dorment cette nuit-là. Sans plan de couchage, il n'y a pas de part
    à calculer : la nuit reste à zéro et remonte, plutôt que d'être
    devinée.
"""

from datetime import date

import pytest

from engine.models import Personne, Presence
from engine.pricing import facturer, grille_depuis
from engine.rules import calculer_prestations

# 2027-07-09 est un vendredi, le 10 un samedi, le 11 un dimanche.
VENDREDI = date(2027, 7, 9)
SAMEDI = date(2027, 7, 10)
DIMANCHE = date(2027, 7, 11)

CHAMBRE = "lc"
GITE = "lg"

LOGEMENTS = [
    {"id": CHAMBRE, "categorie": "chambre", "capacite": 2, "nombre": 4, "vue_mer": False},
    {"id": "lm", "categorie": "chambre", "capacite": 2, "nombre": 1, "vue_mer": True},
    {"id": GITE, "categorie": "gite", "capacite": 6, "nombre": 2, "vue_mer": False},
]


def grille(tarifs=None, annexes=None, couchages=(), jours_weekend=(4, 5)):
    return grille_depuis(
        {
            "logements": LOGEMENTS,
            "tarifs": tarifs if tarifs is not None else TARIFS,
            "annexes": annexes if annexes is not None else ANNEXES,
            "couchages": list(couchages),
            "jours_weekend": list(jours_weekend),
        }
    )


TARIFS = [
    {"logement_id": CHAMBRE, "tranche": "adulte", "semaine": 100, "weekend": 120, "remise": 0},
    {"logement_id": CHAMBRE, "tranche": "jeune", "semaine": 80, "weekend": 0, "remise": 0},
    {"logement_id": CHAMBRE, "tranche": "enfant", "semaine": 60, "weekend": 0, "remise": 0},
    {"logement_id": CHAMBRE, "tranche": "bebe", "semaine": 0, "weekend": 0, "remise": 0},
    {"logement_id": "lm", "tranche": "adulte", "semaine": 100, "weekend": 0, "remise": 0},
    {"logement_id": GITE, "tranche": "entier", "semaine": 300, "weekend": 0, "remise": 0},
]

ANNEXES = [
    {"cle": "vue_mer", "tranche": "", "montant": 15},
    {"cle": "demi_pension_soir", "tranche": "", "montant": 20},
    {"cle": "nuit_seule", "tranche": "", "montant": 45},
    {"cle": "diner", "tranche": "adulte", "montant": 28},
    {"cle": "diner", "tranche": "jeune", "montant": 21},
]

GENS = {
    "a1": Personne(id="a1", prenom="Alice", famille="A", categorie_age="adulte"),
    "a2": Personne(id="a2", prenom="Bruno", famille="A", categorie_age="adulte"),
    "a3": Personne(id="a3", prenom="Chloe", famille="A", categorie_age="adulte"),
    "j1": Personne(id="j1", prenom="Lea", famille="A", categorie_age="jeune"),
    "b1": Personne(id="b1", prenom="Zora", famille="A", categorie_age="bebe"),
}


def nuit(qui, jour, hebergement="chambre", logement_id=CHAMBRE, **repas):
    """Une nuit en pension complète, sauf si les repas disent autrement.

    `pdj_lendemain` et `dej_lendemain` portent sur le JOUR SUIVANT : c'est
    là que `rules.py` va chercher les deux repas qu'une nuitée englobe.
    """
    pdj = repas.pop("pdj_lendemain", True)
    dej = repas.pop("dej_lendemain", True)
    complet = {"diner": True}
    complet.update(repas)
    veille = Presence(
        personne_id=qui, jour=jour, hebergement=hebergement,
        logement_id=logement_id, **complet
    )
    lendemain = Presence(
        personne_id=qui,
        jour=date.fromordinal(jour.toordinal() + 1),
        hebergement="exterieur",
        petit_dejeuner=pdj,
        dejeuner=dej,
    )
    return [veille, lendemain]


def facture(presences, g, personnes=None):
    return facturer(calculer_prestations(presences), personnes or GENS, g)


def prix(f, qui):
    return [l.prix for l in f.lignes if l.personne_id == qui and "hors pension" not in l.detail]


# --- Les chambres -------------------------------------------------------


def test_le_prix_de_la_ligne_est_celui_de_la_pension_complete():
    f = facture(nuit("a1", VENDREDI), grille())
    assert prix(f, "a1") == [120.0]  # vendredi : tarif week-end


def test_le_tarif_de_semaine_sert_les_jours_ordinaires():
    f = facture(nuit("a1", DIMANCHE), grille())
    assert prix(f, "a1") == [100.0]


def test_un_prix_de_week_end_a_zero_veut_dire_comme_la_semaine():
    """Beaucoup d'hôtels n'ont qu'un seul prix, et la colonne reste vide.
    La lire comme « gratuit le samedi » serait absurde."""
    f = facture(nuit("j1", SAMEDI), grille())
    assert prix(f, "j1") == [80.0]


def test_les_autres_regimes_se_retranchent_du_prix_de_base():
    # Sans déjeuner le lendemain : demi-pension soir, donc -20.
    f = facture(nuit("a1", DIMANCHE, dej_lendemain=False), grille())
    assert prix(f, "a1") == [80.0]


def test_une_reduction_ne_descend_jamais_sous_zero():
    """Un bébé facturé 0 en pension complète reste à 0 : une réduction ne
    rend pas d'argent."""
    f = facture(nuit("b1", DIMANCHE, dej_lendemain=False), grille())
    assert prix(f, "b1") == [0.0]


def test_le_supplement_vue_mer_s_ajoute():
    presences = nuit("a1", DIMANCHE, logement_id="lm")
    presences[0] = Presence(
        personne_id="a1", jour=DIMANCHE, hebergement="chambre",
        logement_id="lm", vue_mer=True, diner=True,
    )
    f = facture(presences, grille())
    assert prix(f, "a1") == [115.0]


def test_la_remise_s_applique_a_toute_la_ligne():
    tarifs = [dict(t) for t in TARIFS]
    tarifs[0]["remise"] = 10
    f = facture(nuit("a1", DIMANCHE), grille(tarifs=tarifs))
    assert prix(f, "a1") == [90.0]


def test_la_place_reelle_passe_devant_le_type_declare():
    """L'organisateur a posé quelqu'un ailleurs que ce qu'il demandait :
    c'est là qu'il a dormi, c'est là qu'on facture."""
    couchages = [
        {"personne_id": "a1", "jour": DIMANCHE.isoformat(), "logement_id": "lm", "numero": 1}
    ]
    f = facture(nuit("a1", DIMANCHE, logement_id=CHAMBRE), grille(couchages=couchages))
    assert [l.detail for l in f.lignes if l.personne_id == "a1"] == ["chambre vue mer de 2"]


def test_un_prix_absent_se_facture_zero_et_se_signale():
    """« lm / jeune » n'a pas de ligne dans la grille."""
    f = facture(nuit("j1", DIMANCHE, logement_id="lm"), grille())
    assert prix(f, "j1") == [0.0]
    # Lisible sans aller chercher un identifiant en base.
    assert f.tarifs_manquants == {"chambre vue mer de 2 - jeune"}


def test_un_prix_pose_a_zero_se_signale_aussi():
    """Un bébé gratuit est voulu ; une nuit d'adulte à zéro ne l'est pas,
    et rien ne les distingue dans la grille. On montre les deux plutôt
    que de deviner : lire « bébé : 0 » ne coûte rien, rater une nuit
    d'adulte facturée zéro se paye."""
    f = facture(nuit("b1", DIMANCHE), grille())
    assert prix(f, "b1") == [0.0]
    assert f.tarifs_manquants == {"chambre de 2 - bebe"}


# --- Les gîtes ----------------------------------------------------------


def couchage(qui, jour, numero=1, logement_id=GITE):
    return {
        "personne_id": qui,
        "jour": jour.isoformat(),
        "logement_id": logement_id,
        "numero": numero,
    }


def test_un_gite_se_facture_entier_et_se_partage():
    presences = nuit("a1", DIMANCHE, "gite", GITE) + nuit("a2", DIMANCHE, "gite", GITE)
    g = grille(couchages=[couchage("a1", DIMANCHE), couchage("a2", DIMANCHE)])
    f = facture(presences, g)
    assert prix(f, "a1") == [150.0]
    assert prix(f, "a2") == [150.0]


def test_le_partage_tombe_juste_au_centime():
    """Trois occupants pour 300 : personne ne paye un centime de trop, et
    la somme des parts fait le prix du gîte."""
    presences = (
        nuit("a1", DIMANCHE, "gite", GITE)
        + nuit("a2", DIMANCHE, "gite", GITE)
        + nuit("a3", DIMANCHE, "gite", GITE)
    )
    tarifs = [dict(t) for t in TARIFS]
    tarifs[-1]["semaine"] = 100
    g = grille(
        tarifs=tarifs,
        couchages=[couchage(q, DIMANCHE) for q in ("a1", "a2", "a3")],
    )
    f = facture(presences, g)
    parts = sorted(prix(f, q)[0] for q in ("a1", "a2", "a3"))
    assert parts == [33.33, 33.33, 33.34]
    assert round(sum(parts), 2) == 100.0


def test_l_age_ne_change_rien_au_prix_d_un_gite():
    presences = nuit("a1", DIMANCHE, "gite", GITE) + nuit("b1", DIMANCHE, "gite", GITE)
    g = grille(couchages=[couchage("a1", DIMANCHE), couchage("b1", DIMANCHE)])
    f = facture(presences, g)
    assert prix(f, "a1") == prix(f, "b1") == [150.0]


def test_deux_gites_jumeaux_ne_se_confondent_pas():
    """Même ligne d'inventaire, deux exemplaires : deux locations, et non
    une seule partagée à quatre."""
    presences = (
        nuit("a1", DIMANCHE, "gite", GITE)
        + nuit("a2", DIMANCHE, "gite", GITE)
        + nuit("a3", DIMANCHE, "gite", GITE)
    )
    g = grille(
        couchages=[
            couchage("a1", DIMANCHE, numero=1),
            couchage("a2", DIMANCHE, numero=1),
            couchage("a3", DIMANCHE, numero=2),
        ]
    )
    f = facture(presences, g)
    assert prix(f, "a1") == [150.0]
    assert prix(f, "a3") == [300.0]


def test_un_gite_sans_place_attribuee_ne_se_facture_pas():
    """On ne sait ni lequel ni avec combien : la deviner reviendrait à
    facturer quelqu'un au hasard."""
    f = facture(nuit("a1", DIMANCHE, "gite", GITE), grille())
    assert prix(f, "a1") == [0.0]
    assert f.sans_place == [("a1", DIMANCHE)]


def test_le_gite_n_emporte_aucun_repas():
    """Tous les repas d'une personne en gîte sont hors pension."""
    f = facture(
        nuit("a1", DIMANCHE, "gite", GITE),
        grille(couchages=[couchage("a1", DIMANCHE)]),
    )
    hors = [l for l in f.lignes if l.detail == "hors pension"]
    # Le dîner du soir, puis le petit-déjeuner et le déjeuner du lendemain :
    # aucun des trois n'est compris dans la nuit.
    assert sorted(l.libelle for l in hors) == ["Dejeuner", "Diner", "Petit-dejeuner"]
    assert [l.prix for l in hors if l.libelle == "Diner"] == [28.0]


# --- Les repas hors pension --------------------------------------------


def test_un_repas_hors_pension_suit_la_tranche_d_age():
    g = grille(couchages=[couchage("j1", DIMANCHE)])
    f = facture(nuit("j1", DIMANCHE, "gite", GITE), g)
    assert [l.prix for l in f.lignes if l.libelle == "Diner"] == [21.0]


def test_un_repas_sans_tarif_se_signale_lisiblement():
    g = grille(couchages=[couchage("b1", DIMANCHE)])
    f = facture(nuit("b1", DIMANCHE, "gite", GITE), g)
    assert "Diner hors pension - bebe" in f.tarifs_manquants


# --- Les jours de week-end ---------------------------------------------


def test_les_jours_de_week_end_sont_reglables():
    """Certains hôtels comptent le dimanche, d'autres non : c'est un
    réglage, pas une constante."""
    f = facture(nuit("a1", DIMANCHE), grille(jours_weekend=(5, 6)))
    assert prix(f, "a1") == [120.0]


def test_sans_grille_rien_ne_plante():
    """Une base neuve n'a aucun prix. L'export doit tourner quand même et
    dire ce qui manque, plutôt que de refuser de s'exécuter."""
    f = facture(nuit("a1", DIMANCHE), grille_depuis({}))
    assert f.total == 0.0
    assert f.tarifs_manquants
