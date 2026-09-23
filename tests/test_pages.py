"""Les pages et leurs scripts se parlent-ils encore ?

Le lien entre une page et son script tient à des chaînes de caractères :
`getElementById("sous-titre")` d'un côté, `id="sous-titre"` de l'autre.
Rien ne les rapproche avant l'exécution.

Retirer un paragraphe devenu inutile est un geste anodin. Si un script y
écrivait, la page ne casse pas au chargement : elle casse plus tard, à la
première saisie, chez quelqu'un d'autre. Et un `aria-describedby` qui
pointe dans le vide ne se voit jamais — sauf d'un lecteur d'écran.

Ces tests lisent le HTML et le JS et vérifient que chaque référence
atterrit quelque part.
"""

import re
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent

# Chaque page et le script qui la pilote. `config.js` et `carte.js` ne
# touchent pas au DOM.
PAGES = {
    "index.html": "app.js",
    "dates.html": "dates.js",
    "lieux.html": "lieux.js",
    "admin.html": "admin.js",
}


def identifiants(html: str) -> set[str]:
    return set(re.findall(r'\bid="([^"]+)"', html))


@pytest.fixture(scope="module")
def pages():
    return {
        page: (
            (RACINE / page).read_text(encoding="utf-8"),
            (RACINE / script).read_text(encoding="utf-8"),
        )
        for page, script in PAGES.items()
    }


@pytest.mark.parametrize("page", sorted(PAGES))
def test_chaque_getElementById_trouve_sa_cible(page, pages):
    """Un identifiant absent ne casse rien au chargement : il casse à la
    première ligne qui touche l'élément, donc après une saisie."""
    html, js = pages[page]
    presents = identifiants(html)
    demandes = set(re.findall(r'getElementById\("([^"]+)"\)', js))
    assert demandes, f"{page} : aucun getElementById trouvé, le test ne sert à rien"
    assert sorted(demandes - presents) == [], f"{page} ne contient pas ces identifiants"


@pytest.mark.parametrize("page", sorted(PAGES))
def test_les_liens_aria_pointent_quelque_part(page, pages):
    """`aria-describedby` et `aria-controls` nomment un élément. Dans le
    vide, ils ne disent rien à un lecteur d'écran — en silence."""
    html, _ = pages[page]
    presents = identifiants(html)
    vises = set()
    for attribut in ("aria-describedby", "aria-controls", "aria-labelledby"):
        for valeur in re.findall(attribut + r'="([^"]+)"', html):
            vises.update(valeur.split())
    assert sorted(vises - presents) == [], f"{page} : liens ARIA sans cible"


@pytest.mark.parametrize("page", sorted(PAGES))
def test_chaque_label_designe_un_champ(page, pages):
    """Un `<label for>` sans cible ne donne pas le focus au champ, et ne
    l'annonce pas non plus."""
    html, _ = pages[page]
    presents = identifiants(html)
    cibles = set(re.findall(r'<label[^>]*\bfor="([^"]+)"', html))
    assert sorted(cibles - presents) == [], f"{page} : labels sans champ"


@pytest.mark.parametrize("page", sorted(PAGES))
def test_les_identifiants_sont_uniques(page, pages):
    """Deux fois le même identifiant, et `getElementById` n'en voit qu'un —
    lequel dépend de l'ordre du document."""
    html, _ = pages[page]
    tous = re.findall(r'\bid="([^"]+)"', html)
    doublons = sorted({i for i in tous if tous.count(i) > 1})
    assert doublons == [], f"{page} : identifiants en double"


def test_les_trois_pages_familiales_portent_le_menu(pages):
    """Le menu se pose à la main dans chaque page : une page ajoutée sans
    lui serait un cul-de-sac."""
    for page in ("index.html", "dates.html", "lieux.html"):
        html, _ = pages[page]
        assert 'class="menu"' in html, f"{page} n'a pas le menu principal"
        for cible in ("./lieux.html", "./dates.html", "./index.html"):
            assert cible in html, f"{page} ne renvoie pas vers {cible}"


def test_une_seule_page_est_marquee_courante(pages):
    """`aria-current` dit où l'on est. Deux marques, ou aucune, et le menu
    ment."""
    for page in ("index.html", "dates.html", "lieux.html"):
        html, _ = pages[page]
        marques = re.findall(r'<a href="\./([^"]+)"[^>]*aria-current="page"', html)
        assert marques == [page], f"{page} : marquage courant = {marques}"
