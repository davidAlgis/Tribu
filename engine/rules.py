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

CE QU'UNE NUIT COMPREND SE LIT SUR LE LOGEMENT, et non sur son
nom. Chaque type declare `repas_compris` : la liste des repas que sa
nuit absorbe. L'escalier ci-dessus ne joue que sur ces repas-la, et
un type qui ne comprend rien -- un gite, ou une chambre d'hotel sans
pension -- met tous les repas de ses occupants hors pension.

Les deux cas d'hier s'ecrivent dans ce vocabulaire sans rien changer :
une chambre comprend les trois repas, un gite n'en comprend aucun.
C'est ce que la base pose sur les lignes existantes, et c'est ce que
ce module suppose quand le type n'est pas connu -- une declaration
generique, « en chambre » sans taille, n'en designe aucun.

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
# Le meme regime, sous le nom qu'il merite depuis qu'une chambre peut le
# porter : une nuit dont rien n'est compris. La cle ne change pas -- elle
# est comparee dans les tests et dans les imports -- seul le mot change.
SANS_PENSION = GITE_NUIT

LIBELLES_REGIME = {
    PENSION_COMPLETE: "Pension complete",
    DEMI_PENSION_SOIR: "Demi-pension soir",
    DEMI_PENSION_MIDI: "Demi-pension midi",
    NUIT_PETIT_DEJEUNER: "Nuit + petit-dejeuner",
    NUIT_SEULE: "Nuit seule",
    GITE_NUIT: "Nuit sans pension",
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


# Ce que valait la regle avant que le reglage existe. Elle sert encore de
# repli : une declaration generique -- « en chambre », sans taille -- ne
# designe aucun type, et il faut bien savoir ce que sa nuit comprend.
COMPRIS_PAR_DEFAUT = {
    CHAMBRE: frozenset(REPAS),
    GITE: frozenset(),
}


def repas_compris(logements: dict | None, logement_id, hebergement: str) -> frozenset:
    """Les repas que la nuit de ce type absorbe."""
    ligne = (logements or {}).get(logement_id)
    if ligne is not None and ligne.get("repas_compris") is not None:
        return frozenset(ligne["repas_compris"])
    return COMPRIS_PAR_DEFAUT.get(hebergement, frozenset(REPAS))


def _regime(compris: frozenset, diner_j: bool, pdj_j1: bool, dej_j1: bool) -> str:
    """Traduit une combinaison de repas en regime hotelier.

    L'escalier ne voit que ce que la nuit PEUT comprendre : un repas pris
    hors de cette liste ne l'abaisse pas d'un cran, il se facture a part.
    Avec les trois repas, c'est mot pour mot la regle d'avant ; avec une
    liste vide, aucune formule n'existe et tout se paie separement.

    LA LIMITE DE CE MODELE : l'escalier est la convention de CET hotel --
    pas de petit-dejeuner, pas de formule. Un hotel qui annoncerait quatre
    prix de pension independants demanderait une grille plus large, et non
    une reduction retranchee de la pension complete.
    """
    if not compris:
        return SANS_PENSION

    diner = diner_j and "diner" in compris
    petit_dejeuner = pdj_j1 and "petit_dejeuner" in compris
    dejeuner = dej_j1 and "dejeuner" in compris

    if "petit_dejeuner" in compris and not petit_dejeuner:
        # Sans petit-dejeuner, l'hotel ne reconnait aucune formule :
        # c'est une nuit seche, les repas eventuels passent hors pension.
        return NUIT_SEULE
    if diner and dejeuner:
        return PENSION_COMPLETE
    if diner:
        return DEMI_PENSION_SOIR
    if dejeuner:
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


def calculer_prestations(presences: list, logements: dict | None = None) -> Prestations:
    """Transforme les faits saisis en prestations facturables.

    Equivalent de la feuille `Prestations-Pers` du classeur, mais
    en un seul endroit et testable.

    `logements` est l'inventaire, indexe par identifiant : c'est lui qui
    dit ce que la nuit de chaque type comprend. Absent, on retombe sur la
    regle d'avant -- une chambre comprend tout, un gite rien -- ce qui
    laisse passer les jeux de test ecrits avant ce reglage.
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

            regime = _regime(
                repas_compris(logements, presence.logement_id, presence.hebergement),
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
