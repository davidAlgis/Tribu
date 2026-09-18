"""Lecture des faits : depuis un fichier JSON local, ou depuis Supabase.

Les deux sources produisent exactement les memes objets, pour que le
moteur et les tests n'aient jamais besoin de reseau.

La lecture Supabase utilise la cle secrete (`sb_secret_...`, ou
l'ancienne `service_role`), qui contourne le RLS. Elle ne doit JAMAIS
se trouver dans le navigateur : uniquement en variable d'environnement
sur la machine qui genere les exports.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import date
from pathlib import Path

from engine.models import Personne, Presence


def _vers_personne(ligne: dict) -> Personne:
    return Personne(
        id=ligne["id"],
        prenom=ligne["prenom"],
        famille=ligne["famille"],
        categorie_age=ligne["categorie_age"],
    )


def _vers_presence(ligne: dict) -> Presence:
    return Presence(
        # La base parle de participant, le moteur de personne.
        personne_id=ligne.get("participant_id") or ligne["personne_id"],
        jour=date.fromisoformat(ligne["jour"]),
        hebergement=ligne["hebergement"],
        petit_dejeuner=bool(ligne.get("petit_dejeuner", False)),
        dejeuner=bool(ligne.get("dejeuner", False)),
        diner=bool(ligne.get("diner", False)),
        vue_mer=bool(ligne.get("vue_mer", False)),
    )


def charger_json(chemin: str | Path) -> tuple[dict, list]:
    """Retourne ({id: Personne}, [Presence])."""
    donnees = json.loads(Path(chemin).read_text(encoding="utf-8"))
    personnes = {p["id"]: _vers_personne(p) for p in donnees["personnes"]}
    presences = [_vers_presence(p) for p in donnees["presences"]]
    return personnes, presences


# On nomme les colonnes au lieu de faire `select=*` : le code d'acces
# reste ainsi en base et n'entre jamais dans un export.
COLONNES = {
    # `v_participants` est une vue sur private.participants, lisible par la
    # seule cle secrete : le schema `private` n'est pas expose par PostgREST.
    "v_participants": "id,prenom,famille,categorie_age",
    "presences": "participant_id,jour,hebergement,petit_dejeuner,dejeuner,diner,vue_mer",
}


def _get(url: str, cle: str, table: str) -> list[dict]:
    # Les anciennes cles service_role sont des JWT et se passent aussi en
    # Bearer ; les nouvelles cles `sb_secret_...` n'en sont pas.
    entetes = {"apikey": cle}
    if cle.startswith("eyJ"):
        entetes["Authorization"] = f"Bearer {cle}"

    requete = urllib.request.Request(
        f"{url}/rest/v1/{table}?select={COLONNES[table]}", headers=entetes
    )
    with urllib.request.urlopen(requete, timeout=30) as reponse:
        return json.loads(reponse.read().decode("utf-8"))


def charger_supabase(url: str, cle_service_role: str) -> tuple[dict, list]:
    personnes = {
        ligne["id"]: _vers_personne(ligne)
        for ligne in _get(url, cle_service_role, "v_participants")
    }
    presences = [_vers_presence(l) for l in _get(url, cle_service_role, "presences")]
    return personnes, presences
