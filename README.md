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

**La base fait foi.** Le GEDCOM n'a servi qu'à l'amorçage ; tout le reste
se passe sur **`/Tribu/admin.html`**, protégée par un code organisateur
distinct du code famille.

La page liste les participants et propose deux cas.

### Un proche en plus

Un nouveau conjoint, un bébé qui vient de naître :

| Rattachement | Effet sur les droits |
|---|---|
| **conjoint·e de…** | entre dans le foyer de son/sa partenaire, et les mêmes personnes gèrent sa présence |
| **enfant de…** | son parent le gère, ainsi que les ascendants de son parent |

### Un invité

| Rattachement | Effet sur les droits |
|---|---|
| **invité·e de…** | son hôte gère sa présence, comme s'il s'agissait de son enfant |
| **indépendant·e** | lui seul se gère, avec le code famille |

Les invités sont marqués comme tels et regroupés sous « Invités » s'ils ne
sont rattachés à personne.

<details>
<summary>L'amorçage initial, depuis le GEDCOM — une seule fois</summary>

```bash
python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom" --apercu
python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom"
```

`--apercu` affiche l'arbre sans rien écrire. Sans lui, le script demande
confirmation puis remplit Supabase directement — il ne produit aucun
fichier.

Sont déduits du GEDCOM : les couples (`FAM`/`HUSB`/`WIFE`), la filiation
(`CHIL`), la catégorie d'âge calculée à la date du séjour (`BIRT`), et les
personnes décédées, écartées d'office (`DEAT`). Les personnes **sans date
de naissance** sont signalées : elles passent adultes, donc au plein tarif.

`exclusions.txt` écarte d'emblée ceux qui ne viennent pas — une ligne par
personne, accents et casse indifférents. Cela évite d'importer cent
personnes qu'il faudrait ensuite retirer une à une.

⚠️ **Relancer ce script écrase toute la liste**, et avec elle les présences
déjà saisies. Il demande confirmation, mais passé l'amorçage il n'a plus
lieu d'être : utilise `admin.html`.
</details>

## Retirer des participants

Le bouton ✕ en face de la personne, sur `admin.html`. La confirmation dit
ce qui va se passer avant de le faire.

**Retirer quelqu'un ne coupe jamais la branche** : ses enfants sont repris
par son conjoint s'il reste, sinon par son propre parent. Sans cela, une
génération entière deviendrait orpheline et plus personne ne pourrait gérer
sa présence.

Sa saisie de présences part avec elle.

## Confidentialité

Le dépôt est public : il contient les **outils**, jamais les **données**.
Le `.ged` n'est jamais copié dans le projet : il est lu là où il se trouve.

### Le code organisateur

```bash
python creer_code_admin.py
```

Le code est **tiré au hasard sur ta machine**, affiché une seule fois, puis
oublié. Seuls un sel et une empreinte SHA-256 partent dans le SQL à coller :
le code lui-même ne touche jamais Supabase.

C'est ce qui le distingue du code famille. L'éditeur SQL de Supabase
**conserve l'historique des requêtes** — un code tapé là y reste. Range-le
dans un gestionnaire de mots de passe ; perdu, il ne se retrouve pas, on en
refabrique un.

Le code famille, lui, reste en clair et mémorisable : il circule de toute
façon entre vingt personnes, et doit pouvoir se dicter au téléphone.

**Avant chaque push :**

```bash
python verifier_confidentialite.py --ged "D:/chemin/vers/genealogie.ged" && git push
```

Le script cherche les noms du GEDCOM dans tout ce que git publie et
sort en erreur sur une vraie fuite, ce qui annule le push. Les prénoms
courants des exemples et des tests sont déclarés dans
[`prenoms_inventes.txt`](prenoms_inventes.txt) et n'alertent pas.

> Un nom poussé par erreur reste dans l'historique public même après
> correction du fichier. D'où la vérification *avant*.

---

## Mise en route

1. **Supabase** — projet en région UE, puis coller
   [`supabase/schema.sql`](supabase/schema.sql) dans le SQL Editor.
2. **Dates et code famille** — adapter
   [`supabase/reglages.exemple.sql`](supabase/reglages.exemple.sql).
3. **Code organisateur** — `python creer_code_admin.py`, puis coller le SQL
   affiché (voir ci-dessous).
4. **Participants** — amorcer depuis le GEDCOM, puis `admin.html`.
5. **Clés** — `Project URL` et clé publishable dans [`config.js`](config.js).
6. **Pages** — Settings → Pages → Deploy from a branch → `main` / `(root)`.
7. **Tarifs** — copier `config.example.toml` en `config.toml`, à remplir
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
conjoint, ses descendants et leurs conjoints — mais toute la famille
partage le même code, donc qui le connaît peut se déclarer comme n'importe
qui. Ça empêche les erreurs, pas la malveillance. Le code organisateur,
lui, est distinct : saisir ses vacances et modifier la liste ne sont pas
le même pouvoir.

**La clé publishable de `config.js` est publique par conception.** Ce qui
protège, c'est qu'aucune table n'est accessible directement : le navigateur
ne peut appeler que trois fonctions, qui vérifient le code et les droits à
chaque appel. La clé secrète, elle, ne quitte jamais ta machine, et les
`.xlsx` ne sont ni commités ni produits par GitHub Actions — sur un dépôt
public, les artifacts sont téléchargeables par tous.

Les règles de facturation (pension complète, demi-pensions, repas hors
pension, gîtes) sont documentées et testées dans
[`engine/rules.py`](engine/rules.py) et [`tests/`](tests/).
