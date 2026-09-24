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

def test_chaque_fonction_publique_est_appelable():
    """Une fonction posee sans `grant execute` existe et reste injoignable :
    PostgREST repond 404 au premier clic, des mois apres, sur une page qui
    n'a jamais servi.

    On compare les NOMS et non les signatures : le but est d'attraper le
    grant oublie, pas de rejouer la resolution de surcharge de Postgres.

    Les deux motifs sont ancres en debut de ligne (`^`, mode multiligne) :
    sans cela, un `grant` mis en commentaire d'un `--` compterait encore.
    """
    posees = set(
        re.findall(r"^create (?:or replace )?function\s+public\.(\w+)\(", SCHEMA, re.I | re.M)
    )
    ouvertes = set(
        re.findall(r"^grant execute on function\s+public\.(\w+)\(", SCHEMA, re.I | re.M)
    )
    assert posees, "aucune fonction publique trouvee, le test ne sert a rien"
    assert sorted(posees - ouvertes) == [], "fonctions publiques sans `grant execute`"


# --- Recoller le script ne doit rien effacer -----------------------------
#
# Le fichier se recolle EN ENTIER a chaque changement : c'est la seule
# facon de poser une fonction. Toute instruction destructrice de premier
# niveau s'execute donc à chaque fois. Un `drop table public.presences` y a
# vécu longtemps sans se voir — tant que la table était vide — puis a
# emporté la saisie de soixante personnes d'un coup.

# Les tables qui portent de la donnée saisie ou déclarée. Les perdre, c'est
# perdre du travail que personne ne peut deviner.
SAISIE = [
    "public.presences",
    "public.voeux",
    "public.refus_lieu",
    "private.participants",
    "private.options_date",
    "private.logements",
    "private.couchages",
    "private.sauvegardes",
    "private.reglages",
    "private.acces",
    "private.acces_admin",
]


def test_aucune_table_de_donnees_n_est_detruite_au_recollage():
    """Un `drop table` de premier niveau s'exécute à chaque recollage."""
    detruites = set(re.findall(r"^drop table (?:if exists )?([\w.]+)", SCHEMA, re.I | re.M))
    fautives = sorted(detruites & set(SAISIE))
    assert fautives == [], "ces tables seraient vidées à chaque recollage du script"


def test_chaque_table_de_donnees_se_cree_sans_ecraser():
    """`create table` sans `if not exists` échoue sur une base déjà en
    place — et le script s'arrête là, à moitié posé."""
    manquantes = []
    for table in SAISIE:
        pose = re.search(r"^create table (if not exists )?" + re.escape(table) + r"\s*\(",
                         SCHEMA, re.I | re.M)
        if pose and not pose.group(1):
            manquantes.append(table)
    assert manquantes == [], "`create table` sans `if not exists`"
