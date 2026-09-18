# Tribu — POC

Remplacer le classeur Google Sheets du séjour familial par une chaîne
où **les règles métier n'existent qu'à un seul endroit**.

```
Formulaire (GitHub Pages)  →  Supabase  →  Python  →  Excel
     saisie des faits         stockage    calculs    export
```

Le principe qui tient tout le reste : **la base ne stocke que des faits
saisis** (où je dors, quels repas je prends). Aucun régime, aucun tarif,
aucun total n'y figure. Pensions, demi-pensions, repas hors pension,
suppléments et prix sont *dérivés* par le Python, dans
[`engine/rules.py`](engine/rules.py). Si l'hôtel change une règle, on
modifie ce fichier — pas la base, pas le formulaire, pas les exports.

## État du POC

Chaîne complète fonctionnelle, avec des données et des tarifs fictifs :
l'hôtel de l'an prochain n'est pas connu.

## Les règles implémentées

Une nuitée est rattachée au jour J où la personne se couche. Les repas
qu'elle englobe sont le dîner de J, puis le petit-déjeuner et le
déjeuner de J+1.

| Régime | Dîner J | Nuit J | Petit-déj. J+1 | Déjeuner J+1 |
|---|:-:|:-:|:-:|:-:|
| Pension complète | ✓ | ✓ | ✓ | ✓ |
| Demi-pension soir | ✓ | ✓ | ✓ | |
| Demi-pension midi | | ✓ | ✓ | ✓ |
| Nuit + petit-déjeuner | | ✓ | ✓ | |
| Nuit seule | | ✓ | | |

Tout repas non absorbé par un régime est facturé **hors pension** — y
compris pour une personne logée en chambre.

Les **gîtes** suivent une logique différente : la nuit est facturée,
aucun repas n'est inclus, donc tous les repas d'une personne en gîte
sont hors pension.

Trois hébergements seulement : `chambre`, `gite`, `exterieur` (présente
ce jour-là mais ne dort pas sur place). Une personne totalement absente
n'a simplement aucune ligne. Distinguer « absent » de « dort ailleurs »
n'apporte rien à la facturation et multiplie les erreurs de saisie.

## Utilisation locale

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

# les tests : le filet de sécurité des règles métier
.venv/Scripts/python.exe -m pytest -q

# l'export, à partir des données d'exemple
.venv/Scripts/python.exe run_export.py --source json --input exemple_donnees.json

# l'export réel, depuis Supabase
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_KEY="sb_secret_..."   # jamais dans le navigateur, jamais commitée
.venv/Scripts/python.exe run_export.py --source supabase --out exports/sejour.xlsx
```

Le classeur produit contient : synthèse hôtel (combien de chaque régime
par date), repas hors pension, détail par personne, total par famille,
**tarifs manquants** (la liste exacte des prix restant à négocier) et
anomalies de saisie.

## Mise en route

1. **Supabase** — créer un projet en région UE, puis coller
   [`supabase/schema.sql`](supabase/schema.sql) dans le SQL Editor.
2. **Clés** — reporter `Project URL` et la clé `anon public` dans
   [`config.js`](config.js), ainsi que les dates du séjour.
3. **Pages** — Settings → Pages → Deploy from a branch → `main` / `(root)`.
   Le formulaire est alors servi sur `https://<compte>.github.io/tribu/`.
4. **Tarifs** — copier `config.example.toml` en `config.toml` et le
   remplir quand l'hôtel sera connu. `config.toml` est dans le
   `.gitignore`.

## Sécurité

Le repo est public (contrainte de GitHub Pages en plan gratuit). Trois
règles en découlent :

- la clé `anon` dans `config.js` est publique **par conception** ; ce
  qui protège, c'est le RLS, qui n'autorise que l'insertion — pas la
  lecture, pas la modification, pas la suppression ;
- la clé secrète (`sb_secret_…`) ne doit **jamais** quitter ta machine ;
- les `.xlsx` générés ne sont jamais commités, et ne sont pas produits
  par GitHub Actions : sur un repo public, les artifacts d'Actions sont
  téléchargeables par n'importe qui.
