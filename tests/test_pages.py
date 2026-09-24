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

# --- Les onglets de la page organisateur ---------------------------------
#
# Le motif ARIA des onglets tient a trois choses qui doivent rester
# d'accord : le bouton designe son volet, le volet designe son bouton, et
# un seul des deux est ouvert. Casser l'une des trois ne se voit pas a
# l'oeil -- la page a l'air normale, elle ment seulement au lecteur
# d'ecran, ou montre deux volets a la fois.

BOUTON_ONGLET = re.compile(r"<button[^>]*role=\"tab\"[^>]*>", re.S)
VOLET = re.compile(r"<div[^>]*role=\"tabpanel\"[^>]*>", re.S)


def attribut(balise: str, nom: str) -> str | None:
    trouve = re.search(nom + r'="([^"]*)"', balise)
    return trouve.group(1) if trouve else None


@pytest.fixture(scope="module")
def admin(pages):
    return pages["admin.html"][0]


def test_chaque_onglet_et_son_volet_se_designent(admin):
    """Le bouton nomme le volet, le volet renomme le bouton. L'un sans
    l'autre, et le lecteur d'ecran annonce un onglet sans contenu."""
    onglets = BOUTON_ONGLET.findall(admin)
    volets = VOLET.findall(admin)
    assert len(onglets) == len(volets) >= 2, "autant de boutons que de volets"

    par_id = {attribut(v, "id"): v for v in volets}
    for bouton in onglets:
        vise = attribut(bouton, "aria-controls")
        assert vise in par_id, f"onglet sans volet : {vise}"
        assert attribut(par_id[vise], "aria-labelledby") == attribut(bouton, "id")


def test_un_seul_onglet_est_ouvert_au_chargement(admin):
    """Deux `aria-selected="true"`, et la page s'ouvre sur deux volets
    empiles -- exactement ce que les onglets devaient supprimer."""
    ouverts = [b for b in BOUTON_ONGLET.findall(admin)
               if attribut(b, "aria-selected") == "true"]
    assert len(ouverts) == 1, f"{len(ouverts)} onglet(s) marques ouverts"

    visibles = [v for v in VOLET.findall(admin) if "hidden" not in v]
    assert len(visibles) == 1, f"{len(visibles)} volet(s) visibles"
    assert attribut(visibles[0], "id") == attribut(ouverts[0], "aria-controls")


def test_le_parcours_clavier_ne_traverse_pas_la_rangee(admin):
    """`tabindex="-1"` sur tous sauf un : sans lui, la tabulation passe par
    les six boutons avant d'atteindre le contenu."""
    onglets = BOUTON_ONGLET.findall(admin)
    atteignables = [b for b in onglets if attribut(b, "tabindex") != "-1"]
    assert len(atteignables) == 1, f"{len(atteignables)} onglets atteignables"
    assert attribut(atteignables[0], "aria-selected") == "true"


def test_le_code_organisateur_est_lisible_par_un_gestionnaire(admin):
    """Un formulaire a un seul champ de mot de passe n'est ni enregistre ni
    rempli par la plupart des gestionnaires : il leur manque l'identifiant
    sous lequel classer l'entree."""
    assert 'autocomplete="current-password"' in admin
    assert 'autocomplete="username"' in admin
    assert 'class="hors-ecran"' in admin

    # Et ce champ doit rester HORS ÉCRAN, jamais `display:none` : ces outils
    # ignorent délibérément les champs cachés ainsi, un champ caché étant le
    # motif classique du piège. C'est la règle CSS qui en décide.
    style = (RACINE / "style.css").read_text(encoding="utf-8")
    regle = re.search(r"\.hors-ecran\s*\{([^}]*)\}", style)
    assert regle, "la classe .hors-ecran a disparu de style.css"
    assert "position: absolute" in regle.group(1)
    assert "display" not in regle.group(1)


def test_chaque_message_d_etat_porte_une_couleur():
    """Un refus affiché dans la couleur du texte courant se lit comme une
    phrase ordinaire.

    Chaque panneau a fini par avoir son propre paragraphe d'état —
    `#message-sejour`, `#message-lieux`, `#message-couchages`… — et la règle
    d'origine ne visait que `#message`. Le test liste les identifiants tels
    qu'ils sont dans les pages, et vérifie qu'un sélecteur les atteint.
    """
    style = (RACINE / "style.css").read_text(encoding="utf-8")
    prefixes = re.findall(r'\[id\^="([^"]+)"\]\.erreur', style)
    nommes = set(re.findall(r"#([\w-]+)\.erreur", style))

    orphelins = []
    for page in PAGES:
        html = (RACINE / page).read_text(encoding="utf-8")
        for ident in re.findall(r'\bid="(message[\w-]*)"', html):
            atteint = ident in nommes or any(ident.startswith(p) for p in prefixes)
            if not atteint:
                orphelins.append(f"{page}#{ident}")
    assert sorted(set(orphelins)) == [], "paragraphes d'état sans couleur d'erreur"
