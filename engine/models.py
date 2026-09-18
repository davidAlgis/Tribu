"""Structures de donnees : uniquement les faits saisis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Personne:
    id: str
    nom: str
    famille: str
    categorie_age: str  # adulte | enfant | bebe


@dataclass(frozen=True)
class Presence:
    """Ce qu'une personne a declare pour un jour de calendrier.

    hebergement    : ou elle dort la nuit du `jour` au lendemain
    petit_dejeuner : repas pris le matin du `jour`
    dejeuner       : repas pris le midi du `jour`
    diner          : repas pris le soir du `jour`
    """

    personne_id: str
    jour: date
    hebergement: str  # chambre | gite | exterieur
    petit_dejeuner: bool = False
    dejeuner: bool = False
    diner: bool = False
    vue_mer: bool = False
