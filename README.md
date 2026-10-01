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

Six pages pour la famille, une pour toi :

| Page | Qui | Quoi |
|---|---|---|
| [`lieux.html`](lieux.html) | la famille | où l'on n'a pas envie d'aller |
| [`dates.html`](dates.html) | la famille | quel week-end arrange chacun, et où en est le choix |
| [`presences.html`](presences.html) | la famille | qui vient, quelles nuits, quels repas, et qui dort où |
| [`regimes.html`](regimes.html) | la famille | ce que chacun mange et boit |
| [`activites.html`](activites.html) | la famille | ce qu'on a envie de faire sur place, et qui en a envie |
| [`facture.html`](facture.html) | la famille | ce que ça coûte, à soi et aux siens — en lecture seule |
| [`admin.html`](admin.html) | toi | dates du séjour, participants, préférences alimentaires, **activités**, logements et plan de couchage, tarifs, facture, hôtel, week-ends, résultat de la carte, retour en arrière |

Le code se donne **une fois**, sur la page d'accueil : il est retenu sur
l'appareil, et les étapes suivantes le reprennent toutes seules. **Le prénom
aussi** — celui qui vient de dire qui il est sur les dates n'a pas à le
redire sur les présences. Une page le reprend si la personne est toujours
dans la liste et que la base sert ses données ; sinon elle redemande, et
oublie ce qu'elle gardait plutôt que d'échouer page après page.
«&nbsp;Changer de personne&nbsp;» l'oublie, et «&nbsp;oublier le code sur cet
appareil&nbsp;» emporte les deux — sur un téléphone qui circule, laisser le
prénom derrière ferait reprendre la saisie sous le nom du précédent.
Entrer directement sur l'une d'elles marche aussi : elle demandera le code.

Les pages familiales portent le même menu en tête — **Accueil**, **Le
lieu**, **La date**, **Les présences**, **Préférences alimentaires**, **Les
activités**, **La facture** — dans l'ordre où les décisions se prennent. Celle qu'on regarde y est remplie.
L'accueil, lui, ne porte pas ce menu : il **est** le menu.

`admin.html` n'y figure pas : elle ne s'ouvre pas avec le code famille, et
l'annoncer à toute la famille ne ferait qu'inviter à la pousser.

Elle a ses propres **onglets** — Séjour, Participants, Préférences
alimentaires, Activités, Logements, Tarifs, Facture, Hôtel, Week-ends,
Lieu, Historique. Onze sujets sans rapport se suivaient auparavant dans une
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

Le pinceau couvre à peu près **un département moyen**. Il en couvrait deux
ou trois : commode pour peindre une région entière, trop large pour en
désigner un seul — on débordait sur le voisin à chaque fois. Un balayage
reste le geste naturel pour une région, il demande seulement un passage de
plus. Une quinzaine de **villes repères** situent le trait — on sait si l'on
peint au-dessus ou au-dessous de Lyon.

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

## Décrire l'hôtel, au lieu de le coder

Chaque année, une cousinade, et chaque année un hôtel qui facture à sa
façon. Le mot **« chambre »** décidait jusqu'ici de trois choses à la fois —
on paie par personne, on ne paie pas le logement, la nuit comprend les
repas — et **« gîte »** décidait des trois autres. Il n'existait que ces
deux paquets, et un hôtel qui fait payer la chambre *et* la personne, sans
pension, n'était pas descriptible.

**Les trois questions se posent maintenant séparément**, une fois par type
de logement, dans l'onglet **Tarifs** — juste au-dessus du tableau de prix
dont elles commandent les colonnes :

| question | réponses |
|---|---|
| **On paie le logement** | rien · un prix fixe, divisé entre ses occupants · un prix par nombre d'occupants |
| **On paie par personne** | rien · selon la tranche d'âge |
| **La nuit comprend** | les repas qu'elle absorbe — aucun s'il n'y a pas de pension |

**Les deux premières s'additionnent.** C'est ce qui rend « on paie à la
chambre et par la personne » exprimable sans inventer un troisième mode :
les deux boucles du moteur ont simplement cessé de s'exclure.

L'existant se traduit dans ce vocabulaire **sans rien changer**, et c'est
ce que la base écrit sur les lignes déjà posées : une chambre devient
*(rien, par occupant, les trois repas)*, un gîte *(prix fixe, rien, aucun
repas)*. Ces deux lignes disent exactement ce que le code disait en dur —
le comportement ne bouge pas, il devient lisible et modifiable.

**Les colonnes de prix découlent des réponses** : « le logement entier » si
la part fixe existe, « à 1 », « à 2 »… si elle suit l'occupation, les
quatre tranches d'âge si la part par personne existe. Changer une réponse
redessine le tableau depuis ce qui est enregistré : des prix tapés et non
encore enregistrés seraient perdus, ce qui n'a rien de grave pour un
réglage qu'on pose une fois l'hôtel connu.

**Un type qui se paie au logement exige le plan de couchage** : sans lui,
on sait que quelqu'un dort là, mais pas dans quel exemplaire ni avec qui —
donc pas quelle part lui revient. Ces nuits-là ne sont facturées à personne
et la facture le dit en rouge. Cela ne concernait que les gîtes ; cela
concerne désormais tout type qui a une part de logement.

**Ce qui n'est pas là, et pourquoi.** *Les lits vides dus* — une chambre de
4 occupée à 3 facturée 4 — supposerait de dire à quel tarif se facture un
lit vide, et cette règle-là s'invente au lieu de se déduire : elle attend
qu'un hôtel la réclame. Et les régimes restent modélisés comme *pension
complète moins une réduction en euros*, parce que c'est ainsi qu'un hôtel
les annonce ; un hôtel qui afficherait quatre prix indépendants demanderait
une grille plus large.

Le calcul existe en deux exemplaires — Python pour l'export, JavaScript
pour les pages — et [`tests/test_facture.py`](tests/test_facture.py) les
compare au centime sur **trois** jeux de données, dont un qui n'exerce que
ça : deux parts qui s'additionnent, un prix qui dépend de l'occupation, et
pas une miette de pension.

## Les activités

Une liste d'idées, et trois réponses par personne : **Oui**, **Pourquoi
pas**, **Non**. La famille répond sur [`activites.html`](activites.html),
avec le même code et le même prénom que partout ailleurs, et pour les mêmes
personnes qu'elle peut modifier partout ailleurs. Chaque réponse part toute
seule : il n'y a rien à enregistrer.

**Non est la réponse par défaut, et la base ne la garde pas.** Elle ne
stocke que les « oui » et les « pourquoi pas » ; le nombre de « non » est le
reste de la famille, ceux qui n'ont jamais ouvert la page compris. C'est la
règle du reste du projet — saisir, c'est déclarer — et ici elle dit quelque
chose de juste : une sortie que personne n'a demandée n'aura pas lieu.
Répondre « non » **efface** donc la ligne au lieu d'en écrire une.

**Tout le monde voit tout**, contrairement aux préférences alimentaires.
Chaque idée porte ses comptes, et un pli « qui a dit quoi » donne les noms
des trois groupes. On se décide pour une randonnée en sachant qui vient ;
la question n'a pas de sens amputée des autres, exactement comme le plan de
couchage — et à l'inverse de ce que mange le cousin.

**N'importe qui ajoute à la liste.** Un panneau pliable, sous les pastilles
de personnes, prend un intitulé et une précision facultative. C'est la seule
page où la famille pose une ligne que tu n'as pas prévue. Deux intitulés qui
ne diffèrent que par la casse, les accents ou la ponctuation sont la même
idée : la base les refuse, sans quoi les voix se partageraient entre deux
lignes qui disent la même chose.

**Retirer reste à toi**, dans l'onglet **Activités** : une idée effacée
emporte les réponses de tout le monde, et la question posée avant le dit —
« 14 réponse(s) partent avec ». Le même onglet montre les comptes et un
tableau d'ensemble, une ligne par personne et une colonne par idée. Ce
tableau **se lit et ne se remplit pas** : une allergie se saisit pour
quelqu'un qui n'ouvrira pas la page, une envie non.

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

Sous les week-ends, **« Résultat des choix »** donne l'état courant, et
il est visible de tous. C'est un **panneau pliable**, replié par défaut : on
vient répondre, pas consulter — et son résumé porte la participation, de
quoi savoir s'il vaut la peine d'ouvrir. Dedans : le classement, une barre
par week-end — vert pour les oui, rouge pour les non, gris pour ceux qui
n'ont rien dit — et le nombre de gens qui se sont prononcés. Le classement
suit le nombre de **oui** : combien de personnes peuvent venir.

**Et qui a répondu quoi**, sous un second pli, week-end par week-end. Les
noms étaient tus au début — savoir qui a dit non ne regarde personne — et
ce silence se défendait mal : on choisit une date en sachant qui pourra
venir, et c'est souvent la vraie question. La page des activités dit déjà
« qui a dit quoi » pour exactement cette raison. Ce qui reste réservé n'a
jamais été les réponses, c'est ce que mange le cousin.

Les trois groupes se forment dans la page : la base sert les réponses
brutes, et **« sans réponse » n'est pas une donnée** — c'est le reste de la
famille.

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

> **L'inventaire sert trois fois**, et c'est pourquoi il vaut mieux le poser
> tôt : il remplit la colonne « la nuit… » de la grille — « en gîte — 4
> pers. » plutôt que « en gîte » —, il fournit les rectangles du plan de
> couchage, et il permet à l'import du tableur de retrouver « gîte 4
> places ». L'import le dit quand un type lui manque, et il est rejouable.

**Rien n'est écrit dans le code.** L'inventaire est une table, pas des
colonnes : un hôtel a deux sortes de chambres, un village de vacances en a
six, et le schéma n'a pas à changer entre deux éditions. Une autre année,
un autre lieu — on retape l'inventaire, comme on retape les dates du
séjour, et le reste suit.

## Le plan de couchage

Deux fois la même chose, à deux endroits : sous l'inventaire dans l'onglet
**Logements** d'`admin.html`, et **sous la grille** de
[`presences.html`](presences.html) pour toute la famille. L'inventaire dit
**combien** de couchages ; le plan dit **qui est dans lequel**.

Sous la grille, et non sur une page à part : on dit d'abord **quelles nuits**
on dort sur place, et seulement ensuite **où**. Une personne ne paraît dans
le plan d'une nuit que si elle a déclaré y dormir — un plan placé avant la
grille montrerait un plateau vide à qui n'a encore rien rempli. Enregistrer
la grille recharge donc le plan : décocher une nuit en retire la personne.

Le plateau lui-même vit dans [`plan.js`](plan.js), partagé par les deux
pages. C'est l'exception au « chaque page porte ses propres aides » du reste
du projet : cette convention vaut pour des fonctions de trois lignes, pas
pour un plateau de jeu. Deux copies auraient fini par se contredire, et la
contradiction se serait vue sur le couchage de quelqu'un.

### Chacun déplace les siens

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

La base ne garde que l'état courant : ce qui est remplacé n'existe plus
nulle part. Il a existé ici une copie par semaine ; elle répondait à
« revenir à lundi », jamais à « défaire ça ».

L'historique a donc **deux étages**.

### Les gestes

**Un geste est un appel**, c'est-à-dire une transaction : « Alice
enregistre sa grille » est **une** ligne de l'historique, pas quarante.
L'onglet **Historique** les montre du plus récent au plus ancien — date,
qui, quoi, combien de lignes :

```
jeudi 1 octobre 14:32  Alice          Présences              12 ligne(s)  [Annuler]
jeudi 1 octobre 09:10  organisateur   Grille des tarifs      28 ligne(s)  [Annuler]
mercredi 30 sept 18:00 Bruno          Refus de lieux   déjà annulé
◆ jalon du 29 septembre · repli de l'historique          [Comparer] [Restaurer]
```

Déplier une ligne montre **ce qu'elle a changé**, champ par champ —
« dîner : non → oui », « capacité : 2 → 3 » — et non un bloc de JSON.
L'identifiant et l'horodatage n'y figurent pas : ils bougent à chaque
enregistrement, même quand la valeur ne bouge pas.

**Annuler** réécrit l'avant, et rien d'autre : ce qui a été fait depuis
reste. L'annulation est **elle-même un geste**, comme `git revert` —
l'historique ne se réécrit jamais, et un retour en arrière se reprend
comme le reste. Si une des lignes a bougé entre-temps, la base refuse et la
page demande avant d'écraser.

**Trois passes, et dans cet ordre** — un seul parcours ne suffit pas :

1. les lignes que le geste a **créées** s'effacent, **enfants avant
   parents** (par rang décroissant) ;
2. les lignes qu'il a **supprimées** se reposent, **parents avant
   enfants** — une présence ne peut pas revenir avant la personne qu'elle
   désigne ;
3. les lignes qu'il a **modifiées** reprennent leur valeur par un
   `UPDATE`.

Le point 3 n'est pas un détail de style. Il a d'abord été écrit comme un
`delete` suivi d'un `insert` — et sur `participants`, le `delete` emportait
par **cascade** les présences, les couchages, les vœux et les refus de la
personne, puis l'`insert` reposait une personne nue. **Annuler « végétarien :
non → oui » effaçait un séjour entier.** Un test l'interdit désormais, et un
autre vérifie que le rang des tables s'accorde avec les clés étrangères
déclarées — les deux sont écrits à deux endroits, et leur désaccord ne se
verrait que le jour où l'on en a le plus besoin.

Une exception assumée : annuler un geste qui a **créé** quelque chose le
supprime, et supprime avec lui ce qui en dépendait. Ces suppressions-là
**entrent dans l'historique** comme le reste, ligne par ligne : l'annulation
de l'annulation les repose toutes.

**Annuler tout ce qui suit une date** défait les gestes du plus récent au
plus ancien, **en une seule fois** : c'est une décision, elle se reprend
d'un coup.

### Comment c'est capturé

Un **déclencheur par table**, posé en boucle depuis `private.tracees()` :
chaque ligne touchée y laisse son **avant** et son **après**, et c'est ce
couple qui rend l'annulation possible sans rejouer l'histoire. Rien à
penser au moment d'écrire une nouvelle fonction, rien à oublier.

Les fonctions qui écrivent posent seulement une **étiquette**, en tête —
`private.geste('Présences', p_acteur)` — là où vivait l'appel à la copie
hebdomadaire. C'est la seule part qui ne s'automatise pas : le déclencheur
sait *quelles* lignes ont bougé, jamais pourquoi. Une fonction qui
l'oublierait ne casserait rien et ne se verrait pas — d'où un test qui
croise les écritures et les étiquettes.

**Ce qui n'est pas tracé** : les codes d'accès. Annuler un changement de
code enfermerait la famille dehors.

### Les jalons, et le repli

Un **jalon** est un état complet. Il se prend à la demande, et surtout par
**repli** : tous les `compactage_jours` (60 par défaut, réglable, **0 pour
jamais**), les gestes atomiques se replient en un seul jalon — annulable
d'un bloc, mais qu'on ne détaille plus. C'est ce qui garde la liste
lisible ; accessoirement, c'est ce qui borne le poids.

**Restaurer un jalon** remplace toute la base par cet état **et efface
l'historique détaillé** : il décrirait des gestes posés sur un état qui
n'existe plus. Un jalon de l'état actuel est pris juste avant, pour que ce
geste-là s'annule aussi. Et la restauration **ne se trace pas** : le
`TRUNCATE` qui la précède n'émet aucun déclencheur de ligne, le geste ne
porterait donc que les réinsertions — et l'annuler effacerait tout sans
rien reposer. Pire qu'un geste absent.

**Comparer** un jalon à maintenant montre ce qui a changé depuis, par
personne et par table. Le calcul se fait dans le navigateur, et non en SQL :
la base sert des faits, les dérivées se calculent là où elles s'éprouvent.

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
7. **Tarifs** — ils se règlent dans l'onglet **Tarifs** d'`admin.html`,
   quand l'hôtel sera connu : un tableau par type de couchage posé dans
   l'onglet Logements. `config.toml` (copié de `config.example.toml`) ne
   porte plus que le nom du séjour et la devise.

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
**tarifs manquants** (les prix à zéro ou absents) et anomalies de saisie.

Les prix viennent de la base, pas d'un fichier. Une chambre se facture par
personne selon sa tranche d'âge ; un **gîte se facture entier**, et la note
se partage entre ceux qui y dorment cette nuit-là — c'est le **plan de
couchage** qui le dit, et une nuit de gîte sans place attribuée n'est
facturée à personne, mais ressort dans les anomalies.

La **taxe de séjour** se règle en une case, par adulte et par nuit. Elle
ne suit aucune des règles des prix : pas de remise, pas de régime, pas de
partage entre les occupants d'un gîte — c'est la personne qui la doit. Elle
paraît en ligne à part sur la facture, et les mineurs en sont exonérés.

Les **repas hors pension** ont un prix ordinaire par repas et par tranche
d'âge, et des **jours qui font exception** — le dîner du samedi n'est pas
celui du mardi. On n'y pose que les jours qui s'écartent du prix ordinaire.

L'onglet **Facture** montre la même chose dans le navigateur, sans lancer
de script. Quatre panneaux, une ligne par personne : **ce que chacun paie**,
en tête et déplié ; **en résumé** ; **les nuits**, une colonne par nuit du
séjour, puis la taxe et le total avec et sans elle ; **les repas hors
pension**, une colonne par repas réellement servi. Chaque famille ferme sur
sa somme. Le calcul y est écrit deux fois — en Python pour l'export, en
JavaScript pour la page, qui ne peut pas appeler le premier — et
[`tests/test_facture.py`](tests/test_facture.py) les compare au centime sur
deux jeux de données à chaque exécution de la suite.

**Chaque montant est suivi de ce qu'il achète** : l'hébergement par nuitée,
les repas par repas, et le total ramené aux nuitées puis aux deux à la fois.
Sans quoi le plus gros total est toujours celui qui est resté le plus
longtemps — ce qu'on savait déjà. Ces colonnes **ne s'additionnent pas** :
deux personnes à 45 € la nuit n'en font pas une à 90, et les lignes de total
refont donc la division sur les deux sommes — la dépense de la famille
divisée par ses nuitées, et non la moyenne de ses moyennes. Les repas
comptés sont ceux qui sont **facturés** : un dîner compris dans une pension
est déjà payé avec la nuit.

Le panneau **En résumé** donne la *forme* de la dépense là où les tableaux
en donnent le montant : moyenne, écart-type, minimum et maximum, pour les
repas par personne, l'hébergement par personne, le total par personne et le
total par personne et par nuit. Un écart-type proche de zéro dit que tout le
monde paie à peu près la même chose ; large, il dit que la moyenne ne
représente personne. C'est celui de la **population**, pas d'un échantillon —
on a tout le monde sous la main, on n'estime rien. La dernière ligne ne
compte que ceux qui dorment sur place : un prix par nuit n'existe pas pour
qui n'en a déclaré aucune, et le compter zéro répondrait à une autre
question. Chaque ligne dit sur combien de personnes elle porte quand ce
n'est pas tout le monde, et le calcul se relit dans la suite de tests avec
le module `statistics` de Python.

**Chacun lit sa note**, sur [`facture.html`](facture.html) : la sienne et
celle des gens dont il remplit les présences — la règle de
`personnes_modifiables`, comme partout ailleurs. Les mêmes trois tableaux
que les tiens, parce que c'est le **même module** qui les dessine
([`tableaux.js`](tableaux.js)) à partir du **même calcul**
([`facture.js`](facture.js)) : celui qui demande l'argent et celui qui le
paie doivent lire la même chose. Avec une différence assumée : le
récapitulatif familial n'a que **hébergement, repas, total**. Les colonnes
*par nuitée* et *par repas* servent à comparer soixante séjours de longueurs
différentes — sur sa propre note, elles ne font qu'un tableau de plus à
déchiffrer. La page ne porte ni champ ni bouton
d'enregistrement ; pour changer un montant, on change ce qu'il compte, sur
**Les présences**.

**Ce que la base lui envoie s'arrête à ce qui le regarde** — à une
exception près, et elle est nécessaire. Un gîte se loue entier et sa note
se divise entre ceux qui y dorment cette nuit-là : sans savoir combien ils
sont, la part affichée serait fausse, et **plus chère**, puisqu'on
diviserait par les seuls occupants visibles. `facture_charger` joint donc
les **co-occupants de gîte**, et seulement pour les nuits partagées —
réduits à ce qui fait la division : une nuit, dans un gîte. Pas leur âge,
pas leurs repas, pas même leur prénom, rien de ce qui permettrait de
chiffrer ce qu'eux paient. Et qu'untel dorme dans tel gîte, le plan de
couchage le montre déjà à toute la famille. Un banc d'essai tient l'écart :
sans le co-occupant, la part passe de 101 € à 201 €.

**Les noms se lisent dans l'ordre de l'arbre**, partout : le couple de
première génération le plus âgé, sa descendance dessous du plus âgé au plus
jeune, les conjoints côte à côte. Une seule définition en base
(`private.ordre_familial`), et toutes les listes s'y rangent — celle de
l'organisateur, les pastilles « pour qui remplis-tu », le plateau de
couchage, la facture. Sans date de naissance, on passe en fin de fratrie :
ne pas savoir n'est pas être jeune.

L'onglet **Hôtel** met en forme ce qu'on lui envoie. Un **détail du séjour**
d'abord, sur le modèle d'un contrat de réservation : une ligne par
prestation — « Pension complète — chambre de 2 — week-end — adultes » —
avec sa quantité, son prix unitaire, sa remise et son montant. C'est le même
argent que l'onglet Facture, regroupé autrement ; un test exige que les deux
façons de compter tombent sur le même total. Puis combien d'exemplaires
de chaque type de couchage sont occupés nuit par nuit, et combien de
couverts à chaque repas — par tranche d'âge, avec le compte des végétariens,
vegans, sans gluten et sans alcool attablés. **Aucun nom n'y figure** :
l'hôtel n'a pas besoin de savoir qui, et ce qui ne sort pas ne se perd pas.

**Les cinq pages familiales s'ouvrent et se ferment depuis un seul
panneau**, dans l'onglet Séjour : une case par page, plus « tout fermer » et
« tout rouvrir ». Fermer ne cache rien — la page se lit encore, on voit ce
qu'on a dit et où en sont les autres, mais plus rien ne s'enregistre. C'est
la base qui refuse ; la page le montre seulement. Les préférences
alimentaires et les activités ont chacune leur verrou : on ferme les
présences quand le nombre est arrêté, alors qu'une allergie se déclare
encore après et qu'une sortie se décide bien avant.

## Points à connaître

**Absent est l'état par défaut, et ça se voit dans la grille.** La colonne
de gauche ne demande qu'une chose — **où l'on dort** : « pas sur place »,
« en chambre », « en chambre, vue mer », « en gîte ». Ces mots ne disent
plus comment ça se facture&nbsp;— ils ne désignent qu'une ligne de
l'inventaire, qui porte ses trois réponses (voir plus haut). La vue mer y figure
comme une variante de chambre, et non comme une case à part : elle tenait
une colonne entière, désactivée les trois quarts du temps puisque seule une
chambre peut l'avoir. La base, elle, garde deux champs — un hébergement et
un supplément — parce que c'est ainsi que l'hôtel facture.

**Et les tailles de l'inventaire s'y ajoutent** : « en gîte — 4 pers. », « en
gîte — 6 pers. », chacune juste après sa catégorie. Le tableur d'origine
faisait cette différence ; la base ne connaissait que « gîte », et l'import
l'écrasait faute d'un endroit où la mettre. `presences.logement_id` pointe
désormais vers une ligne de l'inventaire — vers un **type**, « un gîte de
six », et non vers un exemplaire : quel gîte au juste est une question de
plan de couchage.

**Le générique disparaît dès qu'une taille existe** : à côté de « en chambre
— 2 pers. », un « en chambre » tout court ne dit rien de plus, et un doublon
dans une liste déroulante est une hésitation qu'on impose à soixante
personnes. Il reste offert dans deux cas, et deux seulement :

- **l'inventaire ignore cette catégorie.** Sans lui, elle deviendrait
  indicible, et la grille doit se remplir avant que tout soit saisi ;
- **quelqu'un l'a déjà déclarée sans taille.** Le retirer alors ne
  supprimerait pas sa réponse : il la rendrait irreprésentable, et le
  prochain enregistrement l'écraserait en silence. Il porte dans ce cas la
  mention « sans précision », qui le distingue de ses tailles.

Le second cas n'est pas théorique : le tableur ne donne la capacité **que
des gîtes** — `chambre_4` y est la chambre n° 4, pas une chambre de quatre.
Toutes les chambres importées arrivent donc sans taille.

**L'import leur en donne une d'office.** La taille d'une chambre est un
fait du *lieu*, pas du fichier : `--chambre-pers` la dit, et vaut **2** par
défaut. Une chambre avec vue n'y est pas soumise — c'est une autre ligne
d'inventaire — mais la base la reconnaît seule tant qu'il n'existe qu'une
sorte de chambre avec vue : sans capacité citée, un type unique dans sa
catégorie ne laisse rien à choisir. Dès qu'il y en a deux, elle s'abstient.

Il reste **« Donner une taille aux déclarations qui n'en ont pas »**, dans
l'onglet Logements, pour ce qui a échappé à ces deux règles : on choisit un
type, et toutes les déclarations de sa catégorie qui n'en avaient pas le
prennent. Celles qui en
ont déjà une ne bougent pas — même d'une autre taille : quelqu'un qui a
choisi « chambre 3 pers. » l'a choisi, et un bouton de rattrapage n'a pas à
le contredire. La vue mer sépare, c'est une autre ligne d'inventaire et un
autre tarif. Le bloc disparaît dès qu'il n'y a plus rien à préciser, et une
il entre dans l'historique comme un seul geste : il touche
potentiellement toute la saisie, et se défait d'un clic.

`hebergement` reste renseigné dans tous les cas et garde la facture : **le
type précise, il ne remplace pas**.
Quand il est là, c'est pourtant lui qui fait foi — la catégorie et le
supplément s'en déduisent à l'enregistrement, parce que deux sources pour un
même fait finissent toujours par se contredire, et qu'ici la contradiction
se lirait sur une facture.

Retirer un type de l'inventaire ne casse rien : la déclaration redevient
générique (`on delete set null`), la personne garde sa présence. Et dans le
plan de couchage, l'écart se juge alors sur le type : un gîte de quatre
n'est pas un gîte de six.

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
