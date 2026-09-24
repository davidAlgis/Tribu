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

Trois pages pour la famille, une pour toi :

| Page | Qui | Quoi |
|---|---|---|
| [`lieux.html`](lieux.html) | la famille | où l'on n'a pas envie d'aller |
| [`dates.html`](dates.html) | la famille | quel week-end arrange chacun, et où en est le choix |
| [`index.html`](index.html) | la famille | qui vient, quelles nuits, quels repas |
| [`couchage.html`](couchage.html) | la famille | qui dort où, nuit par nuit |
| [`admin.html`](admin.html) | toi | dates du séjour, participants, droits, logements et plan de couchage, week-ends, résultat de la carte, retour en arrière |

Les quatre pages familiales portent le même menu en tête — **Le lieu**, **La
date**, **Les présences**, **Le couchage** — dans l'ordre où les décisions se
prennent. Celle qu'on regarde y est remplie.

`admin.html` n'y figure pas : elle ne s'ouvre pas avec le code famille, et
l'annoncer à toute la famille ne ferait qu'inviter à la pousser.

Elle a ses propres **onglets** — Séjour, Participants, Logements, Week-ends,
Lieu, Sauvegardes. Six sujets sans rapport se suivaient auparavant dans une
seule colonne : pour ouvrir la carte, il fallait dérouler la liste entière
des participants. Les flèches ← → passent d'un onglet à l'autre.

Le champ du code y est désormais lisible par un **gestionnaire de mots de
passe**. Ces outils classent leurs entrées par couple identifiant + mot de
passe ; devant un formulaire à un seul champ, la plupart ne proposaient ni
d'enregistrer ni de remplir. Un champ d'identifiant les accompagne donc,
en lecture seule et hors écran — hors écran et non `display:none`, que
LastPass et consorts ignorent délibérément, un champ caché ainsi étant le
motif classique du piège.

---

## Choisir le lieu

Une carte de France toute verte. Chacun **marque en rouge** les
départements où il n'a pas envie d'aller — en glissant le doigt, et en
repassant dessus pour effacer. Le croisement désigne ceux que personne ne
refuse.

Le geste peut commencer dans la marge autour de la carte : le sens du tracé
se décide au premier département rencontré, pas à l'appui.

Le pinceau couvre un disque de deux ou trois départements : un balayage de
la Manche aux Ardennes en peint six d'un geste. Une quinzaine de **villes repères**
situent le trait — on sait si l'on peint au-dessus ou au-dessous
de Lyon.

Le département comme unité plutôt qu'un dessin libre, pour trois raisons :
la donnée tient en quelques codes, le croisement est un simple comptage,
et surtout **la sortie porte un nom**. « Dordogne » se cherche sur un site
de location ; une tache sur une image, non.

L'onglet **Celle de la famille** montre une carte de chaleur : vert là où
personne ne refuse, puis ambre, puis rouge — le nombre de refus se lit
comme une température. Les totaux sont
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

## Les étapes, sur les pages familiales

Code famille, puis prénom : deux champs de texte, au même endroit, dans un
cadre identique. On tapait le code, la page répondait… et rien ne semblait
avoir bougé.

Les deux étapes sont désormais numérotées dans leur intitulé, et une
bande verte **« ✓ Code accepté »** apparaît à la validation et ne repart
plus : il y a maintenant sur la page quelque chose qui n'y était pas. Le
panneau qui arrive prend le bord accentué de la saisie et se signale une
fois, brièvement — l'animation est un renfort, jamais le seul message,
et `prefers-reduced-motion` la supprime.

## Choisir la date

Un sondage, en amont du reste. **C'est toi qui proposes les week-ends**,
sur `admin.html` : intitulé, date de début, date de fin. La famille répond
sur `dates.html`, avec le même code et le même prénom que pour les
présences.

Deux réponses par week-end : **Oui** ou **Non** — recliquer sur sa réponse
l'annule, et ne rien cocher vaut « pas encore répondu ».

Il y en a eu trois. « Si besoin » se voulait la nuance qui départage deux
week-ends ; c'est devenu le refuge de qui ne voulait pas trancher, et le
dépouillement héritait de l'indécision. Une réponse binaire oblige à se
prononcer, et rend le résultat lisible sans pondération à expliquer.

Chacun voit les totaux de la famille, **jamais les noms**.

Sous les week-ends, **« Résultat des choix »** donne l'état courant, et
il est visible de tous : le classement, une barre par week-end — vert pour
les oui, rouge pour les non, gris pour ceux qui n'ont rien dit — et le nombre
de gens qui se sont prononcés. Le classement suit le nombre de **oui** :
combien de personnes peuvent venir.

Ce résultat était réservé à `admin.html`. Le réserver ne protégeait rien : il
se déduit des compteurs que la page affichait déjà. Ce qui lui manquait,
c'était le dénominateur — « 7 oui » ne dit rien tant qu'on ignore si la
famille compte huit personnes ou vingt. La page annonce donc aussi combien
ont répondu, et signale quand c'est encore trop peu pour arrêter quoi que ce
soit.

Les deux panneaux ne se ressemblent pas, et c'est voulu. Celui du haut se
remplit : une **carte** posée sur la page, bord accentué, légère ombre.
Celui du bas se lit : un **bandeau**, aplat distinct, angles droits, barre
accentuée en tête, titre en capitales. Deux objets différents plutôt que
deux nuances du même — on ne cherche pas où cliquer dans un panneau
d'affichage.

À égalité, celui qui bloque le moins de monde s'affiche en premier, mais
l'égalité est annoncée plutôt que masquée derrière un classement arbitraire.
Deux week-ends au même score partagent la première place, et il n'y a pas de
deuxième.

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

## Les dates du séjour

L'onglet **Séjour** de `admin.html`. Deux champs, un bouton.

Elles ne vivaient jusqu'ici que dans `private.reglages`, donc dans
l'éditeur SQL. C'est peu, et c'est mal placé : ce sont elles qui bornent la
grille de saisie et qui **filtrent tout ce qui s'écrit** dans les
présences. Laissées sur les valeurs d'exemple, elles font échouer un import
entier sans que rien n'explique pourquoi.

Déplacer les dates ne déplace pas ce qui a déjà été saisi. Les journées
tombées hors des nouvelles bornes restent en base, invisibles du formulaire
et absentes de l'export. Le panneau les compte et le dit — il ne les efface
pas : ce serait décider à ta place.

L'interrupteur **Saisie ouverte** ferme le formulaire des présences une
fois tout le monde passé. La colonne existait depuis le début et
`sejour_enregistrer` la respectait, mais rien ne permettait de la basculer :
le sondage des dates et la carte avaient leur interrupteur, le formulaire
des présences non.

## Les logements

L'onglet **Logements** de `admin.html`. Un inventaire, et rien de plus :
combien de chambres de deux, combien de gîtes de six.

Une ligne est **un type de couchage, pas une unité**. « 4 chambres de 2 »
est une ligne qu'on corrige, et non quatre lignes qu'on additionne : reposer
un type déjà présent met son nombre à jour au lieu d'empiler un doublon.
Deux saisies distraites ne peuvent donc pas produire un total que personne
n'a voulu.

Une fois posée, elle **se reprend sans passer par sa suppression** :

| Geste | Effet |
|---|---|
| **−** / **+** | un exemplaire de moins ou de plus, un clic, un enregistrement |
| **✎** | rouvre la ligne entière — le type, la capacité, le nombre |
| **✕** | retire le type de l'inventaire |

Le **−** sur le dernier exemplaire retire le type : « en enlever un » reste
ce qu'on a voulu faire, et la confirmation dit où cela mène. Le crayon
travaille sur l'identifiant de la ligne et non sur son intitulé — corriger
une capacité mal tapée déplace la ligne au lieu d'en créer une seconde à
côté. Si le type visé existe déjà, la page le dit avec une phrase plutôt
que de laisser remonter une violation de contrainte.

Le second panneau confronte cet inventaire à ce que la famille a déjà
déclaré, **nuit par nuit** : `12 / 14` se lit « douze personnes en chambre,
quatorze places ». Un dépassement est signalé en rouge, jamais refusé — la
saisie reste ouverte, et c'est à toi de trancher. Poser la contrainte dans
la base bloquerait toute la famille les jours où l'inventaire n'est pas
encore saisi.

**Rien n'est écrit dans le code.** L'inventaire est une table, pas des
colonnes : un hôtel a deux sortes de chambres, un village de vacances en a
six, et le schéma n'a pas à changer entre deux éditions. Une autre année,
un autre lieu — on retape l'inventaire, comme on retape les dates du
séjour, et le reste suit.

## Le plan de couchage

Deux fois la même chose, à deux endroits : sous l'inventaire dans l'onglet
**Logements**, et sur [`couchage.html`](couchage.html) pour toute la
famille. L'inventaire dit **combien** de couchages ; le plan dit **qui est
dans lequel**.

Le plateau lui-même vit dans [`plan.js`](plan.js), partagé par les deux
pages. C'est l'exception au « chaque page porte ses propres aides » du reste
du projet : cette convention vaut pour des fonctions de trois lignes, pas
pour un plateau de jeu. Deux copies auraient fini par se contredire, et la
contradiction se serait vue sur le couchage de quelqu'un.

### Côté famille : chacun déplace les siens

Tout le monde est **visible** — un plan amputé des autres ne répond pas à la
question qu'on lui pose, qui est « avec qui ». Mais chacun ne déplace que
**soi, son conjoint, ses descendants et leurs conjoints** : exactement la
règle qui vaut déjà pour les présences, donc rien de nouveau à expliquer ni
à tenir à jour.

Les jetons qu'on peut bouger sont **cerclés de vert** ; les autres sont
grisés, en pointillé, et leur infobulle le dit. Les deux tiennent aussi sans
la couleur — le trait est plus épais d'un côté, le jeton en retrait de
l'autre.

> Le refus est posé **en base**, pas dans la page. Celle-ci grise les
> jetons, mais une page ne fait pas foi : elle se recharge, elle se modifie,
> elle s'inspecte.

Cela expose **qui dort avec qui** à toute personne ayant le code famille.
Les prénoms l'étaient déjà — la saisie des présences en propose la liste
entière — mais la répartition, non. C'est le prix de la question, et il est
assumé.

Un rectangle par couchage, un jeton par personne, et l'on glisse les
seconds entre les premiers. « 4 chambres de 2 » donne quatre rectangles :
une unité est une ligne d'inventaire **plus un rang**, ce qui évite de
poser quatre lignes jumelles dans l'inventaire pour le seul besoin de les
nommer.

**Une nuit à la fois.** C'était la demande de départ : quelqu'un dort avec
sa sœur le premier soir et avec trois cousins le lendemain. Une affectation
valable pour tout le séjour ne saurait pas le dire. Les boutons en tête
choisissent le soir, et montrent combien de gens y dorment. Et parce que le
cas courant reste « la même chose toute la semaine », le bouton **Reporter
cette nuit sur les suivantes** le fait en un geste — en ne suivant que les
personnes présentes ces nuits-là.

**Deux façons de déplacer**, et non une : on glisse le jeton, ou bien on le
saisit d'un clic et on le pose d'un autre. Un jeton lâché à côté d'un
rectangle retombe là où il était.

**<kbd>Ctrl</kbd>+clic saisit plusieurs noms à la fois**, comme les curseurs
multiples d'un éditeur de texte (<kbd>Cmd</kbd> sur un Mac). Un clic simple
remplace la sélection — c'est le geste courant, il reste le plus court. Une
famille de cinq se pose ensuite d'un seul clic sur le rectangle ; elle se
glisse aussi d'un bloc, et le fantôme annonce combien il emporte.

Sur ce qui est saisi, deux touches :

| Touche | Effet |
|---|---|
| <kbd>Suppr</kbd> (ou <kbd>Retour arrière</kbd>) | ressort de la chambre et renvoie à **À placer** |
| <kbd>Échap</kbd> | repose la sélection là où elle était |

`Suppr` est le geste inverse du déplacement, et le seul qui manquait :
ressortir quelqu'un demandait de viser le tas, donc de le retrouver en haut
de l'écran. Dans un champ de saisie, ces touches gardent leur sens
ordinaire — effacer une lettre, pas vider une chambre.

Ce qui est déjà en place n'est pas réécrit : reposer cinq personnes dont
trois ne bougent pas n'envoie que deux écritures.

### Le glisser n'est pas celui du navigateur

La page ne se sert pas du glisser-déposer HTML5. Elle suit le pointeur
elle-même, du `pointerdown` au `pointerup`.

Ce n'est pas un goût pour le travail manuel. Le glisser-déposer natif est
un geste que le navigateur **diffuse à qui veut l'entendre**, et les
modules complémentaires du genre « drag-and-go » — ceux qui ouvrent un lien
ou lancent une recherche quand on leur jette un mot — s'y branchent. Ils ne
lisent pas ce qu'on transporte : ils voient un glisser finir, et ils
agissent. Un module de ce genre ouvrait `google.com/webhp` — une recherche
**vide** — à chaque déposé.

Trois correctifs ont échoué avant qu'on cherche du bon côté : ne rien
mettre de lisible dans le presse-papiers, annuler `dragenter` autant que
`dragover`, puis refuser tout dépôt sans condition. Aucun ne pouvait
marcher. Le module écoute **en amont de la page** ; rien de ce qu'elle fait
de l'évènement ne le concerne.

Un glisser qui n'existe pas ne se laisse pas écouter. Trois gains au
passage :

- **le doigt fonctionne** — le glisser-déposer natif ignore le tactile, il
  fallait s'en remettre au clic-clic sur une tablette ;
- plus de presse-papiers, donc plus rien qui puisse fuir vers l'extérieur ;
- le fantôme qui suit le curseur est à nous, et montre le jeton tel qu'il
  est au lieu de l'image grise du navigateur.

Un test ([`tests/test_pages.py`](tests/test_pages.py)) garde la propriété :
le mécanisme natif est plus court à écrire, et une refonte pourrait y
revenir sans s'apercevoir de ce qu'elle rouvre.

Le refus inconditionnel des dépôts, lui, **reste** — mais pour une autre
raison qu'au départ. Il ne protège plus de nos propres jetons, qui ne
produisent plus rien : il protège de ce qui vient de dehors, un fichier ou
un lien glissé depuis une autre fenêtre, que le navigateur ouvrirait en
quittant la page — et la saisie en cours avec elle. Seuls les champs de
texte gardent leur comportement.

**Les homonymes** portent leur filiation entre parenthèses : « Marie
(conjoint de Gérard) », « Marie (enfant d'Alice) ». Seulement eux — un
prénom porté une fois n'a rien à préciser — et l'ambiguïté se juge sur la
famille entière, pour qu'une personne ne change pas d'étiquette d'une nuit
à l'autre selon qui est là. L'infobulle, elle, donne toujours le détail.

Ce que la page **signale sans l'interdire** :

- une chambre trop pleine passe au rouge — sept personnes dans un gîte de
  six est arrivé pour de vrai, et la base n'a pas à trancher ce que tu
  assumes ;
- un jeton posé ailleurs que ce que la personne avait demandé prend un
  liseré pointillé, et dit dans son infobulle ce qu'elle avait coché.

Seules les personnes ayant déclaré **dormir sur place** cette nuit-là
apparaissent : placer quelqu'un d'absent écrirait une ligne que rien
n'affiche, et occuperait un lit pour rien.

Baisser le nombre d'un type laisse des affectations au-delà du rang. Elles
sont **écartées à la lecture** — les personnes reviennent à placer — mais
pas effacées : remonter le nombre les retrouve. Retirer le type, lui, les
emporte pour de bon.

## Les âges

L'onglet **Séjour**, second panneau. Deux bornes — *bébé jusqu'à*, *enfant
jusqu'à* — et un bouton qui refait les catégories de tout le monde.

Le GEDCOM porte les dates de naissance, et `importer_ged.py` les lisait
déjà : il en tirait une catégorie d'âge, puis **les jetait**. C'est ce qui
obligeait à tout reprendre à la main quand le séjour changeait d'année — un
enfant de onze ans en a douze l'édition suivante, et rien dans la base ne le
savait. Elles sont maintenant conservées.

**`categorie_age` reste ce qui facture** : c'est elle que lisent la vue
d'export et le moteur de tarifs, et elle peut être corrigée à la main quand
l'hôtel compte autrement pour quelqu'un. La date de naissance ne la remplace
pas, elle la *propose* — dans la liste des participants, un écart apparaît
comme une étiquette rouge « l'âge dit : enfant », et rien ne bouge tant que
tu n'as pas cliqué. Le recalcul, lui, **dit ce qu'il change**, nom par nom,
avec l'âge et l'état précédent : une catégorie posée exprès a ses raisons,
et l'effacer en silence serait le plus sûr moyen de ne jamais s'en
apercevoir.

L'âge se compte **à la date du séjour**, pas aujourd'hui : c'est celui que
l'hôtel facturera.

### Poser les dates sur une base déjà remplie

```bash
python importer_ged.py --ged "D:/chemin/vers/genealogie.ged" --racine "Prénom Nom" --naissances --apercu
```

Sans `--apercu`, il écrit. Ce mode **ne touche qu'une colonne** : ni les
présences, ni les vœux, ni le plan de couchage. L'amorçage, lui, remplace
tout — il n'est censé servir qu'une fois.

Reste à savoir qui est qui, puisque les identifiants ne peuvent pas servir :
le script en tire de nouveaux à chaque passage, et la base garde ceux du
premier. Il compare donc **les deux arbres** : chaque personne est décrite
par sa place — son prénom, celui de son parent, celui de son conjoint, et sa
branche. Deux personnes qui partagent les quatre sont vraiment
indiscernables, et le script **refuse de trancher** pour elles : il les
signale et passe. Une date posée sur la mauvaise personne ne se verrait
jamais — l'âge paraîtrait seulement bizarre, des mois plus tard, sur une
facture.

Ce qui n'existe que d'un côté est dit aussi : quelqu'un ajouté depuis
l'amorçage n'est pas dans le GEDCOM, et un défunt retiré depuis n'est plus
en base.

> La vue d'export `v_participants` **ne porte pas** la date de naissance.
> Le moteur de tarifs n'en a pas besoin, et moins de données personnelles
> franchissent la frontière, mieux c'est.

## Corriger un prénom, une date de naissance

Le bouton ✎ en face de la personne, sur `admin.html`. Le nom et la date
deviennent deux champs là où ils se lisaient ; Entrée valide, Échap annule.
Les deux partent **en un seul envoi**, et rien ne part si rien n'a bougé.

C'est aussi par là qu'on **ajoute** une date que le GEDCOM ne donnait pas —
les invités n'y figurent pas, et il en manque pour les plus anciens. Le
champ laissé vide **efface** : ne pas savoir est une réponse, et il faut
pouvoir revenir dessus quand le GEDCOM s'est trompé de personne. Une date
dans l'avenir ou antérieure à 1900 est refusée : c'est une faute de frappe,
et une faute qui ne se verrait pas autrement — elle donnerait seulement un
âge étrange, des mois plus tard, sur une facture.

Corriger une date **ne change pas la catégorie d'âge** au passage : elle se
refait en bloc depuis l'onglet Séjour, et une facture n'a pas à bouger dans
ton dos.

Il fallait auparavant retirer la personne et la recréer — ce qui emportait
ses présences et coupait les liens de parenté autour d'elle, pour une
lettre de trop.

**Le prénom ne vit qu'à un endroit**, et tout le reste désigne la personne
par son identifiant : présences, vœux, refus de lieu et liens de parenté
suivent d'eux-mêmes. Il y a une exception, et une seule : `famille` est une
*copie* du prénom du chef de branche, posée à l'amorçage. Quand c'est lui
qu'on renomme, le libellé est recopié sur toute sa descendance — sans quoi
l'ancienne orthographe resterait en tête de la liste et dans les totaux de
l'export, indéfiniment.

## Retirer des participants

Le bouton ✕ en face de la personne, sur `admin.html`. La confirmation dit
ce qui va se passer avant de le faire.

**Retirer quelqu'un ne coupe jamais la branche** : ses enfants sont repris
par son conjoint s'il reste, sinon par son propre parent. Sans cela, une
génération entière deviendrait orpheline et plus personne ne pourrait gérer
sa présence.

Sa saisie de présences part avec elle.

## Revenir en arrière

Trois gestes effacent beaucoup d'un coup, et aucun n'était réversible :
« Appliquer à tous » sur les trois pages familiales, le retrait d'un
participant qui emporte ses saisies, et le réamorçage GEDCOM qui vide la
liste. La base ne garde que l'état courant — ce qui est remplacé n'existe
plus nulle part.

Une copie part donc **à la première écriture de chaque semaine**, prise
juste avant celle-ci. Elle porte l'état tel qu'il était avant le premier
changement de la semaine : exactement le point de retour qu'on cherche.

Pas de planificateur. `pg_cron` demanderait une extension à activer à la
main, hors du « coller `schema.sql` et c'est prêt », et prendrait des
copies identiques les semaines sans activité. Une semaine sans aucune
modification ne produit aucune copie, puisqu'il n'y aurait rien à y sauver.
Le bouton **Sauvegarder maintenant** couvre le cas où l'on sent venir une
opération risquée.

### Comparer

**Comparer** montre ce qui a changé depuis une copie, dans le vocabulaire
de la page et pas dans celui de la base :

```
Participants : 20 → 21
  ajouté    Chloe
  retiré    Bruno
  modifié   Lea — prénom, âge

Présences : 140 → 96
  modifié   Alice — 8 → 8
  effacé    Bruno — 4 → 0
```

Seules les personnes qui ont bougé sont listées. Deux nombres plutôt qu'un :
combien de lignes avant, combien après.

La comparaison se fait **sur la clé naturelle** — la personne et le jour,
la personne et le week-end, la personne et le département — jamais sur
l'identifiant de ligne. Enregistrer une grille efface les lignes et les
réécrit : leurs identifiants changent à chaque fois, même quand la réponse
est identique au caractère près. Comparer dessus signalerait tout comme
« retiré puis ajouté », à chaque fois, et ne dirait plus rien. Les
horodatages sont ignorés pour la même raison.

Le calcul vit dans `admin.js`, pas en SQL : la base sert des faits et
laisse les dérivées au reste du projet, et une fonction JavaScript se met
sur un banc d'essai — ce qu'une fonction PL/pgSQL ne fait pas sans une
vraie base sous la main.

### Restaurer

**Restaurer** remet les cinq tables dans l'état de la copie. Tout ce qui a
été saisi depuis disparaît, et la confirmation le dit avec les chiffres.

Le geste s'annule : une copie de l'état actuel est prise **avant** la
restauration. Se tromper de ligne dans la liste ne doit pas être la
dernière erreur possible.

Douze copies sont gardées par motif, ce qui couvre un trimestre de
préparation.

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
   [`supabase/schema.sql`](supabase/schema.sql) dans le SQL Editor. Le
   fichier se recolle **en entier** à chaque changement — c'est la seule
   façon de poser une fonction — et il est écrit pour que ce geste ne
   détruise rien : chaque table se crée *si elle manque*, et les colonnes
   venues après coup s'ajoutent une par une.

   > Cela n'a pas toujours été vrai. Un `drop table public.presences` a vécu
   > en tête du fichier, invisible tant que la table était vide, et il a fini
   > par effacer la saisie de soixante personnes lors d'un recollage.
   > Deux tests montent désormais la garde ([`tests/test_schema.py`](tests/test_schema.py)).
2. **Dates et code famille** — adapter
   [`supabase/reglages.exemple.sql`](supabase/reglages.exemple.sql). Les
   dates se corrigent ensuite depuis `admin.html`, sans repasser par le SQL.
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

**Absent est l'état par défaut, et ça se voit dans la grille.** La colonne
de gauche ne demande qu'une chose — **où l'on dort** : « pas sur place »,
« en chambre », « en chambre, vue mer », « en gîte ». La vue mer y figure
comme une variante de chambre, et non comme une case à part : elle tenait
une colonne entière, désactivée les trois quarts du temps puisque seule une
chambre peut l'avoir. La base, elle, garde deux champs — un hébergement et
un supplément — parce que c'est ainsi que l'hôtel facture.

**Le petit-déjeuner n'a pas de case** : il vient avec la nuit en chambre, et
seulement avec elle — l'hôtel le sert, le gîte non, on y fait son café
soi-même. Il ne s'affiche nulle part dans la grille : il s'ajoute à
l'enregistrement, le lendemain matin de chaque nuit en chambre.

C'est la règle que [`engine/rules.py`](engine/rules.py) applique pour
reconnaître une demi-pension, et celle que l'import du tableur pose déjà.
Les deux chemins — la grille et l'import — produisent les mêmes lignes sur
les mêmes séjours ; c'est vérifié cas par cas.

Les autres repas se cochent librement, sans avoir à
répondre d'abord sur la nuit : venir déjeuner sans dormir là est le cas de
tous ceux qui logent à côté.

Une journée dont rien n'est coché et qui n'a pas de nuit sur place est
grisée, et ne produit aucune ligne. L'absence ne se déclare pas, elle se
constate.

Il y avait auparavant un quatrième choix, « absente », à côté d'« ailleurs ».
Les deux disaient presque la même chose — ni l'une ni l'autre ne dort sur
place — et il fallait sortir d'« absente » avant de pouvoir cocher quoi que
ce soit.

Sans ligne en base, une personne est
absente. Enregistrer remplace toute sa saisie : on corrige autant de fois
qu'on veut sans créer de doublon.

**Trois façons de remplir**, selon les cas : « Enregistrer pour X » ne
touche qu'à X ; « Appliquer à tous » recopie la grille affichée sur toutes
les personnes qu'on gère, en une transaction et après confirmation nommant
celles dont la saisie sera remplacée ; sinon on passe de l'une à l'autre
par les pastilles, avec des valeurs différentes pour chacune.

**Au-delà d'un foyer, l'avertissement change de ton.** Tant qu'« Appliquer
à tous » porte sur cinq autres personnes ou moins — deux adultes et trois
enfants y tiennent — la page les nomme, et c'est suffisant. Passé ce seuil,
la liste des prénoms devient un mur qu'on ne lit plus : elle cède la place
au nombre, affiché sous les boutons avant même le clic, avec le décompte de
celles dont la saisie serait écrasée. Le nombre de personnes touchées est
une chose ; combien d'entre elles avaient déjà rempli en est une autre, et
c'est la seule qui ne se rattrape pas. La confirmation suit la même règle
et rappelle quel bouton prendre si l'on ne voulait répondre que pour soi.

C'est une heuristique d'ergonomie, pas un verrou. Rien n'empêche une
grand-mère de répondre légitimement pour seize personnes — c'est même
prévu — ni quelqu'un d'appeler la fonction SQL sans passer par la page.
Elle attrape le dérapage, pas la malveillance.

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
