"""Regles metier du sejour.

C'EST LE SEUL ENDROIT OU LES REGLES EXISTENT.
Si l'hotel change ses regles l'an prochain, on modifie ce fichier
et rien d'autre : ni la base, ni le formulaire, ni les exports.

Regles implementees
-------------------
Une "nuitee" est rattachee au jour J ou la personne se couche.
Les repas qu'elle englobe sont le diner du jour J, puis le
petit-dejeuner et le dejeuner du jour J+1.

    pension complete    = diner[J] + nuit[J] + petit_dej[J+1] + dejeuner[J+1]
    demi-pension soir   = diner[J] + nuit[J] + petit_dej[J+1]
    demi-pension midi   =            nuit[J] + petit_dej[J+1] + dejeuner[J+1]
    nuit + petit-dej    =            nuit[J] + petit_dej[J+1]
    nuit seule          =            nuit[J]

Tout repas qui n'est pas absorbe par un de ces regimes est
facture HORS PENSION (cas explicitement demande : une personne
logee en chambre peut prendre un repas hors pension).

Les gites suivent une logique differente : la nuit est facturee
au gite et AUCUN repas n'y est inclus. Tous les repas d'une
personne en gite sont donc hors pension.

Il n'existe que trois hebergements : `chambre`, `gite`, et
`exterieur` (presente ce jour-la mais ne dort pas sur place).

Ce module ne connait AUCUN PRIX : il produit des quantites -- des
nuitees portant un regime, des repas hors pension. Ce que ca coute est
l'affaire de `pricing.py`, et un gite s'y facture entier plutot que par
personne.
Une personne totalement absente n'a tout simplement aucune ligne
pour ce jour. C'est volontaire : distinguer "absent" de "dort
ailleurs" est une source d'erreurs de saisie pour un resultat
identique a la facturation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

# --- Hebergements ---------------------------------------------------
CHAMBRE = "chambre"
GITE = "gite"
EXTERIEUR = "exterieur"  # present ce jour-la, mais ne dort pas sur place

# --- Regimes derives ------------------------------------------------
PENSION_COMPLETE = "pension_complete"
DEMI_PENSION_SOIR = "demi_pension_soir"
DEMI_PENSION_MIDI = "demi_pension_midi"
NUIT_PETIT_DEJEUNER = "nuit_petit_dejeuner"
NUIT_SEULE = "nuit_seule"
GITE_NUIT = "gite_nuit"

LIBELLES_REGIME = {
    PENSION_COMPLETE: "Pension complete",
    DEMI_PENSION_SOIR: "Demi-pension soir",
    DEMI_PENSION_MIDI: "Demi-pension midi",
    NUIT_PETIT_DEJEUNER: "Nuit + petit-dejeuner",
    NUIT_SEULE: "Nuit seule",
    GITE_NUIT: "Gite (nuit seule)",
}

REPAS = ("petit_dejeuner", "dejeuner", "diner")
LIBELLES_REPAS = {
    "petit_dejeuner": "Petit-dejeuner",
    "dejeuner": "Dejeuner",
    "diner": "Diner",
}


@dataclass(frozen=True)
class Nuitee:
    """Une nuit facturable, avec le regime qu'elle porte."""

    personne_id: str
    jour: date  # nuit du `jour` au lendemain
    hebergement: str
    regime: str
    vue_mer: bool
    # Le type declare, repris tel quel : la tarification en a besoin pour
    # savoir a quelle ligne de prix rattacher la nuit.
    logement_id: str | None = None


@dataclass(frozen=True)
class RepasHorsPension:
    personne_id: str
    jour: date
    repas: str  # petit_dejeuner | dejeuner | diner


@dataclass(frozen=True)
class Anomalie:
    personne_id: str
    jour: date
    message: str


@dataclass
class Prestations:
    nuitees: list[Nuitee] = field(default_factory=list)
    repas_hors_pension: list[RepasHorsPension] = field(default_factory=list)
    anomalies: list[Anomalie] = field(default_factory=list)


def _regime_chambre(diner_j: bool, pdj_j1: bool, dej_j1: bool) -> str:
    """Traduit une combinaison de repas en regime hotelier."""
    if not pdj_j1:
        # Sans petit-dejeuner, l'hotel ne reconnait aucune formule :
        # c'est une nuit seche, les repas eventuels passent hors pension.
        return NUIT_SEULE
    if diner_j and dej_j1:
        return PENSION_COMPLETE
    if diner_j:
        return DEMI_PENSION_SOIR
    if dej_j1:
        return DEMI_PENSION_MIDI
    return NUIT_PETIT_DEJEUNER


def _repas_absorbes(regime: str) -> set[tuple[int, str]]:
    """Repas inclus dans le regime, sous la forme (decalage_jour, repas)."""
    if regime == PENSION_COMPLETE:
        return {(0, "diner"), (1, "petit_dejeuner"), (1, "dejeuner")}
    if regime == DEMI_PENSION_SOIR:
        return {(0, "diner"), (1, "petit_dejeuner")}
    if regime == DEMI_PENSION_MIDI:
        return {(1, "petit_dejeuner"), (1, "dejeuner")}
    if regime == NUIT_PETIT_DEJEUNER:
        return {(1, "petit_dejeuner")}
    return set()  # NUIT_SEULE et GITE_NUIT n'incluent aucun repas


def calculer_prestations(presences: list) -> Prestations:
    """Transforme les faits saisis en prestations facturables.

    Equivalent de la feuille `Prestations-Pers` du classeur, mais
    en un seul endroit et testable.
    """
    resultat = Prestations()

    # Regroupement par personne, puis acces direct par date.
    par_personne: dict[str, dict[date, object]] = {}
    for p in presences:
        par_personne.setdefault(p.personne_id, {})[p.jour] = p

    for personne_id, jours in par_personne.items():
        # Repas deja payes via un regime : (jour, repas)
        absorbes: set[tuple[date, str]] = set()

        for jour in sorted(jours):
            presence = jours[jour]

            if presence.vue_mer and presence.hebergement != CHAMBRE:
                resultat.anomalies.append(
                    Anomalie(
                        personne_id,
                        jour,
                        f"Supplement vue mer coche sur un hebergement '{presence.hebergement}'",
                    )
                )

            if presence.hebergement == EXTERIEUR:
                # Pas de nuit facturee. Les repas eventuels de ce jour
                # (typiquement le jour du depart) seront soit absorbes par
                # la nuit de la veille, soit factures hors pension.
                continue

            lendemain = jours.get(jour + timedelta(days=1))

            if presence.hebergement == GITE:
                regime = GITE_NUIT
            else:
                regime = _regime_chambre(
                    diner_j=presence.diner,
                    pdj_j1=bool(lendemain and lendemain.petit_dejeuner),
                    dej_j1=bool(lendemain and lendemain.dejeuner),
                )

            resultat.nuitees.append(
                Nuitee(
                    personne_id=personne_id,
                    jour=jour,
                    hebergement=presence.hebergement,
                    regime=regime,
                    vue_mer=presence.vue_mer and presence.hebergement == CHAMBRE,
                    logement_id=presence.logement_id,
                )
            )

            for decalage, repas in _repas_absorbes(regime):
                absorbes.add((jour + timedelta(days=decalage), repas))

        # Tout repas coche et non absorbe par un regime est hors pension.
        for jour in sorted(jours):
            presence = jours[jour]
            for repas in REPAS:
                if getattr(presence, repas) and (jour, repas) not in absorbes:
                    resultat.repas_hors_pension.append(
                        RepasHorsPension(personne_id, jour, repas)
                    )

    resultat.nuitees.sort(key=lambda n: (n.jour, n.personne_id))
    resultat.repas_hors_pension.sort(key=lambda r: (r.jour, r.personne_id, r.repas))
    resultat.anomalies.sort(key=lambda a: (a.jour, a.personne_id))
    return resultat
