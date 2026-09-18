"""Fabrique `carte.js` : les contours des départements, prêts à dessiner.

    python preparer_carte.py

À lancer une seule fois — le résultat est versionné, il n'y a aucune donnée
personnelle dans une carte de France. Relancer ne sert qu'à changer le
niveau de détail.

CE QUE FAIT CE SCRIPT

Il télécharge les frontières officielles (france-geojson, dérivé de l'IGN),
garde la métropole, projette les coordonnées en pixels, simplifie les
tracés, et écrit un fichier JavaScript de tracés SVG.

POURQUOI PRÉ-CALCULER PLUTÔT QUE CHARGER LE GEOJSON

Le GeoJSON simplifié pèse 570 Ko et demanderait au navigateur de projeter
40 000 points à chaque ouverture de page. En sortie d'ici, c'est un fichier
cinq fois plus léger que le navigateur se contente d'afficher.

LA PROJECTION

Une conique conforme de Lambert serait plus juste, mais sur une carte qu'on
touche du doigt pour dire « pas par là », l'écart ne se voit pas. Une
équirectangulaire corrigée du cosinus de la latitude moyenne suffit, et
tient en trois lignes qu'on peut relire.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

SOURCE = (
    "https://raw.githubusercontent.com/gregoiredavid/france-geojson"
    "/master/departements-version-simplifiee.geojson"
)
SORTIE = Path("carte.js")

# Une quarantaine de reperes suffisent a se situer : assez pour reconnaitre
# une region d'un coup d'oeil, assez peu pour ne pas noircir la carte.
VILLES = [
    ("Paris", 48.8566, 2.3522), ("Marseille", 43.2965, 5.3698),
    ("Lyon", 45.7640, 4.8357), ("Toulouse", 43.6047, 1.4442),
    ("Nice", 43.7102, 7.2620), ("Nantes", 47.2184, -1.5536),
    ("Montpellier", 43.6108, 3.8767), ("Strasbourg", 48.5734, 7.7521),
    ("Bordeaux", 44.8378, -0.5792), ("Lille", 50.6292, 3.0573),
    ("Rennes", 48.1173, -1.6778), ("Reims", 49.2583, 4.0317),
    ("Toulon", 43.1242, 5.9280), ("Saint-Etienne", 45.4397, 4.3872),
    ("Le Havre", 49.4944, 0.1079), ("Grenoble", 45.1885, 5.7245),
    ("Dijon", 47.3220, 5.0415), ("Angers", 47.4784, -0.5632),
    ("Nimes", 43.8367, 4.3601), ("Clermont-Ferrand", 45.7772, 3.0870),
    ("Brest", 48.3904, -4.4861), ("Tours", 47.3941, 0.6848),
    ("Amiens", 49.8941, 2.2958), ("Limoges", 45.8336, 1.2611),
    ("Annecy", 45.8992, 6.1294), ("Perpignan", 42.6887, 2.8948),
    ("Besancon", 47.2378, 6.0241), ("Metz", 49.1193, 6.1757),
    ("Orleans", 47.9029, 1.9093), ("Rouen", 49.4432, 1.0999),
    ("Mulhouse", 47.7508, 7.3359), ("Caen", 49.1829, -0.3707),
    ("Nancy", 48.6921, 6.1844), ("Poitiers", 46.5802, 0.3404),
    ("La Rochelle", 46.1591, -1.1520), ("Bayonne", 43.4933, -1.4748),
    ("Pau", 43.2951, -0.3708), ("Ajaccio", 41.9192, 8.7386),
    ("Chambery", 45.5646, 5.9178), ("Avignon", 43.9493, 4.8055),
    ("Lorient", 47.7483, -3.3702), ("Troyes", 48.2973, 4.0744),
    ("Bourges", 47.0810, 2.3988), ("Valence", 44.9333, 4.8924),
]

LATITUDE_MOYENNE = 46.5  # le milieu de la France metropolitaine
LARGEUR = 1000           # le viewBox, en unites arbitraires
TOLERANCE = 1.8         # en unites du viewBox : au-dela, le trait se casse


def metropole(code: str) -> bool:
    """Ecarte l'outre-mer : sans cela, la France tiendrait dans un timbre."""
    return code in ("2A", "2B") or (code.isdigit() and 1 <= int(code) <= 95)


def projeter(lon: float, lat: float) -> tuple[float, float]:
    return lon * math.cos(math.radians(LATITUDE_MOYENNE)), -lat


def _distance_au_segment(p, a, b) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplifier(points: list, tolerance: float) -> list:
    """Douglas-Peucker : garde les points qui portent la forme."""
    if len(points) < 3:
        return points

    pire, indice = 0.0, 0
    for i in range(1, len(points) - 1):
        d = _distance_au_segment(points[i], points[0], points[-1])
        if d > pire:
            pire, indice = d, i

    if pire <= tolerance:
        return [points[0], points[-1]]

    gauche = simplifier(points[: indice + 1], tolerance)
    droite = simplifier(points[indice:], tolerance)
    return gauche[:-1] + droite


def anneaux(geometrie: dict) -> list:
    if geometrie["type"] == "Polygon":
        return geometrie["coordinates"]
    return [anneau for poly in geometrie["coordinates"] for anneau in poly]


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    print(f"Telechargement de {SOURCE.rsplit('/', 1)[-1]}...")
    with urllib.request.urlopen(SOURCE, timeout=120) as reponse:
        donnees = json.loads(reponse.read().decode("utf-8"))

    retenus = [
        f for f in donnees["features"] if metropole(f["properties"]["code"])
    ]
    print(f"{len(retenus)} departements metropolitains sur {len(donnees['features'])}")

    # Premiere passe : projeter et mesurer l'emprise.
    bruts = []
    xs, ys = [], []
    for feature in retenus:
        contours = []
        for anneau in anneaux(feature["geometry"]):
            points = [projeter(lon, lat) for lon, lat, *_ in anneau]
            contours.append(points)
            xs += [p[0] for p in points]
            ys += [p[1] for p in points]
        bruts.append((feature["properties"], contours))

    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    echelle = LARGEUR / (xmax - xmin)
    hauteur = round((ymax - ymin) * echelle)

    # Seconde passe : mettre a l'echelle, simplifier, ecrire les traces.
    departements = []
    points_avant = points_apres = 0
    for proprietes, contours in sorted(bruts, key=lambda b: b[0]["code"]):
        morceaux = []
        for points in contours:
            mis_a_echelle = [
                ((x - xmin) * echelle, (y - ymin) * echelle) for x, y in points
            ]
            points_avant += len(mis_a_echelle)
            # Un ilot minuscule simplifie a l'exces disparait : on ne garde
            # que les contours qui survivent avec au moins un triangle.
            reduits = simplifier(mis_a_echelle, TOLERANCE)
            if len(reduits) < 4:
                continue
            points_apres += len(reduits)
            trace = " ".join(
                f"{'M' if i == 0 else 'L'}{x:.1f} {y:.1f}"
                for i, (x, y) in enumerate(reduits)
            )
            morceaux.append(trace + "Z")

        if morceaux:
            departements.append(
                {
                    "c": proprietes["code"],
                    "n": proprietes["nom"],
                    "d": "".join(morceaux),
                }
            )

    # Les villes passent par la MEME projection que les contours : c'est la
    # seule facon de garantir qu'un point tombe dans le bon departement.
    villes = []
    for nom, lat, lon in sorted(VILLES):
        x, y = projeter(lon, lat)
        villes.append(
            {
                "n": nom,
                "x": round((x - xmin) * echelle, 1),
                "y": round((y - ymin) * echelle, 1),
            }
        )

    contenu = (
        "// FICHIER GENERE par preparer_carte.py — ne pas editer a la main.\n"
        "// Contours des departements metropolitains, projetes et simplifies,\n"
        "// et quelques villes pour se reperer.\n"
        "// Source : france-geojson (derive de l'IGN), licence ouverte.\n"
        f"window.CARTE = {{\n"
        f'  viewBox: "0 0 {LARGEUR} {hauteur}",\n'
        f"  villes: "
        + json.dumps(villes, ensure_ascii=False, separators=(",", ":"))
        + ",\n  departements: "
        + json.dumps(departements, ensure_ascii=False, separators=(",", ":"))
        + "\n};\n"
    )
    SORTIE.write_text(contenu, encoding="utf-8")

    taille = SORTIE.stat().st_size
    print(
        f"{len(departements)} departements, "
        f"{points_avant} points ramenes a {points_apres} "
        f"({100 - 100 * points_apres // points_avant} % en moins)"
    )
    print(f"{len(villes)} villes reperes")
    print(f"{SORTIE} : {taille // 1024} Ko")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
