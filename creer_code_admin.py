"""Fabrique le code organisateur sans qu'il touche jamais Supabase ni le dépôt.

    python creer_code_admin.py

Le code est tiré au hasard **sur cette machine**, affiché une fois, puis
oublié. Seule son empreinte SHA-256 part dans le SQL à coller.

POURQUOI NE PAS SIMPLEMENT CHOISIR UN CODE ET L'ÉCRIRE DANS LE SQL

Trois raisons, dans l'ordre d'importance :

  1. L'éditeur SQL de Supabase **conserve l'historique des requêtes**.
     Un code tapé là y reste, lisible par quiconque ouvre le projet.
  2. Stocké en clair, il apparaîtrait dans n'importe quel export ou
     sauvegarde de la base.
  3. Un code choisi par un humain est devinable. Tiré au hasard sur
     24 caractères, il ne l'est plus.

Ici, le SQL affiché ne contient qu'un sel et une empreinte : même en le
lisant intégralement, on n'en déduit pas le code.

OÙ RANGER LE CODE

Dans un gestionnaire de mots de passe. Pas dans un fichier du projet, pas
dans un carnet, pas dans un message que tu t'envoies — il n'a aucune
raison de se trouver ailleurs que là et dans ta tête au moment où tu le
tapes sur admin.html.

Et surtout pas dans l'éditeur SQL de Supabase, y compris pour le vérifier :
`select private.code_admin_valide('...')` l'y écrirait en clair, et
l'historique le garderait — c'est précisément ce que tout le dispositif
ci-dessus sert à éviter. La vérification se fait sur `admin.html`, qui est
faite pour ça et qui ne laisse aucune trace côté serveur.

Perdu, il ne se retrouve pas : on en refabrique un, ce script prend dix
secondes.
"""

from __future__ import annotations

import argparse
import hashlib
import secrets
import sys

# Sans I, l, 1, O, 0 : le code sera parfois relu a l'ecran, autant eviter
# les caracteres qu'on confond.
ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def tirer_code(longueur: int) -> str:
    """`secrets`, et non `random` : ce dernier est previsible."""
    return "".join(secrets.choice(ALPHABET) for _ in range(longueur))


def empreinte(sel: str, code: str) -> str:
    """Doit reproduire exactement le calcul de private.code_admin_valide."""
    return hashlib.sha256((sel + code).encode("utf-8")).hexdigest()


def grouper(code: str, par: int = 6) -> str:
    """Un code affiche par paquets se relit et se recopie sans faute.

    Seulement pour un code tire au hasard : sur un code choisi, qui a ses
    propres separateurs, le decoupage brouillerait la lecture.
    """
    if not code.isalnum():
        return code
    return " ".join(code[i : i + par] for i in range(0, len(code), par))


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--longueur", type=int, default=24)
    parseur.add_argument(
        "--code",
        help="imposer un code au lieu d'en tirer un (deconseille : "
        "un code choisi par un humain se devine)",
    )
    args = parseur.parse_args()

    if args.longueur < 16:
        print("Moins de 16 caracteres : refuse, c'est le seul secret qui", file=sys.stderr)
        print("protege la liste des participants.", file=sys.stderr)
        return 1

    code = args.code or tirer_code(args.longueur)
    sel = secrets.token_hex(16)

    largeur = 68
    print("=" * largeur)
    print("  TON CODE ORGANISATEUR — affiche une seule fois")
    print("=" * largeur)
    print()
    print(f"      {grouper(code)}")
    print()
    print("  Range-le tout de suite dans ton gestionnaire de mots de passe.")
    print("  Les espaces sont decoratifs : ne les tape pas.")
    print()
    print("=" * largeur)
    print("  À COLLER DANS SUPABASE — SQL Editor, apres schema.sql")
    print("=" * largeur)
    print()
    print("delete from private.acces_admin;")
    print("insert into private.acces_admin (sel, empreinte) values")
    print(f"  ('{sel}',")
    print(f"   '{empreinte(sel, code)}');")
    print()
    print("-" * largeur)
    print("  Ce SQL ne contient pas le code : ni l'historique de l'editeur")
    print("  Supabase, ni une sauvegarde de la base ne le revelera.")
    print()
    print("  Pour verifier qu'il fonctionne : ouvre admin.html et tape-le.")
    print("  Surtout pas `select private.code_admin_valide('...')` dans")
    print("  l'editeur SQL -- ce serait ecrire le code exactement la ou tout")
    print("  ce qui precede s'applique a ne pas le mettre.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
