"""Pose sur chaque page l'empreinte des scripts et de la feuille de style
qu'elle charge.

    python versionner.py            # met les empreintes a jour
    python versionner.py --verifier # sort en erreur si l'une a vieilli

POURQUOI. Un navigateur met en cache la page et ses scripts SEPAREMENT. Il
peut donc servir l'admin.html d'aujourd'hui avec l'admin.js d'hier : le
script cherche un element que la page n'a plus, et l'onglet casse --
« can't access property "textContent", compteurFacture is null ». Le
code etait juste ; c'est le melange qui ne l'etait pas.

`./admin.js?v=3f9c2a71b0` : l'adresse change des que le contenu change.
Une page a jour reclame donc le script a jour, que le navigateur n'a pas
encore, et va le chercher. Une page perimee reclame l'ancien, qu'elle
trouve en cache : les deux restent d'accord, toujours.

L'EMPREINTE PORTE SUR LE CONTENU, fins de ligne ramenees a LF : le meme
fichier n'a pas la meme forme sur un poste Windows (CRLF) et sur GitHub
(LF), et il doit avoir la meme empreinte -- sans quoi la verification
echouerait d'un cote ou de l'autre.

`tests/test_pages.py` appelle `--verifier` : un script modifie sans
relancer ce fichier fait echouer la suite, avant le push.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent

# Ce qu'une page charge depuis le site lui-meme : `./nom.js`, `./nom.css`,
# avec ou sans empreinte deja posee.
MOTIF = re.compile(r'((?:src|href)="\./)([\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]*)?(")')


def empreinte(nom: str) -> str:
    contenu = (RACINE / nom).read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(contenu).hexdigest()[:10]


def versionner(html: str) -> str:
    return MOTIF.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={empreinte(m.group(2))}{m.group(3)}", html)


def pages() -> list[Path]:
    return sorted(RACINE.glob("*.html"))


def perimees() -> list[str]:
    """Les pages dont une empreinte ne correspond plus a son fichier."""
    return [p.name for p in pages() if versionner(p.read_text(encoding="utf-8")) != p.read_text(encoding="utf-8")]


def main() -> int:
    if "--verifier" in sys.argv:
        vieilles = perimees()
        if vieilles:
            print("Empreintes perimees : " + ", ".join(vieilles) + " -- lancer `python versionner.py`.")
            return 1
        print("Empreintes a jour.")
        return 0

    for page in pages():
        avant = page.read_bytes()
        texte = avant.decode("utf-8")
        apres = versionner(texte)
        if apres != texte:
            # On garde les fins de ligne du fichier tel qu'il est.
            page.write_bytes(apres.encode("utf-8"))
            print(f"{page.name} : empreintes mises a jour")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
