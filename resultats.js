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

    // Le rang suit le nombre de OUI, pas la position : deux week-ends a
    // egalite partagent la premiere place, et il n'y a pas de deuxieme.
    let rang = 0;
    let precedent = null;
    lignes.forEach((l, i) => {
      if (precedent === null || l.oui !== precedent) rang = i + 1;
      l.rang = rang;
      precedent = l.oui;
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
    return `${tete.length} week-ends à égalité avec ${oui} : ${noms}. Le premier de la liste est refusé par moins de monde.`;
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

  function quiADitQuoi(ligne, donnees, deplies) {
    const groupes = grouperReponses(donnees, ligne.id);

    const pli = document.createElement("details");
    pli.className = "qui-a-dit";
    // Rouvrir ce qu'on avait ouvert : la liste se redessine a chaque
    // enregistrement, et un panneau qui se referme sous le doigt agace.
    pli.open = deplies.has(ligne.id);
    pli.addEventListener("toggle", () => {
      if (pli.open) deplies.add(ligne.id);
      else deplies.delete(ligne.id);
    });

    const resume = document.createElement("summary");
    resume.textContent = "Qui a répondu quoi";
    pli.appendChild(resume);

    for (const [cle, libelle] of NOMS_CHOIX) {
      const bloc = document.createElement("p");
      bloc.className = "note";
      bloc.append(fort(libelle), ` (${groupes[cle].length}) — `, liste(groupes[cle], donnees.tous));
      pli.appendChild(bloc);
    }
    return pli;
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
    svg.setAttribute("viewBox", window.CARTE.viewBox);
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

  // Une teinte par nombre de refus. Il y a peu de chances qu'un departement
  // fasse l'unanimite, donc on montre le degrade plutot qu'un verdict
  // binaire qui serait souvent vide.
  function colorierFamille(formes, totaux) {
    for (const [code, forme] of formes) {
      const n = (totaux || {})[code] || 0;
      forme.classList.remove("refuse", "chaleur-1", "chaleur-2", "chaleur-3");
      if (n > 0) forme.classList.add(`chaleur-${Math.min(n, 3)}`);
    }
  }

  // Des nombres, rien que des nombres : c'est ce qui rend `innerHTML` sans
  // risque ici. Y glisser un nom demanderait span().
  function legendeFamille(formes, totaux) {
    const acceptes = [...formes.keys()].filter((c) => !((totaux || {})[c] > 0));
    return (
      `<span class="pastille-legende vert"></span> aucun refus (${acceptes.length}) ` +
      `<span class="pastille-legende c1"></span> 1 ` +
      `<span class="pastille-legende c2"></span> 2 ` +
      `<span class="pastille-legende c3"></span> 3 ou plus`
    );
  }

  // Qui dit quoi pour UN departement.
  //
  //   non          ceux qui l'ont peint en rouge
  //   oui          ceux qui ont repondu -- ils ont peint AU MOINS un
  //                departement -- sans refuser celui-la
  //   sans reponse ceux qui n'ont rien peint du tout
  //
  // La base ne stocke que les refus : quelqu'un qui a repondu « partout me
  // va » n'a aucune ligne, et ne se distingue donc pas de quelqu'un qui n'a
  // pas ouvert la page. C'est la limite de « absent est l'etat par defaut »,
  // et mieux vaut la dire que compter ces gens-la comme des « oui ».
  function groupesDepartement(tous, code) {
    const groupes = { non: [], oui: [], muets: 0 };
    for (const personne of tous || []) {
      const refus = personne.refus || [];
      if (refus.includes(code)) groupes.non.push(personne);
      else if (refus.length) groupes.oui.push(personne);
      else groupes.muets += 1;
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

    if (g.muets) {
      corps.appendChild(span(`${g.muets} sans réponse`, "infobulle-muets"));
    }
    return corps;
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
    legendeFamille,
    groupesDepartement,
    contenuDepartement,
    brancherSurvol,
  };
})();
