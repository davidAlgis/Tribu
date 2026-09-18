"""Le GEDCOM decrit-il bien la famille qu'on croit ?

Le GEDCOM de test est synthetique : aucune donnee reelle dans le depot.

    Jacques + Louise            <- la racine, hors liste
      |
      +-- Marie + Paul          <- generation 0
      |     |
      |     +-- Lea (nee 2020)
      |
      +-- Bruno                 <- decede
            |
            +-- Chloe
"""

from datetime import date

import pytest

from importer_ged import (
    Arbre,
    apercu,
    categorie_age,
    construire,
    lire_gedcom,
    normaliser,
    portee,
)

GEDCOM = """0 HEAD
0 @I1@ INDI
1 NAME Jacques /Durand/
1 SEX M
1 BIRT
2 DATE 3 MAR 1940
0 @I2@ INDI
1 NAME Louise /Petit/
1 SEX F
0 @I3@ INDI
1 NAME Marie /Durand/
1 SEX F
1 BIRT
2 DATE 12 JUN 1965
0 @I4@ INDI
1 NAME Paul /Martin/
1 SEX M
1 BIRT
2 DATE 1963
0 @I5@ INDI
1 NAME Lea /Martin/
1 SEX F
1 BIRT
2 DATE 4 SEP 2020
0 @I6@ INDI
1 NAME Bruno /Durand/
1 SEX M
1 BIRT
2 DATE 1968
1 DEAT
2 DATE 2019
0 @I7@ INDI
1 NAME Chloe /Durand/
1 SEX F
1 BIRT
2 DATE 1995
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I6@
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I3@
1 CHIL @I5@
0 @F3@ FAM
1 HUSB @I6@
1 CHIL @I7@
0 TRLR
"""

SEJOUR = date(2027, 7, 10)


@pytest.fixture
def arbre():
    individus, familles = lire_gedcom_texte(GEDCOM)
    return Arbre(individus, familles)


def lire_gedcom_texte(texte, tmp=None):
    import tempfile
    from pathlib import Path

    chemin = Path(tempfile.mkdtemp()) / "test.ged"
    chemin.write_text(texte, encoding="utf-8")
    return lire_gedcom(chemin)


def participants(arbre, exclusions=frozenset()):
    return construire(arbre, "@I1@", set(exclusions), SEJOUR, 3, 12).participants


def par_prenom(arbre, exclusions=frozenset()):
    return {p.prenom: p for p in participants(arbre, exclusions)}


def lignes(arbre, exclusions=frozenset()):
    """L'apercu affiche, pour verifier l'indentation et les couples."""
    rapport = construire(arbre, "@I1@", set(exclusions), SEJOUR, 3, 12)
    return [l.strip() for l in apercu(rapport).splitlines() if l.strip()]


def couverture(arbre, exclusions=frozenset()):
    """{prenom: set des prenoms qu'il peut modifier}"""
    gens = participants(arbre, exclusions)
    par_id = {p.id: p for p in gens}
    return {p.prenom: {par_id[i].prenom for i in portee(gens, p.id)} for p in gens}


def test_prenom_et_nom_sont_separes(arbre):
    """Le GEDCOM entoure le nom de famille de barres obliques."""
    assert arbre.individus["@I1@"].prenom == "Jacques"
    assert arbre.individus["@I1@"].nom == "Durand"


def test_les_couples_viennent_du_gedcom(arbre):
    """C'est tout l'interet : plus besoin de deviner qui va avec qui."""
    gens = par_prenom(arbre)
    assert gens["Marie"].conjoint_id == gens["Paul"].id
    assert gens["Paul"].conjoint_id == gens["Marie"].id


def test_la_filiation_donne_le_parent(arbre):
    gens = par_prenom(arbre)
    assert gens["Lea"].parent_id == gens["Marie"].id


def test_l_apercu_indente_les_generations(arbre):
    assert "Marie + Paul" in lignes(arbre)
    assert "Lea (enfant)" in lignes(arbre)


def test_les_descendants_partent_des_enfants_de_la_racine(arbre):
    """Jacques et Louise sont la racine : ils ne participent pas."""
    assemble = "\n".join(lignes(arbre))
    assert "Jacques" not in assemble
    assert "Louise" not in assemble


def test_une_personne_decedee_est_ecartee(arbre):
    rapport = construire(arbre, "@I1@", set(), SEJOUR, 3, 12)
    assert rapport.decedes == ["Bruno Durand"]
    assert "Bruno" not in {p.prenom for p in rapport.participants}


def test_l_enfant_d_un_ecarte_remonte_d_un_cran(arbre):
    """Bruno est decede : Chloe n'a plus de parent dans la liste."""
    assert par_prenom(arbre)["Chloe"].parent_id is None


def test_exclusion_par_prenom(arbre):
    rapport = construire(arbre, "@I1@", {normaliser("Paul")}, SEJOUR, 3, 12)
    assert rapport.exclus == ["Paul Martin"]
    assert "Paul" not in par_prenom(arbre, {normaliser("Paul")})


def test_exclusion_par_prenom_et_nom(arbre):
    rapport = construire(arbre, "@I1@", {normaliser("Paul Martin")}, SEJOUR, 3, 12)
    assert rapport.exclus == ["Paul Martin"]


def test_le_conjoint_restant_garde_les_enfants(arbre):
    """Paul exclu, Marie reste : Lea doit rester sous Marie, pas remonter."""
    gens = par_prenom(arbre, {normaliser("Paul")})
    assert gens["Lea"].parent_id == gens["Marie"].id
    assert gens["Marie"].conjoint_id is None


def test_exclure_tout_un_couple_fait_remonter_les_enfants(arbre):
    exclus = {normaliser("Paul"), normaliser("Marie")}
    gens = par_prenom(arbre, exclus)
    assert set(gens) == {"Lea", "Chloe"}
    assert gens["Lea"].parent_id is None


def test_les_droits_suivent_la_filiation(arbre):
    """Le pendant Python de private.personnes_modifiables."""
    c = couverture(arbre)
    assert c["Marie"] == {"Marie", "Paul", "Lea"}
    assert c["Paul"] == c["Marie"]   # le conjoint couvre autant
    assert c["Lea"] == {"Lea"}       # un enfant ne remonte pas
    assert c["Chloe"] == {"Chloe"}


def test_une_exclusion_qui_ne_correspond_a_personne_est_signalee(arbre):
    rapport = construire(arbre, "@I1@", {normaliser("Fantome")}, SEJOUR, 3, 12)
    assert rapport.exclusions_inutiles == ["fantome"]


def test_age_calcule_a_la_date_du_sejour(arbre):
    lea = arbre.individus["@I5@"]  # nee en septembre 2020
    assert categorie_age(lea, date(2027, 7, 10), 3, 12) == "enfant"
    assert categorie_age(lea, date(2022, 7, 10), 3, 12) == "bebe"
    assert categorie_age(lea, date(2040, 7, 10), 3, 12) == "adulte"


def test_anniversaire_pas_encore_passe(arbre):
    """Lea naît le 4 septembre : au 10 juillet elle n'a pas encore son age."""
    lea = arbre.individus["@I5@"]
    assert categorie_age(lea, date(2023, 7, 10), 3, 12) == "bebe"  # 2 ans
    assert categorie_age(lea, date(2023, 10, 10), 3, 12) == "enfant"  # 3 ans


def test_sans_date_de_naissance_on_compte_adulte_et_on_signale(arbre):
    louise = arbre.individus["@I2@"]
    assert louise.naissance is None
    assert categorie_age(louise, SEJOUR, 3, 12) == "adulte"

    rapport = construire(arbre, "@I1@", set(), SEJOUR, 3, 12)
    assert "Paul Martin" not in rapport.sans_date  # il a une annee seule


def test_date_gedcom_partielle(arbre):
    """`2 DATE 1963` sans jour ni mois reste exploitable."""
    assert arbre.individus["@I4@"].naissance == date(1963, 1, 1)


def test_recherche_insensible_aux_accents_et_a_la_casse(arbre):
    assert arbre.chercher("JACQUES durand") == ["@I1@"]
    assert arbre.chercher("chloe") == ["@I7@"]
    # Les accents sont retires des deux cotes : ecrire « Chloé » dans
    # exclusions.txt doit trouver le « Chloe » du GEDCOM, et inversement.
    assert arbre.chercher("Chloé") == ["@I7@"]


def test_exclusion_accentuee_trouve_un_prenom_sans_accent(arbre):
    rapport = construire(arbre, "@I1@", {normaliser("Chloé")}, SEJOUR, 3, 12)
    assert rapport.exclus == ["Chloe Durand"]
    assert rapport.exclusions_inutiles == []


def test_le_chef_de_branche_donne_le_nom_de_famille(arbre):
    gens = par_prenom(arbre)
    assert gens["Marie"].famille == "Marie"
    assert gens["Lea"].famille == "Marie"   # toute la branche partage le nom
    # Bruno est ecarte : c'est Chloe qui devient chef de sa branche, et donc
    # le nom sous lequel l'export regroupera ses totaux.
    assert gens["Chloe"].famille == "Chloe"


def test_les_participants_sont_prets_pour_supabase(arbre):
    """La forme envoyee a admin_importer doit etre exactement celle attendue."""
    attendu = {
        "id", "prenom", "famille", "categorie_age",
        "parent_id", "conjoint_id", "invite",
    }
    for participant in participants(arbre):
        assert set(participant.vers_json()) == attendu
        assert participant.invite is False
