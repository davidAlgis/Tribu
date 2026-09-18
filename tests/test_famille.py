"""Le fichier famille.txt decrit-il bien la famille qu'on croit ?

Ces tests portent sur la traduction texte -> arbre -> droits. Ils sont le
pendant Python de la fonction SQL `private.personnes_modifiables` : si les
deux divergent un jour, c'est ici qu'on s'en apercoit.
"""

import pytest

from generer_participants import analyser, portee, vers_sql

ARBRE = """
## Durand

Gerard + Simone
── Sylvain + Nadia
──── Louise (enfant)
── Simon
"""


def lire(texte):
    lecture = analyser(texte)
    assert lecture.erreurs == []
    return lecture


def couverture(texte):
    """{prenom: set des prenoms qu'il peut modifier}"""
    personnes = lire(texte).personnes
    par_id = {p.id: p for p in personnes}
    return {
        p.prenom: {par_id[i].prenom for i in portee(personnes, p.id)} for p in personnes
    }


def test_indentation_donne_la_filiation():
    c = couverture(ARBRE)
    assert c["Sylvain"] == {"Sylvain", "Nadia", "Louise"}


def test_un_grand_parent_couvre_toute_sa_descendance():
    c = couverture(ARBRE)
    assert c["Gerard"] == {"Gerard", "Simone", "Sylvain", "Nadia", "Simon", "Louise"}


def test_le_conjoint_du_grand_parent_couvre_autant():
    """Simone n'est parent de personne : elle passe par Gerard."""
    c = couverture(ARBRE)
    assert c["Simone"] == c["Gerard"]


def test_un_frere_n_a_aucun_droit_sur_son_frere():
    c = couverture(ARBRE)
    assert c["Simon"] == {"Simon"}


def test_un_enfant_ne_remonte_pas_vers_ses_parents():
    c = couverture(ARBRE)
    assert c["Louise"] == {"Louise"}


def test_les_deux_membres_d_un_couple_couvrent_les_memes_enfants():
    """Le SQL ne rattache l'enfant qu'a UN parent : l'autre passe par le couple."""
    c = couverture(ARBRE)
    assert c["Nadia"] == c["Sylvain"]


def test_sans_plus_le_couple_n_existe_pas():
    """Le piege du format : deux lignes de meme niveau sont freres et soeurs.

    C'est precisement pourquoi les couples doivent etre marques : sans `+`,
    Sylvain perd ses propres enfants.
    """
    c = couverture("Gerard\n── Sylvain\n── Nadia\n──── Louise\n")
    assert c["Sylvain"] == {"Sylvain"}
    assert c["Nadia"] == {"Nadia", "Louise"}


def test_categorie_age_et_valeur_par_defaut():
    personnes = {p.prenom: p for p in lire(ARBRE).personnes}
    assert personnes["Louise"].categorie_age == "enfant"
    assert personnes["Gerard"].categorie_age == "adulte"


def test_accents_dans_la_categorie():
    personnes = {p.prenom: p for p in lire("Zoe (bébé)\n").personnes}
    assert personnes["Zoe"].categorie_age == "bebe"


def test_nom_de_famille_explicite_puis_implicite():
    personnes = {p.prenom: p for p in lire(ARBRE).personnes}
    assert personnes["Louise"].famille == "Durand"

    sans_entete = {p.prenom: p for p in lire("Marthe\n── Paul\n").personnes}
    assert sans_entete["Paul"].famille == "Marthe"


def test_prenoms_identiques_restent_deux_personnes():
    """Les identifiants sont des UUID : l'unicite des prenoms n'est pas requise."""
    personnes = lire("Jean\n── Marie\nPaul\n── Marie\n").personnes
    marie = [p for p in personnes if p.prenom == "Marie"]
    assert len(marie) == 2
    assert marie[0].id != marie[1].id
    assert marie[0].parent != marie[1].parent


def test_saut_de_generation_avertit_mais_rattache():
    lecture = analyser("Robert\n──── Jeanne\n")
    assert lecture.erreurs == []
    assert len(lecture.avertissements) == 1
    assert "saut de generation" in lecture.avertissements[0]
    assert lecture.personnes[1].parent == lecture.personnes[0].id


def test_ligne_indentee_sans_ancetre_est_une_erreur():
    assert analyser("── Orphelin\n").erreurs


def test_categorie_inconnue_est_une_erreur():
    assert analyser("Jean (ado)\n").erreurs


def test_commentaires_et_lignes_vides_ignores():
    assert len(lire("# rien\n\nJean\n\n# encore rien\n").personnes) == 1


@pytest.mark.parametrize("prenom", ["Marie-Claire", "Noëlle", "Éloi"])
def test_prenoms_composes_et_accentues_acceptes(prenom):
    assert lire(f"{prenom}\n").personnes[0].prenom == prenom


def test_apostrophe_echappee_dans_le_sql():
    """Sans echappement, un prenom comme N'Golo casserait la requete."""
    sql = vers_sql(lire("N'Golo\n").personnes, "test.txt")
    assert "'N''Golo'" in sql


def test_le_sql_remplace_la_liste_en_un_seul_insert():
    personnes = lire(ARBRE).personnes
    sql = vers_sql(personnes, "test.txt")

    assert "delete from private.participants;" in sql
    assert sql.count("insert into private.participants") == 1
    # Chaque personne produit une ligne, et son identifiant y figure.
    for personne in personnes:
        assert personne.id in sql
