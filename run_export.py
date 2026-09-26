"""Point d'entree : lit les faits, calcule, ecrit l'Excel.

    python run_export.py --source json --input exemple_donnees.json
    python run_export.py --source supabase          # lit SUPABASE_URL / SUPABASE_SERVICE_KEY
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from engine.export_xlsx import exporter
from engine.pricing import charger_config, facturer, grille_depuis
from engine.rules import calculer_prestations
from engine.source import charger_json, charger_supabase


def main() -> int:
    parseur = argparse.ArgumentParser(description="Genere l'export Excel du sejour.")
    parseur.add_argument("--source", choices=["json", "supabase"], default="json")
    parseur.add_argument("--input", default="exemple_donnees.json")
    parseur.add_argument("--config", default="config.toml")
    parseur.add_argument("--out", default="exports/sejour.xlsx")
    args = parseur.parse_args()

    if args.source == "json":
        personnes, presences, brute = charger_json(args.input)
    else:
        url = os.environ.get("SUPABASE_URL")
        cle = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not cle:
            print("SUPABASE_URL et SUPABASE_SERVICE_KEY doivent etre definies.", file=sys.stderr)
            return 1
        personnes, presences, brute = charger_supabase(url, cle)

    # `config.toml` ne porte plus de prix : le nom du sejour et la devise.
    # Les tarifs viennent de la base, ou du bloc `grille` du fichier JSON.
    chemin_config = Path(args.config)
    if not chemin_config.exists():
        chemin_config = Path("config.example.toml")
        print(f"[info] {args.config} absent : utilisation de {chemin_config}.")
    try:
        config = charger_config(chemin_config)
    except ModuleNotFoundError:
        # `tomllib` demande Python 3.11. Depuis que les prix sont en base,
        # ce fichier ne porte que le nom du sejour et la devise : s'en
        # passer coute deux libelles, pas un tarif.
        print("[info] Python < 3.11 : config.toml non lu (nom et devise par defaut).")
        config = {}

    grille = grille_depuis(brute)
    prestations = calculer_prestations(presences)
    facturation = facturer(prestations, personnes, grille)

    sortie = Path(args.out)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    exporter(sortie, personnes, prestations, facturation, config)

    print(f"{len(personnes)} personnes, {len(presences)} jours saisis")
    print(f"{len(prestations.nuitees)} nuitees, {len(prestations.repas_hors_pension)} repas hors pension")
    print(f"{len(prestations.anomalies)} anomalie(s), {len(facturation.tarifs_manquants)} tarif(s) manquant(s)")
    if facturation.sans_place:
        print(f"{len(facturation.sans_place)} nuit(s) en gite sans place attribuee : "
              "le plan de couchage dira avec qui la note se partage.")
    print(f"Total : {facturation.total} {config.get('meta', {}).get('devise', 'EUR')}")
    print(f"Export ecrit : {sortie}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
