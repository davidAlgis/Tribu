"""L'ordre dans lequel les noms se lisent.

`private.ordre_familial()` range toute la famille en un parcours de
l'arbre : le couple le plus âgé d'abord, ses enfants dessous du plus âgé
au plus jeune, les conjoints côte à côte. Toutes les listes de
l'application s'y rangent — celle de l'organisateur, les pastilles
« pour qui remplis-tu », le plateau de couchage, la facture.

IL N'Y A PAS DE POSTGRES ICI. Ce test prend donc la requête **telle
qu'elle est écrite dans le schéma**, la traduit pour SQLite — qui parle
le même SQL récursif — et vérifie ce qu'elle rend. Ce n'est pas une
preuve que Postgres l'acceptera : `pglast` s'en charge ailleurs. C'est la
preuve que la LOGIQUE est la bonne, et c'est elle qu'on ne peut pas lire
à l'œil sur quarante lignes de récursion.

Le texte n'est pas recopié : il est extrait. Une requête recopiée dans un
test finit par ne plus être celle qui tourne.
"""

import re
import sqlite3
from pathlib import Path

import pytest

SCHEMA = (Path(__file__).resolve().parent.parent / "supabase" / "schema.sql").read_text(
    encoding="utf-8"
)


def requete_du_schema() -> str:
    """Le corps de `private.ordre_familial()`, traduit pour SQLite.

    Les seules retouches sont des transtypages : SQLite n'a ni `::text`
    ni schéma `private`, et n'en a pas besoin — tout y est du texte.
    """
    trouve = re.search(
        r"create or replace function private\.ordre_familial\(\).*?\$fn\$(.*?)\$fn\$",
        SCHEMA,
        re.DOTALL,
    )
    assert trouve, "je ne retrouve pas `private.ordre_familial()` dans le schéma"
    corps = trouve.group(1)
    corps = corps.replace("private.", "")
    corps = re.sub(r"::(text|integer|uuid)", "", corps)
    return corps


TABLE = """
create table participants (
  id text primary key,
  prenom text,
  parent_id text,
  conjoint_id text,
  date_naissance text
);
"""

# Gérard et Simone, les aînés. Leurs enfants : Sylvain (avec Nadia, entrée
# par alliance) puis Marie. Les enfants de Sylvain : Timéo puis Zora. Et un
# second couple de première génération, plus jeune : Jacques et Louise.
FAMILLE = [
    ("g", "Gerard", None, "s", "1940-03-02"),
    ("s", "Simone", None, "g", "1942-07-11"),
    ("sy", "Sylvain", "g", "na", "1970-01-05"),
    ("na", "Nadia", "g", "sy", "1972-09-30"),
    ("ma", "Marie", "g", None, "1975-04-18"),
    ("ti", "Timeo", "sy", None, "2000-06-01"),
    ("zo", "Zora", "sy", None, "2005-02-14"),
    ("ja", "Jacques", None, "lo", "1945-11-20"),
    ("lo", "Louise", None, "ja", "1947-05-05"),
]


def ordonner(gens):
    if sqlite3.sqlite_version_info < (3, 25):
        pytest.skip("SQLite trop ancien pour les fonctions de fenêtrage")
    base = sqlite3.connect(":memory:")
    base.executescript(TABLE)
    base.executemany("insert into participants values (?,?,?,?,?)", gens)
    lignes = list(base.execute(requete_du_schema()))
    # La requête rend (id, rang) ; on relit les prénoms pour la lisibilité.
    prenoms = {g[0]: g[1] for g in gens}
    return [prenoms[ligne[0]] for ligne in sorted(lignes, key=lambda l: l[1])]


def test_l_arbre_se_lit_de_haut_en_bas():
    """Le couple le plus âgé, puis toute sa descendance, puis le couple
    suivant. C'est ainsi qu'une famille se raconte."""
    assert ordonner(FAMILLE) == [
        "Gerard", "Simone",      # première génération, les aînés
        "Sylvain", "Nadia",      # leur fils aîné, et sa femme
        "Timeo", "Zora",         # les enfants de Sylvain, du plus âgé au plus jeune
        "Marie",                 # la cadette de Gérard
        "Jacques", "Louise",     # le second couple de première génération
    ]


def test_l_ordre_ne_depend_pas_de_celui_des_lignes():
    """Une table n'a pas d'ordre. Si le résultat dépendait de l'ordre
    d'insertion, il changerait au premier `vacuum`."""
    assert ordonner(list(reversed(FAMILLE))) == ordonner(FAMILLE)


def test_les_conjoints_restent_cote_a_cote():
    couples = [("Gerard", "Simone"), ("Sylvain", "Nadia"), ("Jacques", "Louise")]
    ordre = ordonner(FAMILLE)
    for un, autre in couples:
        assert abs(ordre.index(un) - ordre.index(autre)) == 1, f"{un} et {autre} séparés"


def test_un_couple_declare_d_un_seul_cote_tient_quand_meme():
    """`conjoint_id` peut n'être posé que d'un côté : le schéma le prévoit
    (section 5), et l'ordre doit le prévoir aussi."""
    gens = [
        ("g", "Gerard", None, "s", "1940-03-02"),
        ("s", "Simone", None, None, "1942-07-11"),
        ("sy", "Sylvain", "g", None, "1970-01-05"),
    ]
    assert ordonner(gens) == ["Gerard", "Simone", "Sylvain"]


def test_sans_date_de_naissance_on_passe_en_dernier():
    """Ne pas savoir n'est pas être jeune. Mieux vaut le voir à la fin
    d'une fratrie qu'au milieu."""
    gens = [
        ("g", "Gerard", None, None, "1940-01-01"),
        ("a", "Alice", "g", None, "1970-01-01"),
        ("x", "Zora", "g", None, None),
        ("b", "Bruno", "g", None, "1975-01-01"),
    ]
    assert ordonner(gens) == ["Gerard", "Alice", "Bruno", "Zora"]


def test_personne_ne_se_perd():
    """Une liste qui trie mal se corrige ; une liste qui oublie quelqu'un
    se paie en repas non commandés. Même une boucle de parenté — que rien
    ne devrait produire — laisse tout le monde dans le résultat."""
    boucle = [
        ("a", "Alice", "b", None, "1980-01-01"),
        ("b", "Bruno", "a", None, "1981-01-01"),
        ("c", "Chloe", None, None, "1950-01-01"),
    ]
    assert sorted(ordonner(boucle)) == ["Alice", "Bruno", "Chloe"]


def test_une_seule_personne():
    assert ordonner([("a", "Alice", None, None, None)]) == ["Alice"]


def test_le_rang_est_unique_et_continu():
    """Deux personnes de même rang, et le tri devient l'ordre d'arrivée
    des lignes — c'est-à-dire aucun."""
    base = sqlite3.connect(":memory:")
    base.executescript(TABLE)
    base.executemany("insert into participants values (?,?,?,?,?)", FAMILLE)
    rangs = sorted(ligne[1] for ligne in base.execute(requete_du_schema()))
    assert rangs == list(range(1, len(FAMILLE) + 1))


def test_toutes_les_listes_s_y_rangent():
    """Trier chaque liste à sa façon reviendrait à demander à la famille
    d'apprendre quatre ordres. Ce test énumère les fonctions qui rendent
    des personnes : chacune doit passer par l'ordre commun."""
    listes = (
        "participants_lister",
        "sejour_charger",
        "dates_charger",
        "lieux_charger",
        "regimes_charger",
        "couchage_charger",
        "admin_lister",
        "admin_couchages",
        # `admin_faits` et `comptes_charger` passent tous deux par elle :
        # c'est donc elle qui doit ranger.
        "faits_tous",
    )
    sans = []
    for nom in listes:
        corps = re.search(
            r"create or replace function (?:public|private)\." + nom
            + r"\(.*?\$fn\$(.*?)\$fn\$",
            SCHEMA,
            re.DOTALL,
        )
        assert corps, f"{nom} : fonction introuvable"
        if "ordre_familial()" not in corps.group(1):
            sans.append(nom)
    assert sans == [], "ces listes ne suivent pas l'ordre commun"
