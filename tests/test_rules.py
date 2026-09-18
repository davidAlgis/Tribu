"""Les cas qui cassaient dans le classeur Google Sheets."""

from datetime import date

import pytest

from engine.models import Presence
from engine.rules import (
    DEMI_PENSION_MIDI,
    DEMI_PENSION_SOIR,
    GITE_NUIT,
    NUIT_PETIT_DEJEUNER,
    NUIT_SEULE,
    PENSION_COMPLETE,
    calculer_prestations,
)

J1 = date(2027, 7, 10)
J2 = date(2027, 7, 11)
J3 = date(2027, 7, 12)


def presence(jour, hebergement="chambre", **repas):
    return Presence(personne_id="p1", jour=jour, hebergement=hebergement, **repas)


def regimes(presences):
    return [n.regime for n in calculer_prestations(presences).nuitees]


def test_pension_complete_est_a_cheval_sur_deux_jours():
    """diner[J1] + nuit[J1] + petit-dej[J2] + dejeuner[J2]."""
    assert regimes(
        [
            presence(J1, diner=True),
            presence(J2, petit_dejeuner=True, dejeuner=True, hebergement="exterieur"),
        ]
    ) == [PENSION_COMPLETE]


def test_demi_pension_soir():
    """Le dejeuner du lendemain n'est pas pris."""
    assert regimes(
        [
            presence(J1, diner=True),
            presence(J2, petit_dejeuner=True, hebergement="exterieur"),
        ]
    ) == [DEMI_PENSION_SOIR]


def test_demi_pension_midi():
    """Pas de diner le soir de l'arrivee, mais dejeuner le lendemain."""
    assert regimes(
        [
            presence(J1),
            presence(J2, petit_dejeuner=True, dejeuner=True, hebergement="exterieur"),
        ]
    ) == [DEMI_PENSION_MIDI]


def test_nuit_et_petit_dejeuner_seuls():
    assert regimes(
        [presence(J1), presence(J2, petit_dejeuner=True, hebergement="exterieur")]
    ) == [NUIT_PETIT_DEJEUNER]


def test_nuit_seule_sans_petit_dejeuner():
    assert regimes([presence(J1), presence(J2, hebergement="exterieur")]) == [NUIT_SEULE]


def test_dernier_jour_sans_lendemain_saisi():
    """Une nuit en fin de sejour ne doit pas planter faute de J+1."""
    assert regimes([presence(J1, diner=True)]) == [NUIT_SEULE]


def test_repas_hors_pension_pour_une_personne_logee():
    """Cas explicitement demande par l'hotel : chambre + repas hors pension.

    Ici : pension complete sur J1, plus un diner le soir de J2 qui
    n'est absorbe par aucun regime (la personne part le lendemain).
    """
    prestations = calculer_prestations(
        [
            presence(J1, diner=True),
            presence(J2, petit_dejeuner=True, dejeuner=True, diner=True, hebergement="exterieur"),
        ]
    )
    assert [n.regime for n in prestations.nuitees] == [PENSION_COMPLETE]
    assert [(r.jour, r.repas) for r in prestations.repas_hors_pension] == [(J2, "diner")]


def test_un_repas_n_est_jamais_compte_deux_fois():
    """Deux nuits consecutives : le petit-dejeuner de J2 appartient a la nuit de J1."""
    prestations = calculer_prestations(
        [
            presence(J1, diner=True),
            presence(J2, petit_dejeuner=True, dejeuner=True, diner=True),
            presence(J3, petit_dejeuner=True, dejeuner=True, hebergement="exterieur"),
        ]
    )
    assert [n.regime for n in prestations.nuitees] == [PENSION_COMPLETE, PENSION_COMPLETE]
    assert prestations.repas_hors_pension == []


def test_gite_n_inclut_aucun_repas():
    """Logique differente des chambres : la nuit seule est facturee."""
    prestations = calculer_prestations(
        [
            presence(J1, hebergement="gite", diner=True),
            presence(J2, hebergement="gite", petit_dejeuner=True, dejeuner=True),
        ]
    )
    assert [n.regime for n in prestations.nuitees] == [GITE_NUIT, GITE_NUIT]
    assert {(r.jour, r.repas) for r in prestations.repas_hors_pension} == {
        (J1, "diner"),
        (J2, "petit_dejeuner"),
        (J2, "dejeuner"),
    }


def test_exterieur_ne_genere_pas_de_nuit_mais_facture_ses_repas():
    prestations = calculer_prestations([presence(J1, hebergement="exterieur", dejeuner=True)])
    assert prestations.nuitees == []
    assert [(r.jour, r.repas) for r in prestations.repas_hors_pension] == [(J1, "dejeuner")]


def test_vue_mer_sur_un_gite_remonte_une_anomalie():
    """Le supplement vue mer n'existe que pour les chambres."""
    prestations = calculer_prestations([presence(J1, hebergement="gite", vue_mer=True)])
    assert len(prestations.anomalies) == 1
    assert prestations.nuitees[0].vue_mer is False


def test_le_supplement_vue_mer_suit_la_nuit():
    prestations = calculer_prestations([presence(J1, vue_mer=True)])
    assert prestations.nuitees[0].vue_mer is True
