"""Le code organisateur est-il fabrique solidement ?

L'empreinte calculee ici doit correspondre EXACTEMENT a celle que Postgres
recalcule dans `private.code_admin_valide` :

    encode(digest(sel || code, 'sha256'), 'hex')

Le moindre ecart — un encodage, un separateur, une normalisation — rendrait
le code valide ici et refuse la-bas, sans rien dire de plus qu'un « code
incorrect ». D'ou les valeurs figees ci-dessous.
"""

import hashlib

import pytest

from creer_code_admin import ALPHABET, empreinte, grouper, tirer_code


def test_empreinte_est_sha256_de_sel_puis_code():
    """La formule, pinnee : c'est le contrat avec le SQL."""
    attendu = hashlib.sha256(b"abc123" + b"MonCode").hexdigest()
    assert empreinte("abc123", "MonCode") == attendu


def test_empreinte_sur_une_valeur_connue():
    """Un vecteur fixe, pour qu'un refactor ne puisse pas deriver en silence."""
    assert empreinte("", "") == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_le_sel_change_l_empreinte():
    """Sans sel, deux bases avec le meme code auraient la meme empreinte."""
    assert empreinte("sel-a", "code") != empreinte("sel-b", "code")


def test_l_empreinte_distingue_la_casse():
    """Le code organisateur n'est PAS normalise : il se copie, il ne se dicte pas."""
    assert empreinte("sel", "MonCode") != empreinte("sel", "moncode")


def test_l_empreinte_gere_les_accents():
    """Un code impose peut contenir n'importe quoi : l'UTF-8 doit passer."""
    assert len(empreinte("sel", "clé-à-café")) == 64


def test_le_code_tire_a_la_bonne_longueur():
    assert len(tirer_code(24)) == 24


def test_le_code_evite_les_caracteres_confondables():
    """Ni I, l, 1, O, 0 : le code sera parfois relu a l'ecran."""
    for interdit in "Il1O0":
        assert interdit not in ALPHABET


def test_deux_tirages_different():
    """Preuve rudimentaire que le tirage n'est pas constant."""
    assert len({tirer_code(24) for _ in range(20)}) == 20


def test_l_entropie_est_suffisante():
    """24 caracteres sur 57 : au-dela de 128 bits, la force brute est hors jeu."""
    import math

    bits = 24 * math.log2(len(ALPHABET))
    assert bits > 128


@pytest.mark.parametrize(
    "code, attendu",
    [
        ("abcdefghij", "abcdef ghij"),  # tire au hasard : groupe
        ("mon-code-a-moi", "mon-code-a-moi"),  # impose : laisse tel quel
    ],
)
def test_affichage_groupe_seulement_les_codes_tires(code, attendu):
    assert grouper(code) == attendu
