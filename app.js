"use strict";

// Le formulaire n'envoie que des FAITS : qui dort ou, et quels repas.
// Aucun regime, aucun tarif, aucun total n'est calcule ici : c'est le role
// du Python. Le jour ou une regle de l'hotel change, ce fichier ne bouge pas.
//
// Il ne touche a aucune table non plus : trois fonctions SQL sont les seules
// portes d'entree, et elles verifient le code et les droits a chaque appel.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const REPAS = ["petit_dejeuner", "dejeuner", "diner"];

// Le petit-dejeuner ne se coche pas : il suit la nuit d'avant, et seulement
// si c'etait une CHAMBRE. L'hotel le sert, le gite non -- on y fait son cafe
// soi-meme. C'est la regle que `engine/rules.py` applique pour reconnaitre
// une demi-pension, et celle que l'import du tableur pose deja.
const REPAS_COCHABLES = ["dejeuner", "diner"];
// Une seule question : OU L'ON DORT. Ne pas etre la du tout n'est pas un
// choix a faire dans la liste -- c'est une journee ou l'on n'a rien coche.
//
// La vue mer est une VARIANTE DE CHAMBRE, pas une option a cote. Elle
// tenait une colonne entiere, desactivee les trois quarts du temps puisque
// seule une chambre peut l'avoir. La base, elle, garde deux champs -- un
// hebergement et un supplement -- parce que c'est ainsi que l'hotel
// facture. `CHAMBRE_VUE_MER` est donc une valeur d'interface, dépliée en
// deux a l'enregistrement et repliee a la relecture.
const CHAMBRE_VUE_MER = "chambre+vue_mer";

const HEBERGEMENTS = [
  ["exterieur", "pas sur place"],
  ["chambre", "en chambre"],
  [CHAMBRE_VUE_MER, "en chambre, vue mer"],
  ["gite", "en gîte"],
];

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  DROIT_REFUSE: "Tu n'as pas le droit de modifier cette personne.",
  SAISIE_FERMEE: "La saisie est fermée. Contacte l'organisateur.",
  TROP_DE_LIGNES: "Saisie trop volumineuse.",
  AUCUNE_CIBLE: "Aucune personne sélectionnée.",
};

const etat = { code: "", moi: null, donnees: null, cible: null };

// ---------------------------------------------------------------- reseau

async function rpc(fonction, args) {
  const reponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fonction}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      // Les anciennes cles anon sont des JWT et se passent aussi en Bearer ;
      // les nouvelles `sb_publishable_...` n'en sont pas.
      ...(SUPABASE_ANON_KEY.startsWith("eyJ")
        ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
        : {}),
    },
    body: JSON.stringify(args),
  });

  const corps = await reponse.json().catch(() => null);
  if (reponse.ok) return corps;

  // Les fonctions SQL levent des exceptions dont le message est un code
  // stable : on traduit ici, et seulement ici.
  const brut = corps && corps.message ? corps.message : `HTTP ${reponse.status}`;
  throw new Error(MESSAGES[brut] || brut);
}

// -------------------------------------------------------------- memoire

const MEMOIRE = "tribu.code";

function lireMemoire() {
  try {
    return localStorage.getItem(MEMOIRE) || "";
  } catch {
    return ""; // navigation privee : sans importance
  }
}

function ecrireMemoire(valeur) {
  try {
    localStorage.setItem(MEMOIRE, valeur);
  } catch {
    /* sans importance */
  }
}

// ---------------------------------------------------------------- dates

// Surtout pas toISOString() : il convertit minuit local en UTC, ce qui
// recule la date d'un jour dans tous les fuseaux a l'est de Greenwich.
function versISO(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function listerJours(debut, fin) {
  const jours = [];
  const derniere = new Date(fin + "T00:00:00");
  for (let d = new Date(debut + "T00:00:00"); d <= derniere; d.setDate(d.getDate() + 1)) {
    jours.push(versISO(d));
  }
  return jours;
}

function afficherJour(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
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
    // Les prenoms sont des donnees personnelles : c'est cet appel qui les
    // debloque, et il echoue si le code est faux.
    const participants = await rpc("participants_lister", { p_code: code });
    etat.code = code;
    ecrireMemoire(code);
    messageCode.textContent = "";
    preparerAutocompletion(participants);
    montrer("etape-prenom");
    document.getElementById("prenom").focus();
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

function preparerAutocompletion(participants) {
  annuaire = participants;
}

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

// Deux personnes peuvent porter le meme prenom : on affiche la famille pour
// lever l'ambiguite, et c'est l'identifiant qui est retenu, jamais le texte.
function suggerer() {
  const saisi = champPrenom.value.trim().toLowerCase();
  listeSuggestions.innerHTML = "";

  if (!saisi) {
    champPrenom.setAttribute("aria-expanded", "false");
    return;
  }

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
}

champPrenom.addEventListener("input", suggerer);

champPrenom.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" && listeSuggestions.firstElementChild) {
    e.preventDefault();
    listeSuggestions.firstElementChild.focus();
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const premier = listeSuggestions.firstElementChild;
    if (premier) premier.click();
  }
});

async function choisirPersonne(personne) {
  messagePrenom.className = "";
  messagePrenom.textContent = "Chargement…";
  try {
    etat.moi = personne;
    etat.donnees = await rpc("sejour_charger", {
      p_code: etat.code,
      p_acteur: personne.id,
    });
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    construireSaisie();
    montrer("etape-saisie");
  } catch (erreur) {
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ------------------------------------------------------------- etape 3

const zonePersonnes = document.getElementById("personnes");
const corpsJours = document.getElementById("jours");
const legendeJours = document.getElementById("legende-jours");
const message = document.getElementById("message");

function construireSaisie() {
  const { date_debut, date_fin, saisie_ouverte, modifiables } = etat.donnees;

  // Le sous-titre portait les dates du sejour. Il a ete retire de la page,
  // et rien ne s'en trouve perdu : chaque ligne de la grille porte son
  // jour. Ecrire dans un element absent arretait la saisie net.
  construireGrille(listerJours(date_debut, date_fin));

  zonePersonnes.innerHTML = "";
  for (const personne of modifiables) {
    const pastille = document.createElement("button");
    pastille.type = "button";
    pastille.className = "pastille";
    pastille.dataset.id = personne.id;
    pastille.append(personne.prenom);
    if (personne.id === etat.moi.id) pastille.append(" ", span("(toi)", "moi"));
    if (!personne.saisi) pastille.append(" ", span("•", "vide"));
    pastille.title = personne.saisi ? "Déjà saisi" : "Rien de saisi pour l'instant";
    pastille.addEventListener("click", () => selectionnerCible(personne));
    zonePersonnes.appendChild(pastille);
  }

  if (!saisie_ouverte) {
    // La grille reste consultable : on ferme l'ecriture, pas la lecture.
    boutonEnregistrer.disabled = boutonTous.disabled = true;
    message.className = "erreur";
    message.textContent = MESSAGES.SAISIE_FERMEE;
  }

  selectionnerCible(modifiables.find((p) => p.id === etat.moi.id) || modifiables[0]);
}

function construireGrille(jours) {
  corpsJours.innerHTML = "";

  for (const jour of jours) {
    const ligne = document.createElement("tr");
    ligne.dataset.jour = jour;

    const cJour = document.createElement("td");
    cJour.textContent = afficherJour(jour);
    ligne.appendChild(cJour);

    const cChoix = document.createElement("td");
    const choix = document.createElement("select");
    choix.dataset.champ = "hebergement";
    for (const [valeur, libelle] of HEBERGEMENTS) choix.add(new Option(libelle, valeur));
    cChoix.appendChild(choix);
    ligne.appendChild(cChoix);

    for (const champ of REPAS_COCHABLES) {
      const cellule = document.createElement("td");
      const caseACocher = document.createElement("input");
      caseACocher.type = "checkbox";
      caseACocher.dataset.champ = champ;
      caseACocher.setAttribute("aria-label", `${champ} du ${jour}`);
      // Cocher un repas suffit desormais a declarer une presence : la ligne
      // doit donc se relire a chaque case, pas seulement au changement de
      // la nuit.
      caseACocher.addEventListener("change", appliquerContraintes);
      cellule.appendChild(caseACocher);
      ligne.appendChild(cellule);
    }

    choix.addEventListener("change", appliquerContraintes);
    corpsJours.appendChild(ligne);
  }
}

// Absente = rien du tout : ni nuit, ni repas. Le supplement vue mer, lui,
// n'existe que pour les chambres.
// La grille se relit ENTIERE a chaque changement, jamais ligne par ligne :
// le petit-dejeuner d'un jour depend de la nuit du jour d'avant, et une
// regle posee sur une seule ligne ne voit pas sa voisine.
function appliquerContraintes() {
  const lignes = [...corpsJours.querySelectorAll("tr")];

  lignes.forEach((ligne, i) => {
    const hebergement = ligne.querySelector('[data-champ="hebergement"]').value;
    // Le petit-dejeuner ne s'affiche plus, mais il compte toujours : un
    // jour de depart ou l'on ne prend que lui n'est pas une absence, et ne
    // doit donc pas etre grise.
    const veille = i > 0 ? lignes[i - 1] : null;
    const enChambreLaVeille =
      veille && veille.querySelector('[data-champ="hebergement"]').value === "chambre";

    // Les repas ne dependent de rien : on peut passer dejeuner sans dormir
    // sur place, et c'est meme le cas de tous ceux qui logent a cote.
    //
    // Rien de coche, pas de nuit sur place, et pas de petit-dejeuner herite
    // de la veille : cette journee ne dit rien, donc la personne n'est pas
    // la. C'est griser la ligne qui le montre, pas un choix a faire dans
    // une liste.
    const unRepas = REPAS_COCHABLES.some(
      (r) => ligne.querySelector(`[data-champ="${r}"]`).checked
    );
    ligne.classList.toggle(
      "absente",
      hebergement === "exterieur" && !unRepas && !enChambreLaVeille
    );
  });
}

function selectionnerCible(personne) {
  if (!personne) return;
  etat.cible = personne;

  for (const pastille of zonePersonnes.children) {
    pastille.classList.toggle("active", pastille.dataset.id === personne.id);
  }

  legendeJours.textContent =
    personne.id === etat.moi.id ? "Ton séjour" : `Le séjour de ${personne.prenom}`;

  remplirGrille(personne.id);
  majBoutons();
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
    ecrases: autres.filter((p) => p.saisi),
    large: autres.length > FOYER,
  };
}

// Nommer la personne sur le bouton vaut mieux qu'un « Enregistrer » nu :
// c'est la seule facon de voir, sans y penser, sur qui porte le clic.
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
      `Attention : « Appliquer à tous » remplit la grille de ${autres.length} autres personnes` +
      (ecrases.length
        ? `, et remplace la saisie déjà faite par ${ecrases.length} d'entre elles.`
        : ", qui n'ont encore rien saisi.") +
      ` Pour ne toucher qu'à ${etat.cible.prenom}, prends l'autre bouton.`;
  } else {
    portee.textContent = `« Appliquer à tous » recopie cette grille sur ${autres
      .map((p) => p.prenom)
      .join(", ")} — leur saisie actuelle est remplacée.`;
  }
}

function remplirGrille(participantId) {
  const saisies = new Map(
    etat.donnees.presences
      .filter((p) => p.participant_id === participantId)
      .map((p) => [p.jour, p])
  );

  for (const ligne of corpsJours.querySelectorAll("tr")) {
    const presence = saisies.get(ligne.dataset.jour);
    const champ = (nom) => ligne.querySelector(`[data-champ="${nom}"]`);

    // Absent par defaut : sans ligne en base, la journee reste vide, et
    // « pas sur place » est ce que dit une journee dont on n'a rien dit.
    champ("hebergement").value = !presence
      ? "exterieur"
      : presence.vue_mer && presence.hebergement === "chambre"
        ? CHAMBRE_VUE_MER
        : presence.hebergement;
    for (const repas of REPAS_COCHABLES) {
      champ(repas).checked = presence ? presence[repas] : false;
    }
  }

  // Une seule passe, a la fin : chaque ligne a besoin de la precedente.
  appliquerContraintes();
}

function lireGrille() {
  const jours = [...corpsJours.querySelectorAll("tr")].map((ligne) => {
    const champ = (nom) => ligne.querySelector(`[data-champ="${nom}"]`);
    const choisi = champ("hebergement").value;
    const vueMer = choisi === CHAMBRE_VUE_MER;
    return {
      jour: ligne.dataset.jour,
      hebergement: vueMer ? "chambre" : choisi,
      vue_mer: vueMer,
      petit_dejeuner: false, // pose juste apres, d'apres la nuit d'avant
      dejeuner: champ("dejeuner").checked,
      diner: champ("diner").checked,
    };
  });

  // Le petit-dejeuner du lendemain d'une nuit en chambre. Il peut tomber
  // sur un jour ou rien n'est coche : on part apres avoir dejeune, sans
  // rien prendre d'autre.
  for (let i = 1; i < jours.length; i += 1) {
    if (jours[i - 1].hebergement === "chambre") jours[i].petit_dejeuner = true;
  }

  // Ce qui ne dit rien ne produit aucune ligne -- absent est l'etat par
  // defaut de la base, et poser une ligne vide reviendrait a le contredire.
  return jours.filter(
    (j) =>
      j.hebergement !== "exterieur" || j.petit_dejeuner || j.dejeuner || j.diner
  );
}

const boutonEnregistrer = document.getElementById("enregistrer");
const boutonTous = document.getElementById("appliquer-tous");
const portee = document.getElementById("portee-saisie");

async function enregistrer(cibles) {
  const lignes = lireGrille();
  boutonEnregistrer.disabled = boutonTous.disabled = true;
  message.className = "";
  message.textContent = "Enregistrement…";

  try {
    await rpc("sejour_enregistrer", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_cibles: cibles.map((p) => p.id),
      p_lignes: lignes,
    });

    // L'etat local doit refleter la base, sinon changer de personne puis
    // revenir reafficherait l'ancienne saisie.
    const vises = new Set(cibles.map((p) => p.id));
    etat.donnees.presences = etat.donnees.presences
      .filter((p) => !vises.has(p.participant_id))
      .concat(
        cibles.flatMap((cible) =>
          lignes.map((l) => ({ ...l, participant_id: cible.id }))
        )
      );

    for (const cible of cibles) {
      cible.saisi = true;
      zonePersonnes.querySelector(`[data-id="${cible.id}"] .vide`)?.remove();
    }

    const qui =
      cibles.length === 1
        ? cibles[0].prenom
        : `${cibles.length} personnes (${cibles.map((p) => p.prenom).join(", ")})`;

    message.className = "ok";
    message.textContent = lignes.length
      ? `${qui} : ${lignes.length} jour(s) enregistré(s).`
      : `${qui} : absent·e sur tout le séjour.`;
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
      `Appliquer cette grille à ${autres.length} autres personnes ?` +
      (ecrases.length
        ? `\n\n${ecrases.length} d'entre elles ont déjà rempli la leur : ${ecrases
            .map((p) => p.prenom)
            .join(", ")}.\nCe qu'elles ont fait sera remplacé, et ne se retrouvera pas.`
        : "") +
      `\n\nSi tu ne voulais répondre que pour toi, annule et prends « Enregistrer pour ${etat.cible.prenom} ».`;
  } else {
    question = `Appliquer cette grille à ${tous.map((p) => p.prenom).join(", ")} ?`;
    if (ecrases.length) {
      question +=
        `

La saisie déjà faite de ${ecrases.map((p) => p.prenom).join(", ")} ` +
        `sera remplacée.`;
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

// ------------------------------------------------------------ affichage

const fil = document.getElementById("fil");

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
  // Les deux premieres etapes se ressemblent : un fieldset, un champ de
  // texte, au meme endroit. Le focus change, mais ca ne se voit pas -- et
  // pas du tout sur un telephone. Le fil, lui, apparait et ne repart plus :
  // la page ne ressemble plus a ce qu'elle etait.
  if (fil) {
    fil.hidden = id === "etape-code";
    // La relance ne vaut que tant qu'il reste quelque chose a faire : une
    // fois la personne choisie, « reste a dire qui tu es » serait faux.
    const suite = document.getElementById("fil-suite");
    if (suite) suite.hidden = id !== "etape-prenom";
  }
}

// Le code est deja connu de cet appareil : on saute la premiere etape.
if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
