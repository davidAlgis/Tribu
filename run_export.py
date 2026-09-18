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
from engine.pricing import charger_config, facturer
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
        personnes, presences = charger_json(args.input)
    else:
        url = os.environ.get("SUPABASE_URL")
        cle = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not cle:
            print("SUPABASE_URL et SUPABASE_SERVICE_KEY doivent etre definies.", file=sys.stderr)
            return 1
        personnes, presences = charger_supabase(url, cle)

    chemin_config = Path(args.config)
    if not chemin_config.exists():
        chemin_config = Path("config.example.toml")
        print(f"[info] {args.config} absent : utilisation de {chemin_config} (tarifs fictifs).")
    config = charger_config(chemin_config)

    prestations = calculer_prestations(presences)
    facturation = facturer(prestations, personnes, config)

    sortie = Path(args.out)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    exporter(sortie, personnes, prestations, facturation, config)

    print(f"{len(personnes)} personnes, {len(presences)} jours saisis")
    print(f"{len(prestations.nuitees)} nuitees, {len(prestations.repas_hors_pension)} repas hors pension")
    print(f"{len(prestations.anomalies)} anomalie(s), {len(facturation.tarifs_manquants)} tarif(s) manquant(s)")
    print(f"Total : {facturation.total} {config.get('meta', {}).get('devise', 'EUR')}")
    print(f"Export ecrit : {sortie}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
