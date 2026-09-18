# Tribu

Organiser un séjour familial : qui vient, quelles nuits, quels repas, et ce
que ça coûte.

```
Formulaire (GitHub Pages)  →  Supabase  →  Python  →  Excel
     saisie des faits         stockage    calculs    export
```

La base ne stocke que des **faits** (où je dors, quels repas je prends).
Pensions, tarifs et totaux sont recalculés par
[`engine/rules.py`](engine/rules.py), seul endroit où vivent les règles.
Les Excel ne sont qu'une sortie : plus une seule formule à maintenir.

---

## Ajouter des participants

La liste vient du **fichier GEDCOM** de la généalogie, qui contient déjà
les couples, la filiation et les dates de naissance.

```bash
python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom" --generer
```

`--racine` est l'ancêtre dont on prend la descendance. Colle ensuite le
`participants.sql` produit dans **Supabase → SQL Editor**.

Sont déduits sans rien saisir : les couples, la filiation (donc les droits
de modification), la catégorie d'âge calculée à la date du séjour, et les
personnes décédées, écartées d'office. Le script signale celles **sans date
de naissance** : elles passent adultes, donc au plein tarif.

<details>
<summary>Ajouter quelqu'un absent de la généalogie</summary>

`famille.txt` est un fichier texte ordinaire :

```
## Durand
Gerard + Simone
── Sylvain + Nadia
──── Louise (enfant)
── Simon
```

Deux tirets par génération, `+` pour un couple, `(enfant)` ou `(bebe)` en
fin de ligne. Relance ensuite `python generer_participants.py`.

**Le `+` n'est pas décoratif** : deux lignes de même niveau sans `+` sont
frère et sœur, et un parent non marqué perd le droit de modifier ses
propres enfants.

⚠️ Une retouche manuelle est **écrasée au prochain import** (sauvegarde en
`.bak`). Pour un changement durable, corrige le GEDCOM.
</details>

## Retirer des participants

Une ligne par personne dans `exclusions.txt`, puis relance l'import.
Accents et casse indifférents ; les décédés sont déjà écartés.

```
Sylvain
Nadia Martin
```

Fichier séparé parce que `famille.txt` est régénéré à chaque import. Une
exclusion qui ne correspond à personne est signalée — ça rattrape les
fautes de frappe.

**Retirer quelqu'un ne coupe pas la branche** : ses enfants remontent d'un
cran vers leur grand-parent, ou restent sous son conjoint s'il reste.

Pour contrôler qui peut modifier qui, sans toucher à la base :

```bash
python generer_participants.py --droits
```

## Confidentialité

Le dépôt est public : il contient les **outils**, jamais les **données**.
Sont ignorés par git — `*.ged`, `famille.txt`, `exclusions.txt`,
`participants.sql`, `reglages.sql` — chacun ayant son modèle `.exemple`
versionné. Le `.ged` n'est jamais copié : il est lu là où il se trouve.

**Avant chaque push :**

```bash
python verifier_confidentialite.py && git push
```

Le script cherche les noms de `famille.txt` dans tout ce que git publie et
sort en erreur sur une vraie fuite, ce qui annule le push. Les prénoms
courants des exemples et des tests sont déclarés dans
[`prenoms_inventes.txt`](prenoms_inventes.txt) et n'alertent pas.

> Un nom poussé par erreur reste dans l'historique public même après
> correction du fichier. D'où la vérification *avant*.

---

## Mise en route

1. **Supabase** — projet en région UE, puis coller
   [`supabase/schema.sql`](supabase/schema.sql) dans le SQL Editor.
2. **Dates et code** — adapter
   [`supabase/reglages.exemple.sql`](supabase/reglages.exemple.sql).
3. **Participants** — voir ci-dessus.
4. **Clés** — `Project URL` et clé publishable dans [`config.js`](config.js).
5. **Pages** — Settings → Pages → Deploy from a branch → `main` / `(root)`.
6. **Tarifs** — copier `config.example.toml` en `config.toml`, à remplir
   quand l'hôtel sera connu.

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m pytest -q
```

## Export Excel

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_KEY="sb_secret_..."   # ne quitte jamais ta machine
python run_export.py --source supabase --out exports/sejour.xlsx
```

Synthèse hôtel, repas hors pension, détail par personne, total par famille,
**tarifs manquants** (les prix restant à négocier) et anomalies de saisie.

## Points à connaître

**Absent est l'état par défaut.** Sans ligne en base, une personne est
absente. Enregistrer remplace toute sa saisie : on corrige autant de fois
qu'on veut sans créer de doublon.

**Les droits sont un garde-fou, pas une sécurité.** Chacun couvre son
conjoint, ses descendants et leurs conjoints — mais tout le monde partage
le même code, donc qui le connaît peut se déclarer comme n'importe qui. Ça
empêche les erreurs, pas la malveillance.

**La clé publishable de `config.js` est publique par conception.** Ce qui
protège, c'est qu'aucune table n'est accessible directement : le navigateur
ne peut appeler que trois fonctions, qui vérifient le code et les droits à
chaque appel. La clé secrète, elle, ne quitte jamais ta machine, et les
`.xlsx` ne sont ni commités ni produits par GitHub Actions — sur un dépôt
public, les artifacts sont téléchargeables par tous.

Les règles de facturation (pension complète, demi-pensions, repas hors
pension, gîtes) sont documentées et testées dans
[`engine/rules.py`](engine/rules.py) et [`tests/`](tests/).
