"use strict";

// Choix du lieu : chacun peint en rouge les departements ou il ne veut pas
// aller, et le croisement designe ceux que personne ne refuse.
//
// Le departement comme unite, plutot qu'un dessin libre : la donnee tient
// en quelques codes, le croisement est un comptage, et surtout la sortie
// porte un nom — « Dordogne » plutot qu'une tache sur une image.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  DROIT_REFUSE: "Tu n'as pas le droit de répondre pour cette personne.",
  LIEUX_FERMES: "Le choix du lieu est clos. Contacte l'organisateur.",
  AUCUNE_CIBLE: "Aucune personne sélectionnée.",
  TOUT_REFUSE: "Tu as refusé presque toute la France — il ne resterait nulle part où aller.",
};

const etat = {
  code: "",
  moi: null,
  donnees: null,
  cible: null,
  refuses: new Set(), // les departements peints pour la personne courante
  vue: "moi",
  trace: false, // un geste est en cours, meme s'il a commence hors de la carte
  peint: null, // true = on peint, false = on efface ; null = pas encore decide
};

// ---------------------------------------------------------------- reseau

async function rpc(fonction, args) {
  const reponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fonction}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      ...(SUPABASE_ANON_KEY.startsWith("eyJ")
        ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
        : {}),
    },
    body: JSON.stringify(args),
  });

  const corps = await reponse.json().catch(() => null);
  if (reponse.ok) return corps;

  const brut = corps && corps.message ? corps.message : `HTTP ${reponse.status}`;
  throw new Error(MESSAGES[brut] || brut);
}

const MEMOIRE = "tribu.code";

function lireMemoire() {
  try {
    return localStorage.getItem(MEMOIRE) || "";
  } catch {
    return "";
  }
}

function ecrireMemoire(valeur) {
  try {
    localStorage.setItem(MEMOIRE, valeur);
  } catch {
    /* navigation privee : sans importance */
  }
}

// ------------------------------------------------------------- etape 1

const champCode = document.getElementById("code");
const messageCode = document.getElementById("message-code");
champCode.value = lireMemoire();

document.getElementById("form-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = champCode.value.trim();
  messageCode.className = "";
  messageCode.textContent = "Vérification…";
  try {
    annuaire = await rpc("participants_lister", { p_code: code });
    etat.code = code;
    ecrireMemoire(code);
    messageCode.textContent = "";
    montrer("etape-prenom");
    champPrenom.focus();
  } catch (erreur) {
    messageCode.className = "erreur";
    messageCode.textContent = erreur.message;
    champCode.select();
  }
});

// ------------------------------------------------------------- etape 2

const champPrenom = document.getElementById("prenom");
const listeSuggestions = document.getElementById("suggestions");
const messagePrenom = document.getElementById("message-prenom");
let annuaire = [];

// ---------------------------------------------------------------- noeuds

// Prenoms, familles et intitules viennent de la base, et la base tient ce
// que le GEDCOM lui a donne : des chaines qu'aucun humain n'a relues.
// Passees a innerHTML, elles seraient interpretees comme du balisage -- un
// « <img src=x onerror=...> » dans un champ nom s'executerait alors chez
// toute la famille, avec le code d'acces a portee de main. On fabrique donc
// les noeuds un par un : textContent pose du texte, et rien d'autre.
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

champPrenom.addEventListener("input", () => {
  const saisi = champPrenom.value.trim().toLowerCase();
  listeSuggestions.innerHTML = "";
  if (!saisi) return champPrenom.setAttribute("aria-expanded", "false");

  const trouves = annuaire
    .filter((p) => p.prenom.toLowerCase().startsWith(saisi))
    .slice(0, 8);
  for (const personne of trouves) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.tabIndex = 0;
    item.append(fort(personne.prenom), " ", span(personne.famille));
    item.addEventListener("click", () => choisirPersonne(personne));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter") choisirPersonne(personne);
    });
    listeSuggestions.appendChild(item);
  }
  champPrenom.setAttribute("aria-expanded", String(trouves.length > 0));
});

champPrenom.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    listeSuggestions.firstElementChild?.click();
  }
});

async function choisirPersonne(personne) {
  messagePrenom.className = "";
  messagePrenom.textContent = "Chargement…";
  try {
    etat.moi = personne;
    etat.donnees = await rpc("lieux_charger", {
      p_code: etat.code,
      p_acteur: personne.id,
    });
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    construire();
    montrer("etape-carte");
  } catch (erreur) {
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ------------------------------------------------------------- la carte

const svg = document.getElementById("carte");
const cadreCarte = document.querySelector(".carte-cadre");
const zonePersonnes = document.getElementById("personnes");
const legende = document.getElementById("legende-carte");
const carteLegende = document.getElementById("carte-legende");
const message = document.getElementById("message");
const boutonEnregistrer = document.getElementById("enregistrer");
const boutonTous = document.getElementById("appliquer-tous");
const portee = document.getElementById("portee-saisie");

// En unites du viewBox (large de 1000) : de quoi couvrir deux ou trois
// departements d'un coup sans deborder sur la region voisine.
const RAYON_PINCEAU = 38;

const formes = new Map(); // code -> <path>
let pinceau = null;

const SVG = "http://www.w3.org/2000/svg";

function dessinerCarte() {
  svg.setAttribute("viewBox", window.CARTE.viewBox);
  svg.innerHTML = "";
  formes.clear();

  for (const dep of window.CARTE.departements) {
    const forme = document.createElementNS(SVG, "path");
    forme.setAttribute("d", dep.d);
    forme.dataset.code = dep.c;
    forme.classList.add("dep");

    const titre = document.createElementNS(SVG, "title");
    titre.textContent = `${dep.c} — ${dep.n}`;
    forme.appendChild(titre);

    svg.appendChild(forme);
    formes.set(dep.c, forme);
  }

  dessinerVilles();
  dessinerPinceau();
}

// Les villes servent a se reperer : sans elles, difficile de dire si l'on
// peint au-dessus ou au-dessous de Lyon.
//
// La couche entiere ignore la souris : sans `pointer-events: none`, un nom
// de ville interposerait un trou dans lequel le pinceau ne peindrait pas.
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

function dessinerVilles() {
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

function dessinerPinceau() {
  pinceau = document.createElementNS(SVG, "circle");
  pinceau.setAttribute("id", "pinceau");
  pinceau.setAttribute("r", 0);
  pinceau.classList.add("masquee");
  svg.appendChild(pinceau);
}

// Peindre par glisse : le premier departement touche decide du sens. S'il
// etait rouge on efface, sinon on peint. C'est ce qui permet de corriger
// une bavure sans changer d'outil.
function basculer(code) {
  if (etat.vue !== "moi" || !code) return;
  if (etat.peint === null) etat.peint = !etat.refuses.has(code);

  if (etat.peint) etat.refuses.add(code);
  else etat.refuses.delete(code);

  peindre();
}

function codeSous(evenement) {
  const cible = document.elementFromPoint(evenement.clientX, evenement.clientY);
  return cible && cible.dataset ? cible.dataset.code : null;
}

// La conversion entre pixels d'ecran et unites du viewBox passe par la
// matrice du navigateur, et surtout pas par un rapport de largeurs.
//
// Le SVG est contraint en hauteur : quand cette contrainte mord, le dessin
// est centre dans une boite plus large que lui, avec des marges de chaque
// cote. Une regle de trois sur la largeur ignore ces marges et decale le
// pinceau d'autant — c'est exactement le defaut constate.
function versSVG(evenement) {
  const point = svg.createSVGPoint();
  point.x = evenement.clientX;
  point.y = evenement.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function rayonEcran() {
  const matrice = svg.getScreenCTM();
  return matrice ? RAYON_PINCEAU * matrice.a : 0;
}

// Tout ce qui passe sous le disque, et pas seulement le point central.
//
// On echantillonne plutot que de calculer des intersections de polygones :
// le navigateur sait deja dire ce qu'il y a sous un point, il le fait vite,
// et il gere les formes concaves sans qu'on ait a s'en occuper.
function codesSousLePinceau(evenement) {
  const rayon = rayonEcran();
  const codes = new Set();
  const decalages = [[0, 0]];

  if (rayon > 0) {
    for (const [combien, proportion] of [[6, 0.45], [10, 0.8], [14, 1]]) {
      for (let i = 0; i < combien; i++) {
        const angle = (2 * Math.PI * i) / combien + proportion;
        decalages.push([
          Math.cos(angle) * rayon * proportion,
          Math.sin(angle) * rayon * proportion,
        ]);
      }
    }
  }

  for (const [dx, dy] of decalages) {
    const element = document.elementFromPoint(
      evenement.clientX + dx,
      evenement.clientY + dy
    );
    const code = element && element.dataset ? element.dataset.code : null;
    if (code) codes.add(code);
  }
  return codes;
}

// Le sens du trace se decide au premier departement rencontre, et non a
// l'appui. On peut donc commencer le geste sur la mer ou dans la marge et
// entrer ensuite dans la carte : c'est ce que fait naturellement quelqu'un
// qui veut balayer une bordure sans mordre au milieu.
function appliquer(codes, codeCentre) {
  if (etat.vue !== "moi" || codes.size === 0) return;

  if (etat.peint === null) {
    // De preference le departement vise au centre : le sens ne doit pas
    // dependre d'un voisin attrape au bord du pinceau.
    const reference =
      codeCentre && codes.has(codeCentre) ? codeCentre : [...codes][0];
    etat.peint = !etat.refuses.has(reference);
  }

  for (const code of codes) {
    if (etat.peint) etat.refuses.add(code);
    else etat.refuses.delete(code);
  }
  peindre();
}

function suivrePinceau(evenement) {
  if (!pinceau) return;
  const point = versSVG(evenement);
  pinceau.setAttribute("cx", point.x);
  pinceau.setAttribute("cy", point.y);
  pinceau.setAttribute("r", RAYON_PINCEAU);
  pinceau.classList.toggle("masquee", etat.vue !== "moi");
}

// Les evenements sont poses sur le CADRE et non sur le SVG : appuyer dans
// la marge autour de la carte doit aussi commencer un trace.
cadreCarte.addEventListener("pointerdown", (e) => {
  if (etat.vue !== "moi") return;
  e.preventDefault();
  etat.trace = true;
  etat.peint = null;
  appliquer(codesSousLePinceau(e), codeSous(e));

  // Sans capture, quitter le cadre interromprait le glisse. Tous les
  // navigateurs ne l'acceptent pas dans tous les cas : c'est un confort,
  // pas une condition, et un echec ne doit pas bloquer le trace.
  try {
    cadreCarte.setPointerCapture(e.pointerId);
  } catch {
    /* on peindra tant que le pointeur reste sur le cadre */
  }
});

cadreCarte.addEventListener("pointermove", (e) => {
  suivrePinceau(e);
  if (!etat.trace) return;
  appliquer(codesSousLePinceau(e), codeSous(e));
});

for (const fin of ["pointerup", "pointercancel"]) {
  cadreCarte.addEventListener(fin, () => {
    etat.trace = false;
    etat.peint = null;
  });
}

cadreCarte.addEventListener("pointerleave", () => {
  if (pinceau) pinceau.classList.add("masquee");
});

// Le clavier doit pouvoir faire la meme chose que le doigt. `detail === 0`
// distingue l'activation au clavier du clic de souris, deja traite par les
// evenements pointeur.
svg.addEventListener("click", (e) => {
  if (etat.peint !== null || etat.vue !== "moi" || e.detail !== 0) return;
  basculer(e.target.dataset?.code);
  // Indispensable : `basculer` a arme le sens du trace, et sans ce retour a
  // null le deuxieme appui clavier serait ignore.
  etat.peint = null;
});

function peindre() {
  if (etat.vue === "moi") {
    for (const [code, forme] of formes) {
      forme.classList.toggle("refuse", etat.refuses.has(code));
      forme.classList.remove("chaleur-1", "chaleur-2", "chaleur-3");
    }
    // innerHTML est sans risque ici, et seulement ici : ce gabarit ne
    // recoit que des nombres calcules sur place, jamais de texte venu de
    // la base. Y glisser un nom de departement demanderait span().
    carteLegende.innerHTML =
      `<span class="pastille-legende vert"></span> on peut y aller ` +
      `<span class="pastille-legende rouge"></span> ${etat.refuses.size} refusé(s)`;
    return;
  }

  // Vue famille : une teinte par nombre de refus. Il y a peu de chances
  // qu'un departement fasse l'unanimite, donc on montre le degrade plutot
  // qu'un verdict binaire qui serait souvent vide.
  const totaux = etat.donnees.totaux || {};
  for (const [code, forme] of formes) {
    const n = totaux[code] || 0;
    forme.classList.remove("refuse", "chaleur-1", "chaleur-2", "chaleur-3");
    if (n > 0) forme.classList.add(`chaleur-${Math.min(n, 3)}`);
  }

  const acceptes = [...formes.keys()].filter((c) => !(totaux[c] > 0));
  // Meme remarque : des nombres, rien que des nombres.
  carteLegende.innerHTML =
    `<span class="pastille-legende vert"></span> aucun refus (${acceptes.length}) ` +
    `<span class="pastille-legende c1"></span> 1 ` +
    `<span class="pastille-legende c2"></span> 2 ` +
    `<span class="pastille-legende c3"></span> 3 ou plus`;

}

// ------------------------------------------------------- etape 3, cadre

function construire() {
  dessinerCarte();

  zonePersonnes.innerHTML = "";
  for (const personne of etat.donnees.modifiables) {
    const pastille = document.createElement("button");
    pastille.type = "button";
    pastille.className = "pastille";
    pastille.dataset.id = personne.id;
    pastille.append(personne.prenom);
    if (personne.id === etat.moi.id) pastille.append(" ", span("(toi)", "moi"));
    if (!personne.repondu) pastille.append(" ", span("•", "vide"));
    pastille.addEventListener("click", () => selectionner(personne));
    zonePersonnes.appendChild(pastille);
  }

  if (!etat.donnees.lieux_ouverts) {
    boutonEnregistrer.disabled = boutonTous.disabled = true;
    message.className = "erreur";
    message.textContent = MESSAGES.LIEUX_FERMES;
  }

  selectionner(
    etat.donnees.modifiables.find((p) => p.id === etat.moi.id) ||
      etat.donnees.modifiables[0]
  );
}

function selectionner(personne) {
  if (!personne) return;
  etat.cible = personne;

  for (const pastille of zonePersonnes.children) {
    pastille.classList.toggle("active", pastille.dataset.id === personne.id);
  }

  etat.refuses = new Set(
    etat.donnees.refus
      .filter((r) => r.participant_id === personne.id)
      .map((r) => r.departement)
  );

  legende.textContent =
    personne.id === etat.moi.id ? "Ta carte" : `La carte de ${personne.prenom}`;

  majBoutons();
  peindre();
  message.className = "";
  message.textContent = "";
}

// --------------------------------------------------------- ampleur

// Au-dela de cinq AUTRES personnes, on a quitte son propre foyer : deux
// adultes et trois enfants tiennent en dessous, une branche entiere non.
// L'arbre accorde parfois une portee tres large -- une grand-mere figure
// au-dessus de toute sa descendance -- et « Appliquer a tous » devient
// alors un bouton qui repond pour des gens qui remplissent la leur de
// leur cote, sans jamais l'apprendre.
const FOYER = 5;

// Ce que le clic va reellement faire. `ecrases` est le sous-ensemble qui
// compte : ecrire chez quelqu'un qui n'a rien saisi se corrige d'un clic,
// remplacer ce qu'il avait rempli ne se retrouve pas.
function ampleur() {
  const tous = etat.donnees.modifiables;
  const autres = tous.filter((p) => p.id !== etat.cible.id);
  return {
    tous,
    autres,
    ecrases: autres.filter((p) => p.repondu),
    large: autres.length > FOYER,
  };
}

function majBoutons() {
  const { tous, autres, ecrases, large } = ampleur();
  boutonEnregistrer.textContent = `Enregistrer pour ${etat.cible.prenom}`;
  boutonTous.hidden = autres.length === 0;
  boutonTous.textContent = `Appliquer à tous (${tous.length})`;
  portee.classList.toggle("alerte", large);
  if (!autres.length) {
    portee.textContent = "";
  } else if (large) {
    // Passe une poignee, la liste des prenoms devient un mur qu'on ne lit
    // plus : c'est le nombre qui doit sauter aux yeux, pas les noms.
    portee.textContent =
      `Attention : « Appliquer à tous » peint la carte de ${autres.length} autres personnes` +
      (ecrases.length
        ? `, et remplace la carte déjà peinte par ${ecrases.length} d'entre elles.`
        : ", qui n'ont encore rien peint.") +
      ` Pour ne toucher qu'à ${etat.cible.prenom}, prends l'autre bouton.`;
  } else {
    portee.textContent = `« Appliquer à tous » recopie cette carte sur ${autres
      .map((p) => p.prenom)
      .join(", ")} — les leurs sont remplacées.`;
  }
}

document.getElementById("vues").addEventListener("click", (e) => {
  const bouton = e.target.closest(".pastille");
  if (!bouton) return;
  etat.vue = bouton.dataset.vue;
  for (const autre of e.currentTarget.children) {
    autre.classList.toggle("active", autre === bouton);
  }
  svg.classList.toggle("lecture", etat.vue !== "moi");
  if (pinceau) pinceau.classList.add("masquee");
  peindre();
});

document.getElementById("tout-effacer").addEventListener("click", () => {
  if (etat.vue !== "moi") return;
  etat.refuses.clear();
  peindre();
});

// ---------------------------------------------------------- enregistrer

async function enregistrer(cibles) {
  const departements = [...etat.refuses];
  boutonEnregistrer.disabled = boutonTous.disabled = true;
  message.className = "";
  message.textContent = "Enregistrement…";

  try {
    await rpc("lieux_enregistrer", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_cibles: cibles.map((p) => p.id),
      p_departements: departements,
    });

    // Les totaux de la vue famille viennent du serveur : on les recharge
    // plutot que de les recalculer de tete.
    etat.donnees = await rpc("lieux_charger", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
    });
    const memeCible = etat.donnees.modifiables.find((p) => p.id === etat.cible.id);
    construire();
    if (memeCible) selectionner(memeCible);

    const qui = cibles.length === 1 ? cibles[0].prenom : `${cibles.length} personnes`;
    message.className = "ok";
    message.textContent = departements.length
      ? `${qui} : ${departements.length} département(s) refusé(s).`
      : `${qui} : toute la France reste possible.`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
  } finally {
    boutonEnregistrer.disabled = boutonTous.disabled = false;
  }
}

boutonEnregistrer.addEventListener("click", () => enregistrer([etat.cible]));

boutonTous.addEventListener("click", () => {
  const { tous, autres, ecrases, large } = ampleur();

  // Ecraser la saisie de quelqu'un d'autre sans le dire serait le meilleur
  // moyen de faire perdre a un cousin une heure de remplissage. Passe le
  // seuil, on renonce a enumerer : on annonce le nombre, on rappelle ce qui
  // ne se rattrape pas, et on nomme la sortie de secours.
  let question;
  if (large) {
    question =
      `Appliquer cette carte à ${autres.length} autres personnes ?` +
      (ecrases.length
        ? `\n\n${ecrases.length} d'entre elles ont déjà peint la leur : ${ecrases
            .map((p) => p.prenom)
            .join(", ")}.\nCe qu'elles ont fait sera remplacé, et ne se retrouvera pas.`
        : "") +
      `\n\nSi tu ne voulais répondre que pour toi, annule et prends « Enregistrer pour ${etat.cible.prenom} ».`;
  } else {
    question = `Appliquer cette carte à ${tous.map((p) => p.prenom).join(", ")} ?`;
    if (ecrases.length) {
      question += `\n\nLes cartes de ${ecrases.map((p) => p.prenom).join(", ")} seront remplacées.`;
    }
  }
  if (confirm(question)) enregistrer(tous);
});

document.getElementById("changer").addEventListener("click", () => {
  champPrenom.value = "";
  listeSuggestions.innerHTML = "";
  montrer("etape-prenom");
  champPrenom.focus();
});

const fil = document.getElementById("fil");

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
  // Les deux premieres etapes se ressemblent : un fieldset, un champ de
  // texte, au meme endroit. Le focus change, mais ca ne se voit pas -- et
  // pas du tout sur un telephone. Le fil, lui, apparait et ne repart plus :
  // la page ne ressemble plus a ce qu'elle etait.
  if (fil) fil.hidden = id === "etape-code";
}

if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
