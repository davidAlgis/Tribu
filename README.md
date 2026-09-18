# Tribu

Organiser un séjour familial : qui vient, quelles nuits, quels repas — et
ce que ça coûte.

```
Formulaire (GitHub Pages)  →  Supabase  →  Python  →  Excel
     saisie des faits         stockage    calculs    export
```

Chacun déclare sa présence sur un formulaire web, les données vont dans
une base, et un script Python en déduit tout le reste : pensions,
demi-pensions, repas hors pension, tarifs, totaux par famille, et les
tableaux à envoyer à l'hôtel.

Le principe qui tient l'ensemble : **la base ne stocke que des faits**
(où je dors, quels repas je prends). Aucun régime, aucun tarif, aucun
total n'y figure — tout est recalculé par [`engine/rules.py`](engine/rules.py),
seul endroit où vivent les règles. Si l'hôtel change une règle l'an
prochain, on modifie ce fichier et rien d'autre. Les Excel ne sont plus
qu'une sortie : plus une seule formule à maintenir.

Remplace un classeur Google Sheets devenu ingérable.

---

# Ajouter des participants

La liste vient du **fichier GEDCOM** de la généalogie familiale, qui
contient déjà les couples, la filiation et les dates de naissance. Rien
n'est saisi deux fois, rien n'est deviné.

```
  genealogie.ged  ──>  importer_ged.py  ──>  famille.txt  ──>  generer_participants.py  ──>  participants.sql
   (reste chez toi)          ▲               (éditable)                                        (à coller)
                             │
                      exclusions.txt
```

### En une commande

```bash
python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom" --generer
```

`--racine` est l'ancêtre dont on prend toute la descendance. `--generer`
enchaîne directement sur la production du SQL.

Puis colle le `participants.sql` obtenu dans **Supabase → SQL Editor**.
C'est tout : tu n'écris jamais une ligne de SQL.

### Ce que ça déduit tout seul

| Depuis le GEDCOM | Résultat |
|---|---|
| `FAM` / `HUSB` / `WIFE` | les couples |
| `CHIL` | la filiation, donc les droits de modification |
| `BIRT` | la catégorie d'âge, calculée **à la date du séjour** |
| `DEAT` | les personnes décédées, écartées d'office |

Le script signale les personnes **sans date de naissance** : elles sont
comptées adultes, donc au plein tarif. Corrige-les dans le GEDCOM plutôt
qu'à la main — une correction dans le GEDCOM survit au prochain import.

### Ajouter quelqu'un qui n'est pas dans la généalogie

`famille.txt` reste un fichier texte ordinaire, modifiable directement :

```
## Durand
Gerard + Simone
── Sylvain + Nadia
──── Louise (enfant)
── Simon
```

Deux tirets par génération, `+` pour un couple, `(enfant)` ou `(bebe)` en
fin de ligne. Voir [`famille.exemple.txt`](famille.exemple.txt). Relance
ensuite `python generer_participants.py`.

> **Le `+` n'est pas décoratif.** Deux lignes de même niveau sans `+` sont
> frère et sœur, pas un couple — et un parent non marqué perd le droit de
> modifier ses propres enfants.

⚠️ Une modification faite à la main dans `famille.txt` est **écrasée au
prochain import du GEDCOM** (l'ancienne version est conservée en `.bak`).
Pour un changement durable, corrige le GEDCOM.

### Rester confidentiel

Aucune de ces données ne part sur GitHub. Le dépôt est public et ne
contient que les **outils** ; les **données** restent sur ta machine et
dans Supabase.

| Fichier — ignoré par git | Contenu | Modèle public versionné |
|---|---|---|
| `*.ged` | toute la généalogie | — reste hors du projet |
| `famille.txt`, `famille.txt.bak` | prénoms et parenté réels | `famille.exemple.txt` |
| `exclusions.txt` | qui ne vient pas | `exclusions.exemple.txt` |
| `participants.sql` | la liste, en SQL | `supabase/participants.exemple.sql` |
| `reglages.sql` | le code d'accès | `supabase/reglages.exemple.sql` |

Le `.ged` n'est jamais copié dans le projet : `--ged` le lit là où il se
trouve.

**Vérifie avant chaque `git push`** :

```bash
python verifier_confidentialite.py && git push
```

Le script compare chaque nom de `famille.txt` à tout ce que git publie, et
distingue deux cas :

- **FUITE** — un nom réel dans un fichier versionné. Le script sort en
  erreur, donc le `git push` n'a pas lieu. À corriger avant de pousser.
- **coïncidence** — un prénom courant déclaré dans
  [`prenoms_inventes.txt`](prenoms_inventes.txt), utilisé dans un exemple
  ou un test. « Marie » ou « Paul » dans un jeu d'essai n'identifie
  personne. Affiché pour que tu juges, sans bloquer.

Quand tu écris un nouvel exemple, ajoute les prénoms inventés que tu
utilises dans `prenoms_inventes.txt` — jamais un prénom réel, ce serait
désamorcer l'alarme au lieu d'éteindre l'incendie.

> Si un prénom réel était poussé par erreur, le supprimer ensuite ne
> suffirait pas : il resterait dans l'historique public, consultable par
> n'importe qui. Il faudrait réécrire l'historique, ou plus simplement
> supprimer et recréer le dépôt. D'où la vérification *avant*.

---

# Retirer des participants

Une ligne par personne dans **`exclusions.txt`**, puis relance l'import.
« Prénom » suffit, « Prénom Nom » lève une ambiguïté. Accents, casse et
espaces sont indifférents : `Chloé` trouve `Chloe`.

```
# exclusions.txt
Sylvain
Nadia Martin
```

```bash
python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom" --generer
```

**Pourquoi un fichier séparé ?** Parce que `famille.txt` est régénéré à
chaque import : une ligne effacée à la main y serait perdue au passage
suivant. Les exclusions, elles, sont rejouées à chaque fois.

Les personnes **décédées** sont écartées automatiquement, inutile de les
lister.

Une exclusion qui ne correspond à personne est **signalée** plutôt
qu'ignorée en silence — c'est ainsi qu'on repère une faute de frappe.

### Retirer quelqu'un ne coupe pas la branche

Ses enfants **remontent d'un cran** et se rattachent à leur grand-parent.
Si son conjoint reste, ils restent sous lui. Les droits demeurent donc
cohérents quoi qu'on retire.

```
Avant                          Après avoir retiré Sylvain + Nadia
─────                          ─────────────────────────────────
Gerard + Simone                Gerard + Simone
── Sylvain + Nadia             ── Louise
──── Louise                    ── Jules
──── Jules
```

### Contrôler le résultat

```bash
python generer_participants.py --droits
```

affiche, pour chaque personne, qui elle peut modifier — sans toucher à la
base. **À lire une fois avant d'ouvrir la saisie à la famille.** La même
vérification figure en fin de `participants.sql`, côté serveur.

---

# Mise en route

1. **Supabase** — créer un projet en région UE, puis coller
   [`supabase/schema.sql`](supabase/schema.sql) dans le SQL Editor.
2. **Dates et code** — adapter
   [`supabase/reglages.exemple.sql`](supabase/reglages.exemple.sql) dans le
   SQL Editor. Ne jamais commiter la version remplie.
3. **Participants** — voir ci-dessus.
4. **Clés** — reporter `Project URL` et la clé publishable dans
   [`config.js`](config.js). Les dates, elles, vivent en base.
5. **Pages** — Settings → Pages → Deploy from a branch → `main` / `(root)`.
6. **Tarifs** — copier `config.example.toml` en `config.toml` et le remplir
   quand l'hôtel sera connu. `config.toml` est dans le `.gitignore`.

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m pytest -q
```

---

# Comment ça marche

## La saisie

Trois écrans : **code famille**, puis **prénom** (avec autocomplétion sur
la liste des participants), puis la grille du séjour.

**Absent est l'état par défaut.** Une personne qui n'a rien saisi n'a
aucune ligne en base. Enregistrer remplace intégralement sa saisie, donc
repasser un jour à « absente » l'efface : on peut revenir corriger autant
de fois qu'on veut sans jamais créer de doublon.

## Qui peut modifier qui

Deux liens suffisent : `parent_id` et `conjoint_id`. Chacun couvre **son
conjoint, ses descendants, et les conjoints de ses descendants**. Un
grand-père couvre donc sa femme, ses enfants, leurs compagnons et ses
petits-enfants ; un frère n'a aucun droit sur son frère, et personne ne
remonte vers ses parents.

**C'est un garde-fou, pas une sécurité.** Tout le monde partage le même
code : qui le connaît peut se déclarer comme n'importe quel participant.
Ce modèle empêche les erreurs, pas la malveillance — un choix assumé dans
un cadre familial.

## Les règles de facturation

Une nuitée est rattachée au jour J où la personne se couche. Les repas
qu'elle englobe sont le dîner de J, puis le petit-déjeuner et le déjeuner
de J+1.

| Régime | Dîner J | Nuit J | Petit-déj. J+1 | Déjeuner J+1 |
|---|:-:|:-:|:-:|:-:|
| Pension complète | ✓ | ✓ | ✓ | ✓ |
| Demi-pension soir | ✓ | ✓ | ✓ | |
| Demi-pension midi | | ✓ | ✓ | ✓ |
| Nuit + petit-déjeuner | | ✓ | ✓ | |
| Nuit seule | | ✓ | | |

Tout repas non absorbé par un régime est facturé **hors pension**, y
compris pour une personne logée en chambre.

Les **gîtes** suivent une autre logique : la nuit est facturée, aucun repas
n'est inclus, donc tous les repas d'une personne en gîte sont hors pension.

Trois hébergements seulement : `chambre`, `gite`, `exterieur` (présente ce
jour-là mais ne dort pas sur place). Distinguer « absent » de « dort
ailleurs » n'apporte rien à la facturation et multiplie les erreurs de
saisie.

## L'export Excel

```bash
# à partir des données d'exemple
.venv/Scripts/python.exe run_export.py --source json --input exemple_donnees.json

# depuis Supabase
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_KEY="sb_secret_..."   # ne quitte jamais ta machine
.venv/Scripts/python.exe run_export.py --source supabase --out exports/sejour.xlsx
```

Le classeur contient : synthèse hôtel (combien de chaque régime par date),
repas hors pension, détail par personne, total par famille, **tarifs
manquants** — la liste exacte des prix restant à négocier — et anomalies
de saisie.

## Sécurité

Le dépôt est public, contrainte de GitHub Pages en plan gratuit.

- La clé publishable dans `config.js` est publique **par conception**. Ce
  qui protège, c'est qu'**aucune table n'est accessible directement** : le
  navigateur ne peut appeler que trois fonctions, qui vérifient le code et
  les droits à chaque appel.
- Le **code famille** est exigé pour toute écriture. Il est vérifié dans le
  schéma `private`, que PostgREST n'expose pas — sans quoi la fonction de
  vérification serait appelable en RPC et offrirait un oracle de force
  brute. Ce code n'est écrit nulle part dans le dépôt : il se pose à la
  main dans Supabase et se transmet de vive voix.
- Un code mémorisable reste devinable par un humain déterminé. Il n'est pas
  là pour ça : il arrête les robots qui scannent GitHub à la recherche de
  clés Supabase exposées, seule menace réellement automatisée. Contre un
  volume anormal, la parade est `saisie_ouverte = false` hors période de
  collecte.
- La clé secrète (`sb_secret_…`) ne doit **jamais** quitter ta machine.
- Les `.xlsx` ne sont jamais commités ni produits par GitHub Actions : sur
  un dépôt public, les artifacts d'Actions sont téléchargeables par
  n'importe qui.
