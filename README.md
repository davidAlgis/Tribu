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

Deux pages pour la famille, une pour toi :

| Page | Qui | Quoi |
|---|---|---|
| [`lieux.html`](lieux.html) | la famille | où l'on n'a pas envie d'aller |
| [`dates.html`](dates.html) | la famille | quel week-end arrange chacun |
| [`index.html`](index.html) | la famille | qui vient, quelles nuits, quels repas |
| [`admin.html`](admin.html) | toi | participants, droits, week-ends, résultat de la carte |

---

## Choisir le lieu

Une carte de France en gris neutre. Chacun **marque en rouge** les
départements où il n'a pas envie d'aller — en glissant le doigt, et en
repassant dessus pour effacer. Le croisement désigne ceux que personne ne
refuse.

Le fond est neutre et non vert : un département non peint ne veut pas dire
« choisi », seulement « pas d'objection ». Le vert lui prêtait une
approbation que personne n'a exprimée, et le rouge reste ainsi la seule
information portée par la couleur.

Le pinceau couvre un disque de deux ou trois départements : un balayage de
la Manche aux Ardennes en peint six d'un geste. Une quinzaine de **villes repères**
situent le trait — on sait si l'on peint au-dessus ou au-dessous
de Lyon.

Le département comme unité plutôt qu'un dessin libre, pour trois raisons :
la donnée tient en quelques codes, le croisement est un simple comptage,
et surtout **la sortie porte un nom**. « Dordogne » se cherche sur un site
de location ; une tache sur une image, non.

L'onglet **Celle de la famille** montre une carte de chaleur : neutre là où
personne ne refuse, puis d'un rouge de plus en plus soutenu. Les totaux sont
visibles de tous, **jamais les noms**. Avec vingt personnes, il est
probable qu'aucun département ne fasse l'unanimité — d'où le dégradé
plutôt qu'un verdict binaire qui n'afficherait rien.

Côté organisateur, `admin.html` liste les départements sans aucun refus, ou
à défaut les moins contestés, et l'interrupteur **Carte ouverte** clôt la
saisie.

<details>
<summary>Refaire le fond de carte</summary>

```bash
python preparer_carte.py
```

Télécharge les frontières officielles (france-geojson, dérivé de l'IGN),
garde la métropole, projette et simplifie, et écrit `carte.js` — 96
départements et 15 villes, 64 Ko. La Corse est écartée : elle étire
l'emprise vers le sud-est et repousse tout le reste, pour deux départements
qui ne sont pas le sujet d'un séjour familial en voiture. Les villes passent par la **même**
projection que les contours : c'est la seule façon de garantir qu'un point
tombe dans le bon département. Le résultat est versionné : une carte de France ne
contient aucune donnée personnelle. Relancer ne sert qu'à changer le niveau
de détail (constante `TOLERANCE`).
</details>

---

## Choisir la date

Un sondage, en amont du reste. **C'est toi qui proposes les week-ends**,
sur `admin.html` : intitulé, date de début, date de fin. La famille répond
sur `dates.html`, avec le même code et le même prénom que pour les
présences.

Trois réponses possibles par week-end : **Oui**, **Si besoin**, **Non** —
recliquer sur sa réponse l'annule. « Si besoin » n'est pas du remplissage :
c'est ce qui départage deux week-ends quand personne n'a de disponibilité
parfaite.

Chacun voit les totaux de la famille, **jamais les noms**. Toi seul vois le
score, qui compte les « si besoin » pour moitié : un week-end que tout le
monde accepte à contrecœur ne vaut pas celui que tout le monde choisit.

L'interrupteur **Sondage ouvert** ferme les réponses une fois la date
arrêtée.

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

### Restreindre ce que quelqu'un peut modifier

Par défaut, l'arbre décide : chacun gère son conjoint, ses descendants et
leurs conjoints. Quand l'arbre dit plus que la réalité — une grand-mère qui
figure au-dessus de toute sa descendance mais ne s'occupe que de son mari —
le sélecteur **« gère … »** en face de chaque personne le corrige :

| Réglage | Portée |
|---|---|
| **toute sa descendance** | le défaut |
| **son conjoint** | elle et son conjoint, rien de plus |
| **elle-même seulement** | elle seule |

Le nombre de personnes gérées s'affiche à côté, et se met à jour aussitôt :
c'est ce qui rend le réglage lisible. Restreindre quelqu'un **ne retire
rien aux autres** — ses enfants gardent la main sur leurs propres foyers.
Et personne ne perd jamais la main sur sa propre présence.

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
4. **Participants** — amorcer la base depuis le GEDCOM, une seule fois :
   ```bash
   python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom"
   ```
   Il demande le code organisateur, puis remplit Supabase. Ensuite, tout se
   passe sur `admin.html`.
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

**Trois façons de remplir**, selon les cas : « Enregistrer pour X » ne
touche qu'à X ; « Appliquer à tous » recopie la grille affichée sur toutes
les personnes qu'on gère, en une transaction et après confirmation nommant
celles dont la saisie sera remplacée ; sinon on passe de l'une à l'autre
par les pastilles, avec des valeurs différentes pour chacune.

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
