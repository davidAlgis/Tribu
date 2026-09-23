"""Le schéma tient-il les contraintes de l'hébergeur ?

Supabase charge l'extension `safeupdate` pour le rôle qui sert l'API. Elle
refuse tout `UPDATE` et tout `DELETE` dépourvu de clause `WHERE` :

    UPDATE requires a WHERE clause

Sur une table qui n'a qu'une ligne, la clause paraît superflue — et c'est
exactement pour ça qu'on l'oublie. Le SQL se pose sans broncher, la
fonction se crée, et l'erreur n'apparaît qu'au premier clic de
l'organisateur, des mois plus tard.

Ces tests ne lisent que l'intérieur des fonctions : c'est là que passe
l'API. Les instructions de premier niveau, elles, tournent dans l'éditeur
SQL sous un autre rôle, où l'extension n'est pas chargée.
"""

import re
from pathlib import Path

import pytest

SCHEMA = (Path(__file__).resolve().parent.parent / "supabase" / "schema.sql").read_text(
    encoding="utf-8"
)

# Le corps d'une fonction, entre ses deux marqueurs `$fn$`.
CORPS = re.compile(r"create (?:or replace )?function\s+([\w.]+)\(.*?\$fn\$(.*?)\$fn\$", re.DOTALL | re.I)


def instructions(mot: str):
    """(nom de la fonction, instruction) pour chaque `mot` trouvé dans un corps."""
    trouves = []
    for fonction in CORPS.finditer(SCHEMA):
        nom, corps = fonction.group(1), fonction.group(2)
        for m in re.finditer(r"\n\s*" + mot + r"\s+[\w.]+\s+set\b(.*?);"
                             if mot == "update"
                             else r"\n\s*" + mot + r"\s+from\s+[\w.]+(.*?);",
                             corps, re.DOTALL | re.I):
            trouves.append((nom, " ".join(m.group(0).split())))
    return trouves


def test_il_y_a_bien_des_fonctions_a_examiner():
    """Si l'extraction cassait, tous les tests passeraient pour rien."""
    assert len(CORPS.findall(SCHEMA)) > 15


@pytest.mark.parametrize("mot", ["update", "delete"])
def test_aucune_ecriture_sans_clause_where(mot):
    """`safeupdate` les refuse, et l'erreur ne sort qu'à l'exécution."""
    fautives = [
        (nom, texte)
        for nom, texte in instructions(mot)
        if not re.search(r"\bwhere\b", texte, re.I)
    ]
    assert fautives == [], (
        f"{mot.upper()} sans WHERE — Supabase le refusera au premier appel"
    )


def test_la_table_a_ligne_unique_se_designe_par_son_id():
    """`private.reglages` n'a qu'une ligne, et c'est `id` qui la désigne.

    Le test vaut surtout pour le lecteur : il explique pourquoi les
    fonctions écrivent `where id` sur une table qui n'a rien à filtrer.
    """
    assert re.search(
        r"create table if not exists private\.reglages\s*\(\s*\n\s*id\s+boolean primary key",
        SCHEMA,
    )
    for nom, texte in instructions("update"):
        if "private.reglages" in texte:
            assert re.search(r"where id\b", texte, re.I), f"{nom} : attendu `where id`"


def test_chaque_fonction_fige_son_search_path():
    """Une fonction `security definer` sans `search_path` fixe se laisse
    détourner par un objet homonyme créé ailleurs."""
    sans = []
    for m in re.finditer(
        r"create (?:or replace )?function\s+([\w.]+)\(.*?\$fn\$", SCHEMA, re.DOTALL | re.I
    ):
        entete = m.group(0)
        if "security definer" in entete.lower() and "set search_path" not in entete.lower():
            sans.append(m.group(1))
    assert sans == [], "fonctions `security definer` sans search_path figé"
