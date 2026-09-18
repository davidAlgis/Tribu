"""Tarification : une simple couche de multiplication au-dessus des regles.

L'hotel de l'an prochain n'est pas connu. Le moteur calcule donc
d'abord des QUANTITES (nuitees par regime, repas hors pension), et
la tarification n'est qu'une table de correspondance lue dans un
fichier TOML. Changer d'hotel = changer le TOML, pas le code.

Un tarif absent du TOML ne fait pas planter le calcul : la ligne est
facturee 0 et remontee dans `tarifs_manquants`. L'export Excel liste
alors exactement les prix qu'il reste a negocier avec l'hotel.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from engine.rules import LIBELLES_REGIME, LIBELLES_REPAS, Prestations


@dataclass(frozen=True)
class LigneFacture:
    personne_id: str
    jour: object
    libelle: str
    detail: str
    prix: float


@dataclass
class Facturation:
    lignes: list[LigneFacture] = field(default_factory=list)
    tarifs_manquants: set[str] = field(default_factory=set)

    @property
    def total(self) -> float:
        return round(sum(ligne.prix for ligne in self.lignes), 2)


def charger_config(chemin: str | Path) -> dict:
    with open(chemin, "rb") as f:
        return tomllib.load(f)


def _est_weekend(jour, config: dict) -> bool:
    jours = config.get("meta", {}).get("jours_weekend", [4, 5])
    return jour.weekday() in jours


def _chercher_tarif(table: dict, cle: str, weekend: bool) -> float | None:
    """Cherche `cle_weekend` si on est en week-end, sinon `cle`.

    Si le tarif week-end n'est pas defini, on retombe sur le tarif
    semaine : beaucoup d'hotels n'ont qu'un seul prix.
    """
    if weekend and f"{cle}_weekend" in table:
        return table[f"{cle}_weekend"]
    return table.get(cle)


def facturer(prestations: Prestations, personnes: dict, config: dict) -> Facturation:
    facturation = Facturation()
    tarifs = config.get("tarifs", {})
    tarifs_repas = config.get("tarifs_repas", {})
    supplements = config.get("supplements", {})

    for nuitee in prestations.nuitees:
        personne = personnes[nuitee.personne_id]
        weekend = _est_weekend(nuitee.jour, config)
        table = tarifs.get(nuitee.hebergement, {}).get(personne.categorie_age, {})
        prix = _chercher_tarif(table, nuitee.regime, weekend)

        if prix is None:
            facturation.tarifs_manquants.add(
                f"tarifs.{nuitee.hebergement}.{personne.categorie_age}.{nuitee.regime}"
            )
            prix = 0.0

        if nuitee.vue_mer:
            prix += supplements.get("vue_mer", 0.0)

        facturation.lignes.append(
            LigneFacture(
                personne_id=nuitee.personne_id,
                jour=nuitee.jour,
                libelle=LIBELLES_REGIME[nuitee.regime],
                detail=f"{nuitee.hebergement}{' + vue mer' if nuitee.vue_mer else ''}",
                prix=round(prix, 2),
            )
        )

    for repas in prestations.repas_hors_pension:
        personne = personnes[repas.personne_id]
        prix = tarifs_repas.get(personne.categorie_age, {}).get(repas.repas)

        if prix is None:
            facturation.tarifs_manquants.add(
                f"tarifs_repas.{personne.categorie_age}.{repas.repas}"
            )
            prix = 0.0

        facturation.lignes.append(
            LigneFacture(
                personne_id=repas.personne_id,
                jour=repas.jour,
                libelle=LIBELLES_REPAS[repas.repas],
                detail="hors pension",
                prix=round(prix, 2),
            )
        )

    facturation.lignes.sort(key=lambda l: (l.jour, l.personne_id, l.libelle))
    return facturation
