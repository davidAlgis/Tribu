"use strict";

// Lire les resultats, dessines une seule fois pour deux pages.
//
// La famille les lit sur `dates.html` et `lieux.html`, l'organisateur sur
// `admin.html` : le meme classement des week-ends, la meme carte, les memes
// noms au meme endroit. Deux copies de ce fichier, et c'est deux lectures
// qui divergent le jour ou l'une gagne une phrase -- celui qui organise et
// ceux qui repondent ne verraient plus la meme chose.
//
// CE MODULE NE SAISIT RIEN ET N'APPELLE PAS LA BASE. Il recoit ce que
// `dates_charger`, `lieux_charger`, `admin_dates_lister` et `admin_lieux`
// servent, et le met en page.

window.RESULTATS = (function () {
  const SVG = "http://www.w3.org/2000/svg";

  // Prenoms, familles et intitules viennent de la base, et la base tient ce
  // que le GEDCOM lui a donne : des chaines qu'aucun humain n'a relues.
  // Passees a innerHTML, elles seraient interpretees comme du balisage. On
  // fabrique donc les noeuds un par un : textContent pose du texte, et rien
  // d'autre.
  function fort(texte) {
    const element = document.createElement("strong");
    element.textContent = texte;
    return element;
  }

  function span(texte, classe) {
    const element = document.createElement("span");
    element.textContent = texte;
    if (classe) element.className = classe;
    return element;
  }

  // Les prenoms se repetent dans une famille de quatre-vingts personnes. On
  // n'ajoute la precision que lorsqu'elle sert : « Alice (Bernard) » partout
  // alourdirait une liste ou la moitie des prenoms sont uniques.
  function nommer(personne, tous) {
    const homonymes = (tous || []).filter((p) => p.prenom === personne.prenom).length > 1;
    return homonymes && personne.famille && personne.famille !== personne.prenom
      ? `${personne.prenom} (${personne.famille})`
      : personne.prenom;
  }

  function liste(personnes, tous) {
    return personnes.length ? personnes.map((p) => nommer(p, tous)).join(", ") : "personne";
  }

  // ------------------------------------------------------------ sondage
  //
  // Ou en est le choix de la date, pour tout le monde et pas seulement pour
  // l'organisateur : le classement, la participation, et qui a repondu quoi.

  // Le classement se lit sur le nombre de OUI : combien de personnes
  // peuvent venir. Il n'y a plus de ponderation a expliquer depuis que la
  // reponse est binaire -- le score et le compte des oui sont le meme
  // nombre, autant n'en garder qu'un.
  function classer(options, participants) {
    const lignes = (options || []).map((o) => {
      const repondu = o.oui + o.non;
      return {
        ...o,
        repondu,
        // Ceux qui n'ont rien dit sur CE week-end. Ils comptent : un
        // week-end en tete avec trois reponses sur vingt n'est pas un
        // resultat.
        muets: Math.max(0, (participants || 0) - repondu),
      };
    });

    lignes.sort(
      (a, b) =>
        b.oui - a.oui ||
        // A egalite, celui qui bloque le moins de monde passe devant.
        a.non - b.non ||
        String(a.date_debut || "").localeCompare(String(b.date_debut || "")) ||
        a.libelle.localeCompare(b.libelle, "fr")
    );

    // Le rang suit le COUPLE (oui, non), pas la position : a nombre de oui
    // egal, celui qui a moins de non passe devant ET prend un meilleur rang.
    // Seuls deux week-ends qui ont les memes oui et les memes non partagent
    // leur place, et il n'y a alors pas de rang suivant.
    //
    // Le tri les rangeait deja ainsi, mais le rang ne regardait que les oui :
    // deux week-ends a 6 oui, l'un a 0 non et l'autre a 4, s'affichaient tous
    // deux « 1er » -- la liste disait un ordre, les etiquettes un autre.
    let rang = 0;
    let precedent = null;
    lignes.forEach((l, i) => {
      if (precedent === null || l.oui !== precedent.oui || l.non !== precedent.non) rang = i + 1;
      l.rang = rang;
      precedent = l;
    });

    return {
      lignes,
      tete: lignes.filter((l) => l.rang === 1),
      // Personne n'a rien dit : il n'y a pas de resultat, et le dire vaut
      // mieux que de couronner un week-end a zero point.
      vide: lignes.every((l) => l.repondu === 0),
    };
  }

  function ordinal(rang) {
    return rang === 1 ? "1er" : `${rang}e`;
  }

  // Ce qu'il faut retenir en une phrase, avant le detail.
  function verdictTexte(classement) {
    if (classement.vide) {
      return "Personne n'a encore répondu : le classement apparaîtra ici dès les premières réponses.";
    }
    const tete = classement.tete;
    const oui = `${tete[0].oui} oui`;
    if (tete.length === 1) {
      return `« ${tete[0].libelle} » tient la corde, avec ${oui} sur ${tete[0].repondu} réponse(s).`;
    }
    const noms = tete.map((l) => `« ${l.libelle} »`).join(" et ");
    return `${tete.length} week-ends à égalité parfaite, avec ${oui} et ${tete[0].non} non : ${noms}.`;
  }

  function participationTexte(donnees) {
    const total = donnees.participants || 0;
    const repondants = donnees.repondants || 0;
    if (!total) return "";
    if (!repondants) return `personne n'a répondu sur ${total}`;
    // Sous la moitie, le classement est une tendance, pas un resultat : le
    // dire evite qu'on arrete une date sur trois reponses.
    const reserve = repondants * 2 < total ? " — encore peu, le classement peut bouger" : "";
    return `${repondants} personne(s) sur ${total} ont répondu${reserve}`;
  }

  // La barre ne porte aucune information que les chiffres en dessous ne
  // donnent pas : elle est donc masquee aux lecteurs d'ecran, qui liraient
  // autrement une suite de vides.
  function barre(ligne, base) {
    const b = document.createElement("div");
    b.className = "barre";
    b.setAttribute("aria-hidden", "true");
    const segments = [
      ["b-oui", ligne.oui],
      ["b-non", ligne.non],
      ["b-muet", ligne.muets],
    ];
    for (const [classe, n] of segments) {
      if (!n) continue;
      const seg = document.createElement("span");
      seg.className = classe;
      seg.style.width = `${(n / base) * 100}%`;
      b.appendChild(seg);
    }
    return b;
  }

  // QUI A DIT QUOI, derriere un pli. Les totaux repondent a « ce week-end
  // tient-il la corde » ; les noms repondent a « est-ce que mon frere peut
  // venir », et c'est souvent la vraie question.
  //
  // Les trois groupes se forment ici : « sans reponse » n'est pas une
  // donnee, c'est le reste de la famille. La base sert les reponses brutes.
  const NOMS_CHOIX = [
    ["oui", "Oui"],
    ["non", "Non"],
    ["muet", "Sans réponse"],
  ];

  function grouperReponses(donnees, optionId) {
    const dit = new Map(
      (donnees.reponses || [])
        .filter((r) => r.option_id === optionId)
        .map((r) => [r.participant_id, r.choix])
    );
    const groupes = { oui: [], non: [], muet: [] };
    for (const personne of donnees.tous || []) {
      groupes[dit.get(personne.id) || "muet"].push(personne);
    }
    return groupes;
  }

  // Le pli lui-meme, pour un week-end comme pour un departement : `groupes`
  // porte trois listes de personnes, `oui`, `non` et `muet`.
  function pliQuiADitQuoi(cle, groupes, tous, deplies) {
    const pli = document.createElement("details");
    pli.className = "qui-a-dit";
    // Rouvrir ce qu'on avait ouvert : la liste se redessine a chaque
    // enregistrement, et un panneau qui se referme sous le doigt agace.
    pli.open = deplies.has(cle);
    pli.addEventListener("toggle", () => {
      if (pli.open) deplies.add(cle);
      else deplies.delete(cle);
    });

    const resume = document.createElement("summary");
    resume.textContent = "Qui a répondu quoi";
    pli.appendChild(resume);

    for (const [clef, libelle] of NOMS_CHOIX) {
      const bloc = document.createElement("p");
      bloc.className = "note";
      bloc.append(fort(libelle), ` (${groupes[clef].length}) — `, liste(groupes[clef], tous));
      pli.appendChild(bloc);
    }
    return pli;
  }

  function quiADitQuoi(ligne, donnees, deplies) {
    return pliQuiADitQuoi(ligne.id, grouperReponses(donnees, ligne.id), donnees.tous, deplies);
  }

  // `zones` : { classement, verdict, participation, deplies, afficherJour }.
  // Les deux pages n'ecrivent pas les dates de la meme facon -- la famille
  // les lit en toutes lettres, l'organisateur en abrege -- d'ou la fonction.
  function dessinerSondage(donnees, zones) {
    const classement = classer(donnees.options, donnees.participants);

    // Entre parentheses, et seulement s'il y a quelque chose a dire : la
    // legende se lit « Résultat des choix (12 personnes sur 20 ont répondu) ».
    const combien = participationTexte(donnees);
    zones.participation.textContent = combien ? `(${combien})` : "";

    zones.verdict.className = classement.vide ? "note" : "note resultat";
    zones.verdict.textContent = verdictTexte(classement);

    zones.classement.textContent = "";
    for (const ligne of classement.lignes) {
      const item = document.createElement("li");

      const titre = document.createElement("div");
      titre.className = "rang-titre";
      titre.append(span(ordinal(ligne.rang), "etiquette"), fort(ligne.libelle));
      if (ligne.date_debut && ligne.date_fin) {
        titre.append(
          span(
            `du ${zones.afficherJour(ligne.date_debut)} au ${zones.afficherJour(ligne.date_fin)}`,
            "lien"
          )
        );
      }

      const chiffres = document.createElement("div");
      chiffres.className = "rang-chiffres";
      chiffres.textContent =
        `${ligne.oui} oui · ${ligne.non} non` +
        (ligne.muets ? ` · ${ligne.muets} sans réponse` : "");

      item.append(titre, barre(ligne, donnees.participants || ligne.repondu || 1), chiffres);
      item.appendChild(quiADitQuoi(ligne, donnees, zones.deplies));
      zones.classement.appendChild(item);
    }
  }

  // -------------------------------------------------------------- carte
  //
  // Le fond de carte, ses villes repere, les teintes de la vue famille, et
  // la bulle qui donne les noms au survol d'un departement.

  // Largeur approchee d'un nom, en unites du viewBox. Mesurer le texte pour
  // de vrai supposerait de l'avoir deja insere ; cette estimation suffit a
  // decider de quel cote l'ecrire.
  const HAUTEUR_NOM = 27;

  function largeurNom(nom) {
    return nom.length * HAUTEUR_NOM * 0.52;
  }

  // Un nom s'ecrit a droite de son point, sauf dans deux cas : pres du bord
  // est, ou il sortirait du cadre, et quand une autre ville se trouve juste
  // derriere, ou il la recouvrirait — c'est le cas de Clermont-Ferrand, dont
  // le nom mesure plus que la distance qui le separe de Lyon.
  function ecrireAGauche(ville, largeur) {
    if (ville.x + largeurNom(ville.n) > largeur * 0.97) return true;

    return (window.CARTE.villes || []).some(
      (autre) =>
        autre !== ville &&
        autre.x > ville.x &&
        autre.x - ville.x < largeurNom(ville.n) + 14 &&
        Math.abs(autre.y - ville.y) < 22
    );
  }

  // Les villes servent a se reperer : sans elles, difficile de dire si l'on
  // peint au-dessus ou au-dessous de Lyon.
  //
  // La couche entiere ignore la souris : sans `pointer-events: none`, un nom
  // de ville interposerait un trou dans lequel le pinceau ne peindrait pas,
  // et la bulle du survol s'eteindrait en passant dessus.
  function dessinerVilles(svg) {
    const couche = document.createElementNS(SVG, "g");
    couche.setAttribute("id", "couche-villes");

    const largeur = Number(window.CARTE.viewBox.split(" ")[2]);

    for (const ville of window.CARTE.villes || []) {
      const point = document.createElementNS(SVG, "circle");
      point.setAttribute("cx", ville.x);
      point.setAttribute("cy", ville.y);
      point.setAttribute("r", 6.5);
      point.classList.add("ville-point");

      const aGauche = ecrireAGauche(ville, largeur);
      const nom = document.createElementNS(SVG, "text");
      nom.setAttribute("x", ville.x + (aGauche ? -12 : 12));
      nom.setAttribute("y", ville.y + 9);
      if (aGauche) nom.setAttribute("text-anchor", "end");
      nom.textContent = ville.n;
      nom.classList.add("ville-nom");

      couche.append(point, nom);
    }
    svg.appendChild(couche);
  }

  // Les departements puis les villes. Rend la table code -> <path>, que les
  // pages colorient comme elles l'entendent.
  //
  // Pas de `<title>` sur les departements : l'infobulle du navigateur
  // s'ajouterait a la notre, deux bulles l'une sur l'autre.
  function dessinerFond(svg) {
    // Redessiner, c'est repartir de la carte entiere : la page redessine
    // apres chaque enregistrement, et un zoom qu'on gardait alors cachait
    // ce qui venait d'etre enregistre.
    if (svg.__zoom) svg.__zoom.reinitialiser();
    else svg.setAttribute("viewBox", window.CARTE.viewBox);
    svg.textContent = "";
    const formes = new Map();

    for (const dep of window.CARTE.departements) {
      const forme = document.createElementNS(SVG, "path");
      forme.setAttribute("d", dep.d);
      forme.dataset.code = dep.c;
      forme.classList.add("dep");
      svg.appendChild(forme);
      formes.set(dep.c, forme);
    }

    dessinerVilles(svg);
    return formes;
  }

  // UNE TEINTE PAR NOMBRE DE REFUS, ET UNE ECHELLE QUI S'ADAPTE.
  //
  // Elle plafonnait a trois : au-dela, tout etait rouge. Avec soixante
  // personnes et des refus un peu partout, la carte entiere virait au
  // rouge uni, et ne disait plus rien. L'echelle va maintenant de UN refus
  // (vert-jaune) au PLUS GRAND nombre de refus observe (rouge), en passant
  // par l'ambre : la teinte se lit par rapport aux autres departements,
  // pas par rapport a un seuil arbitraire.
  //
  // Aucun refus reste le vert franc, hors de l'echelle : « personne ne
  // refuse » est une autre information que « peu de monde refuse ». Et
  // l'echelle ne descend pas sous trois : quand il n'y a que deux ou trois
  // refus au plus, un seul ne doit pas peindre un departement en rouge.
  const ECHELLE_MINIMALE = 3;
  const VERT = "#6aab84";
  const ARRETS = [
    [0, [182, 201, 138]], // un refus
    [0.5, [224, 177, 103]], // ambre
    [1, [192, 57, 43]], // le plus refuse
  ];

  function teinte(t) {
    const x = Math.min(1, Math.max(0, t));
    for (let i = 1; i < ARRETS.length; i++) {
      const [fin, couleurFin] = ARRETS[i];
      const [debut, couleurDebut] = ARRETS[i - 1];
      if (x <= fin) {
        const k = (x - debut) / (fin - debut);
        const rgb = couleurDebut.map((c, n) => Math.round(c + (couleurFin[n] - c) * k));
        return `rgb(${rgb.join(",")})`;
      }
    }
    return `rgb(${ARRETS[ARRETS.length - 1][1].join(",")})`;
  }

  function plusGrand(totaux) {
    return Math.max(0, ...Object.values(totaux || {}).map(Number));
  }

  function couleurRefus(n, maximum) {
    if (!(n > 0)) return VERT;
    const echelle = Math.max(maximum, ECHELLE_MINIMALE);
    return teinte((n - 1) / (echelle - 1));
  }

  function colorierFamille(formes, totaux) {
    const maximum = plusGrand(totaux);
    for (const [code, forme] of formes) {
      forme.classList.remove("refuse");
      forme.style.fill = couleurRefus((totaux || {})[code] || 0, maximum);
    }
  }

  // Rend aux departements la couleur de la feuille de style : la vue
  // « Ma carte » les peint par classe, et un `fill` en ligne passerait
  // devant.
  function effacerFamille(formes) {
    for (const forme of formes.values()) forme.style.fill = "";
  }

  // Des nombres, rien que des nombres : c'est ce qui rend `innerHTML` sans
  // risque ici. Y glisser un nom demanderait span().
  function legendeFamille(formes, totaux) {
    const acceptes = [...formes.keys()].filter((c) => !((totaux || {})[c] > 0)).length;
    const maximum = plusGrand(totaux);
    // Sous trois refus au plus, le rouge n'est jamais atteint : on ne
    // l'annonce pas comme « 2 refus ».
    const haut = maximum >= ECHELLE_MINIMALE ? `${maximum} refus` : `${ECHELLE_MINIMALE} refus ou plus`;
    // Le degrade de la legende suit l'echelle : meme couleurs, memes arrets.
    const degrade = [0, 0.25, 0.5, 0.75, 1].map((t) => teinte(t)).join(", ");
    return (
      `<span class="pastille-legende vert"></span> aucun refus (${acceptes}) ` +
      `<span class="legende-echelle">1 refus` +
      `<span class="degrade-legende" style="background: linear-gradient(to right, ${degrade})"></span>` +
      `${haut}</span>`
    );
  }

  // ------------------------------------------------------- zoom et pan
  //
  // MOLETTE pour zoomer, MOLETTE ENFONCEE pour deplacer. Un departement
  // comme Paris ne tient pas sous le doigt a l'echelle de la France, et les
  // petites couronnes se perdent sur une carte entiere.
  //
  // Le zoom ne touche qu'a l'attribut `viewBox` : les departements, les
  // villes et le pinceau gardent leurs coordonnees, et tout ce qui passe
  // par la matrice du navigateur (`getScreenCTM`) suit sans rien savoir du
  // zoom. Le niveau est aussi pose en `--zoom` sur le SVG : les noms de
  // villes et les traits s'en servent pour garder la meme taille a l'ecran
  // au lieu de grossir avec la carte.
  //
  // Des boutons + / - / « voir toute la carte » doublent la molette : un
  // pave tactile sans molette, ou un doigt, n'ont pas d'autre moyen.

  const ZOOM_MAX = 8;

  function brancherZoom(svg, cadre) {
    const [x0, y0, L, H] = window.CARTE.viewBox.split(" ").map(Number);
    const vue = { x: x0, y: y0, w: L, h: H };

    const borne = (v, min, max) => Math.min(max, Math.max(min, v));

    function niveau() {
      return L / vue.w;
    }

    function appliquer() {
      svg.setAttribute("viewBox", `${vue.x} ${vue.y} ${vue.w} ${vue.h}`);
      svg.style.setProperty("--zoom", niveau());
      const zoome = niveau() > 1.001;
      svg.classList.toggle("zoome", zoome);
      tout.hidden = !zoome;
    }

    // La carte ne sort jamais de son cadre d'origine : on ne peut pas
    // l'envoyer dans le vide et ne plus la retrouver.
    function borner() {
      vue.x = borne(vue.x, x0, x0 + L - vue.w);
      vue.y = borne(vue.y, y0, y0 + H - vue.h);
    }

    function pointSVG(e) {
      const p = svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }

    // Zoome en gardant `centre` (en unites de la carte) sous le curseur.
    function zoomer(facteur, centre) {
      const w = borne(vue.w / facteur, L / ZOOM_MAX, L);
      const k = w / vue.w;
      vue.x = centre.x - (centre.x - vue.x) * k;
      vue.y = centre.y - (centre.y - vue.y) * k;
      vue.h *= k;
      vue.w = w;
      borner();
      appliquer();
    }

    function reinitialiser() {
      Object.assign(vue, { x: x0, y: y0, w: L, h: H });
      appliquer();
    }

    function auCentre() {
      return { x: vue.x + vue.w / 2, y: vue.y + vue.h / 2 };
    }

    // Les boutons.
    const commandes = document.createElement("div");
    commandes.className = "carte-zoom";
    function bouton(texte, titre, action) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = texte;
      b.title = titre;
      b.setAttribute("aria-label", titre);
      b.addEventListener("click", action);
      commandes.appendChild(b);
      return b;
    }
    bouton("+", "Zoom avant", () => zoomer(1.5, auCentre()));
    bouton("\u2212", "Zoom arrière", () => zoomer(1 / 1.5, auCentre()));
    const tout = bouton("\u2302", "Voir toute la carte", reinitialiser);
    tout.hidden = true;
    cadre.appendChild(commandes);

    // La molette. `passive: false` : sans cela le navigateur ne laisse pas
    // annuler le defilement de la page, qui partirait en meme temps que le
    // zoom.
    cadre.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // 16 pixels par ligne quand le pilote compte en lignes, et non en
        // pixels : la molette d'une souris et le pave tactile n'ont pas la
        // meme unite.
        const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
        zoomer(Math.exp(-pixels * 0.0015), pointSVG(e));
      },
      { passive: false }
    );

    // Le pan, au bouton du milieu. Le clic gauche reste au pinceau.
    //
    // Les deplacements se font en pixels d'ecran, convertis par la matrice :
    // une regle de trois sur la largeur ignorerait les marges que le
    // navigateur laisse quand la carte est contrainte en hauteur.
    let prise = null;

    // Le bouton du milieu declenche, selon le navigateur, le defilement
    // automatique : il faut l'annuler sur `mousedown`, `pointerdown` ne
    // suffit pas partout.
    cadre.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });

    cadre.addEventListener("pointerdown", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      prise = { x: e.clientX, y: e.clientY };
      svg.classList.add("deplace");
      try {
        cadre.setPointerCapture(e.pointerId);
      } catch {
        /* on deplacera tant que le pointeur reste sur le cadre */
      }
    });

    cadre.addEventListener("pointermove", (e) => {
      if (!prise) return;
      const m = svg.getScreenCTM();
      vue.x -= (e.clientX - prise.x) / m.a;
      vue.y -= (e.clientY - prise.y) / m.a;
      prise = { x: e.clientX, y: e.clientY };
      borner();
      appliquer();
    });

    for (const fin of ["pointerup", "pointercancel"]) {
      cadre.addEventListener(fin, () => {
        prise = null;
        svg.classList.remove("deplace");
      });
    }

    const controle = { appliquer, niveau, reinitialiser };
    svg.__zoom = controle;
    return controle;
  }

  // Qui dit quoi pour UN departement.
  //
  //   non          ceux qui l'ont peint en rouge
  //   oui          ceux qui ont ENREGISTRE leur carte sans refuser celui-la
  //                -- y compris une carte toute verte : « partout me va »
  //                est une reponse
  //   sans reponse ceux qui n'ont jamais enregistre de carte
  //
  // `repondu` vient de la base, qui retient qui a enregistre sa carte : les
  // refus seuls ne le disent pas, une carte sans refus ne laisse aucune
  // ligne. Une base qui ne le sert pas encore -- le script n'a pas ete
  // recolle -- retombe sur l'ancienne regle : avoir peint un refus, c'est
  // avoir repondu.
  function groupesDepartement(tous, code) {
    const groupes = { non: [], oui: [], muets: [] };
    for (const personne of tous || []) {
      const refus = personne.refus || [];
      if (refus.includes(code)) groupes.non.push(personne);
      else if (personne.repondu || refus.length) groupes.oui.push(personne);
      else groupes.muets.push(personne);
    }
    return groupes;
  }

  function contenuDepartement(dep, tous) {
    const g = groupesDepartement(tous, dep.c);
    const corps = document.createElement("div");

    const titre = document.createElement("p");
    titre.className = "infobulle-titre";
    titre.append(fort(dep.n), span(` ${dep.c}`, "discret-inline"));
    corps.appendChild(titre);

    for (const [classe, libelle, personnes] of [
      ["non", "Non", g.non],
      ["oui", "Oui", g.oui],
    ]) {
      const ligne = document.createElement("p");
      ligne.className = `infobulle-${classe}`;
      ligne.append(fort(`${libelle} (${personnes.length})`), " — ", liste(personnes, tous));
      corps.appendChild(ligne);
    }

    if (g.muets.length) {
      corps.appendChild(span(`${g.muets.length} sans réponse`, "infobulle-muets"));
    }
    return corps;
  }

  // ------------------------------------- le classement des departements
  //
  // Les dix departements les mieux acceptes, dessines comme le classement des
  // dates : un rang, un nom, une barre, des chiffres, et qui a repondu quoi
  // sous un pli.
  //
  // Il se lit sur les OUI -- ceux qui ont enregistre leur carte sans refuser
  // le departement -- et, a egalite, sur les NON : celui qui bloque le moins
  // de monde passe devant. Deux departements qui ont les memes oui ET les
  // memes non partagent leur rang, comme deux week-ends.
  //
  // Avec peu de reponses, la plupart des departements sont a egalite : le
  // classement le dit, au lieu de couronner dix noms pris dans l'ordre
  // alphabetique.

  const TAILLE_CLASSEMENT = 10;

  function classerDepartements(donnees, limite) {
    const tous = donnees.tous || [];
    const lignes = window.CARTE.departements.map((dep) => {
      const g = groupesDepartement(tous, dep.c);
      return {
        code: dep.c,
        nom: dep.n,
        oui: g.oui.length,
        non: g.non.length,
        muets: g.muets.length,
        groupes: { oui: g.oui, non: g.non, muet: g.muets },
      };
    });

    lignes.sort(
      (a, b) => b.oui - a.oui || a.non - b.non || a.nom.localeCompare(b.nom, "fr")
    );

    let rang = 0;
    let precedent = null;
    lignes.forEach((l, i) => {
      if (precedent === null || l.oui !== precedent.oui || l.non !== precedent.non) rang = i + 1;
      l.rang = rang;
      precedent = l;
    });

    const garde = lignes.slice(0, limite || TAILLE_CLASSEMENT);
    const dernier = garde[garde.length - 1];
    return {
      lignes: garde,
      // Personne n'a enregistre de carte : tous les departements sont a zero,
      // et couronner l'un d'eux ne voudrait rien dire.
      vide: lignes.every((l) => l.oui + l.non === 0),
      nbTete: lignes.filter((l) => l.rang === 1).length,
      // Ceux qui, hors de la liste, valent exactement le dernier qu'on montre.
      egalite: lignes
        .slice(garde.length)
        .filter((l) => dernier && l.oui === dernier.oui && l.non === dernier.non).length,
    };
  }

  function verdictLieux(c) {
    if (c.vide) {
      return "Personne n'a encore enregistré de carte : le classement apparaîtra ici dès les premières.";
    }
    const tete = c.lignes.filter((l) => l.rang === 1);
    const premier = tete[0];
    if (c.nbTete === 1) {
      return `« ${premier.nom} » est le mieux accepté, avec ${premier.oui} oui et ${premier.non} non sur ${premier.oui + premier.non} réponse(s).`;
    }
    const noms = tete.slice(0, 3).map((l) => `« ${l.nom} »`).join(", ");
    const reste = c.nbTete - Math.min(3, tete.length);
    return (
      `${c.nbTete} départements à égalité parfaite en tête, avec ${premier.oui} oui et ${premier.non} non : ` +
      `${noms}${reste > 0 ? ` et ${reste} autre(s)` : ""}.`
    );
  }

  // `zones` : { classement, verdict, participation, deplies }.
  function dessinerClassementLieux(donnees, zones) {
    const c = classerDepartements(donnees);

    const combien = participationTexte(donnees);
    zones.participation.textContent = combien ? `(${combien})` : "";

    zones.verdict.className = c.vide ? "note" : "note resultat";
    zones.verdict.textContent = verdictLieux(c);

    zones.classement.textContent = "";
    if (c.vide) return;

    for (const ligne of c.lignes) {
      const item = document.createElement("li");

      const titre = document.createElement("div");
      titre.className = "rang-titre";
      titre.append(span(ordinal(ligne.rang), "etiquette"), fort(ligne.nom), span(ligne.code, "lien"));

      const chiffres = document.createElement("div");
      chiffres.className = "rang-chiffres";
      chiffres.textContent =
        `${ligne.oui} oui · ${ligne.non} non` +
        (ligne.muets ? ` · ${ligne.muets} sans réponse` : "");

      item.append(titre, barre(ligne, donnees.participants || ligne.oui + ligne.non || 1), chiffres);
      item.appendChild(pliQuiADitQuoi(`dep-${ligne.code}`, ligne.groupes, donnees.tous, zones.deplies));
      zones.classement.appendChild(item);
    }

    if (c.egalite > 0) {
      const dernier = c.lignes[c.lignes.length - 1];
      const reste = document.createElement("li");
      reste.className = "rang-reste";
      reste.textContent =
        `… et ${c.egalite} autre(s) département(s) à égalité avec le dernier ci-dessus ` +
        `(${dernier.oui} oui, ${dernier.non} non).`;
      zones.classement.appendChild(reste);
    }
  }

  // La bulle suit la souris sur le cadre de la carte. Au doigt il n'y a pas
  // de survol : un appui l'ouvre, un appui ailleurs la ferme.
  //
  // `contenu(code)` rend le noeud a afficher, ou null pour ne rien montrer
  // -- la page decide quand la bulle a lieu d'etre (la vue famille, pas le
  // pinceau).
  function brancherSurvol(cadre, contenu) {
    const bulle = document.createElement("div");
    bulle.className = "infobulle-carte";
    bulle.setAttribute("role", "tooltip");
    bulle.hidden = true;
    cadre.appendChild(bulle);

    let courant = null;

    function masquer() {
      bulle.hidden = true;
      courant = null;
    }

    function montrer(e) {
      const code = e.target && e.target.dataset ? e.target.dataset.code : null;
      const noeud = code ? contenu(code) : null;
      if (!noeud) return masquer();

      if (code !== courant) {
        bulle.textContent = "";
        bulle.appendChild(noeud);
        courant = code;
      }
      bulle.hidden = false;

      // Dans le cadre, a droite et en dessous du curseur ; de l'autre cote
      // quand il n'y a plus la place.
      const r = cadre.getBoundingClientRect();
      const marge = 14;
      const w = bulle.offsetWidth;
      const h = bulle.offsetHeight;
      let x = e.clientX - r.left + marge;
      let y = e.clientY - r.top + marge;
      if (x + w > r.width) x = e.clientX - r.left - w - marge;
      if (y + h > r.height) y = e.clientY - r.top - h - marge;
      bulle.style.left = `${Math.max(0, x)}px`;
      bulle.style.top = `${Math.max(0, y)}px`;
    }

    cadre.addEventListener("pointermove", montrer);
    cadre.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") montrer(e);
    });
    cadre.addEventListener("pointerleave", masquer);
    document.addEventListener("pointerdown", (e) => {
      if (!cadre.contains(e.target)) masquer();
    });

    return { masquer };
  }

  return {
    classer,
    verdictTexte,
    dessinerSondage,
    dessinerFond,
    colorierFamille,
    effacerFamille,
    legendeFamille,
    groupesDepartement,
    contenuDepartement,
    brancherSurvol,
    brancherZoom,
    dessinerClassementLieux,
  };
})();
