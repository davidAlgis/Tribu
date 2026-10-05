"use strict";

// Sondage sur la date du sejour, en amont du formulaire de presences.
//
// Meme modele d'identite et de droits que celui-ci : code famille, prenom,
// et l'on repond pour les personnes qu'on gere. Rien de nouveau a
// expliquer a la famille, et aucune table n'est touchee directement.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

// Deux reponses, et deux seulement. Une troisieme, tiede, servait de
// refuge : on la cochait pour ne pas trancher, et le depouillement
// heritait de l'indecision. Oui ou non oblige a se prononcer -- et rend le
// resultat lisible sans ponderation a expliquer.
const CHOIX = [
  ["oui", "Oui"],
  ["non", "Non"],
];

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  DROIT_REFUSE: "Tu n'as pas le droit de répondre pour cette personne.",
  VOEUX_FERMES: "Le sondage est clos. Contacte l'organisateur.",
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

// Le code est partage avec la page des presences : entre une fois, entre
// partout.
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

// ET LE PRENOM AVEC. Le code entrait une fois pour toutes ; le prenom, lui,
// se redemandait a chaque page. Celui qui vient de dire qui il est sur les
// dates n'a pas a le redire sur les presences.
//
// On garde l'identifiant, le prenom et la famille -- de quoi retrouver la
// personne dans l'annuaire, et de quoi s'apercevoir qu'elle n'y est plus.
const MOI = "tribu.moi";

function lireMoi() {
  try {
    return JSON.parse(localStorage.getItem(MOI) || "null");
  } catch {
    return null;
  }
}

function ecrireMoi(personne) {
  try {
    localStorage.setItem(
      MOI,
      JSON.stringify({
        id: personne.id,
        prenom: personne.prenom,
        famille: personne.famille,
      })
    );
  } catch {
    /* navigation privee : sans importance */
  }
}

function oublierMoi() {
  try {
    localStorage.removeItem(MOI);
  } catch {
    /* navigation privee : sans importance */
  }
}

// Reprendre la personne retenue, si elle tient encore debout. Trois raisons
// de ne pas la reprendre, et chacune ramene simplement a l'etape du prenom :
// rien n'a ete retenu, la personne a quitte la liste depuis, ou la base
// refuse de servir ses donnees.
async function reprendrePersonne() {
  const garde = lireMoi();
  if (!garde || !garde.id) return false;

  const trouve = annuaire.find((p) => p.id === garde.id);
  if (!trouve) {
    oublierMoi();
    return false;
  }

  await choisirPersonne(trouve);
  // `choisirPersonne` affiche son refus au lieu de le lever : si le message
  // est rouge, l'etape n'a pas bouge et il faut redemander.
  if (messagePrenom.className === "erreur") {
    oublierMoi();
    return false;
  }
  return true;
}

// L'organisateur peut fermer cette page. Les mots sont les memes sur les
// cinq : c'est la meme serrure, vue de cinq endroits.
function signalerFermeture(ouverte) {
  const bandeau = document.getElementById("page-fermee");
  if (bandeau) bandeau.hidden = !!ouverte;
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
    annuaire = await rpc("participants_lister", { p_code: code });
    etat.code = code;
    ecrireMemoire(code);
    messageCode.textContent = "";
    // Le prenom retenu nous saute l'etape suivante -- sauf s'il ne vaut
    // plus, auquel cas on la montre comme avant.
    if (!(await reprendrePersonne())) {
      montrer("etape-prenom");
      champPrenom.focus();
    }
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
    listeSuggestions.firstElementChild?.click();
  }
});

async function choisirPersonne(personne) {
  messagePrenom.className = "";
  messagePrenom.textContent = "Chargement…";
  try {
    etat.moi = personne;
    etat.donnees = await rpc("dates_charger", {
      p_code: etat.code,
      p_acteur: personne.id,
    });
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    // Apres l'appel, et pas avant : on ne retient pas une personne dont la
    // base vient de refuser les donnees.
    ecrireMoi(personne);
    construire();
    montrer("etape-voeux");
  } catch (erreur) {
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ------------------------------------------------------------- etape 3

const zonePersonnes = document.getElementById("personnes");
const zoneOptions = document.getElementById("options");
const zoneClassement = document.getElementById("classement");

// Les plis « qui a repondu quoi » qu'on a ouverts. Le rapport se redessine
// a chaque enregistrement : sans cette memoire, le panneau se refermerait
// sous le doigt.
const deplies = new Set();
const verdict = document.getElementById("verdict");
const participation = document.getElementById("participation");
const legende = document.getElementById("legende-voeux");
const message = document.getElementById("message");
const boutonEnregistrer = document.getElementById("enregistrer");
const boutonTous = document.getElementById("appliquer-tous");
const portee = document.getElementById("portee-saisie");

function construire() {
  const { options, modifiables, voeux_ouverts } = etat.donnees;

  // AVANT le retour anticipe du dessous : une page fermee et sans aucun
  // week-end propose doit le dire aussi, et c'est meme le cas le plus
  // frequent -- on ferme souvent apres avoir retire les propositions.
  signalerFermeture(voeux_ouverts);

  if (options.length === 0) {
    document.getElementById("sous-titre").textContent =
      "Aucun week-end n'est encore proposé. Reviens plus tard.";
    legende.textContent = "Rien à choisir pour l'instant";
    boutonEnregistrer.disabled = true;
    zoneClassement.textContent = "";
    verdict.textContent = "";
    participation.textContent = "";
    return;
  }

  construireOptions(options);
  dessinerRapport();

  zonePersonnes.innerHTML = "";
  for (const personne of modifiables) {
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

  if (!voeux_ouverts) {
    boutonEnregistrer.disabled = boutonTous.disabled = true;
    message.className = "erreur";
    message.textContent = MESSAGES.VOEUX_FERMES;
  }

  selectionner(modifiables.find((p) => p.id === etat.moi.id) || modifiables[0]);
}

function construireOptions(options) {
  zoneOptions.innerHTML = "";

  for (const option of options) {
    const bloc = document.createElement("div");
    bloc.className = "option";
    bloc.dataset.id = option.id;

    const titre = document.createElement("div");
    titre.className = "option-titre";
    const periode =
      option.date_debut && option.date_fin
        ? `du ${afficherJour(option.date_debut)} au ${afficherJour(option.date_fin)}`
        : "";
    titre.append(fort(option.libelle));
    if (periode) titre.append(span(periode, "lien"));
    titre.append(
      span(
        `${option.oui} oui · ${option.non} non`,
        "lien"
      )
    );

    const boutons = document.createElement("div");
    boutons.className = "choix";
    for (const [valeur, libelle] of CHOIX) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = `choix-${valeur}`;
      bouton.dataset.choix = valeur;
      bouton.textContent = libelle;
      bouton.addEventListener("click", () => {
        // Recliquer sur sa propre reponse l'annule : c'est le seul moyen de
        // revenir a « pas repondu » sans recharger la page.
        const actuel = bloc.dataset.choix;
        bloc.dataset.choix = actuel === valeur ? "" : valeur;
        peindre(bloc);
      });
      boutons.appendChild(bouton);
    }

    bloc.append(titre, boutons);
    zoneOptions.appendChild(bloc);
  }
}

function peindre(bloc) {
  for (const bouton of bloc.querySelectorAll(".choix button")) {
    bouton.classList.toggle("actif", bouton.dataset.choix === bloc.dataset.choix);
  }
}

function selectionner(personne) {
  if (!personne) return;
  etat.cible = personne;

  for (const pastille of zonePersonnes.children) {
    pastille.classList.toggle("active", pastille.dataset.id === personne.id);
  }

  legende.textContent =
    personne.id === etat.moi.id ? "Tes disponibilités" : `Pour ${personne.prenom}`;

  const siens = new Map(
    etat.donnees.voeux
      .filter((v) => v.participant_id === personne.id)
      .map((v) => [v.option_id, v.choix])
  );

  for (const bloc of zoneOptions.querySelectorAll(".option")) {
    bloc.dataset.choix = siens.get(bloc.dataset.id) || "";
    peindre(bloc);
  }

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
      `Attention : « Appliquer à tous » répond pour ${autres.length} autres personnes` +
      (ecrases.length
        ? `, et remplace les réponses déjà données par ${ecrases.length} d'entre elles.`
        : ", qui n'ont encore rien répondu.") +
      ` Pour ne toucher qu'à ${etat.cible.prenom}, prends l'autre bouton.`;
  } else {
    portee.textContent = `« Appliquer à tous » recopie ces réponses sur ${autres
      .map((p) => p.prenom)
      .join(", ")} — les leurs sont remplacées.`;
  }
}

function lireChoix() {
  const choix = [];
  for (const bloc of zoneOptions.querySelectorAll(".option")) {
    if (bloc.dataset.choix) {
      choix.push({ option_id: bloc.dataset.id, choix: bloc.dataset.choix });
    }
  }
  return choix;
}

async function enregistrer(cibles) {
  const choix = lireChoix();
  boutonEnregistrer.disabled = boutonTous.disabled = true;
  message.className = "";
  message.textContent = "Enregistrement…";

  try {
    await rpc("dates_enregistrer", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_cibles: cibles.map((p) => p.id),
      p_choix: choix,
    });

    // Les compteurs affiches viennent du serveur : on recharge plutot que
    // de les recalculer de tete, au risque de se tromper.
    etat.donnees = await rpc("dates_charger", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
    });
    construire();
    selectionner(
      etat.donnees.modifiables.find((p) => p.id === etat.cible.id) || etat.cible
    );

    const qui = cibles.length === 1 ? cibles[0].prenom : `${cibles.length} personnes`;
    message.className = "ok";
    message.textContent = choix.length
      ? `${qui} : ${choix.length} réponse(s) enregistrée(s).`
      : `${qui} : aucune réponse enregistrée.`;
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
      `Appliquer ces réponses à ${autres.length} autres personnes ?` +
      (ecrases.length
        ? `\n\n${ecrases.length} d'entre elles ont déjà répondu : ${ecrases
            .map((p) => p.prenom)
            .join(", ")}.\nCe qu'elles ont fait sera remplacé, et ne se retrouvera pas.`
        : "") +
      `\n\nSi tu ne voulais répondre que pour toi, annule et prends « Enregistrer pour ${etat.cible.prenom} ».`;
  } else {
    question = `Appliquer ces réponses à ${tous.map((p) => p.prenom).join(", ")} ?`;
    if (ecrases.length) {
      question += `\n\nLes réponses de ${ecrases.map((p) => p.prenom).join(", ")} seront remplacées.`;
    }
  }
  if (confirm(question)) enregistrer(tous);
});

document.getElementById("changer").addEventListener("click", () => {
  // Changer de personne, c'est dire que celle qu'on retenait n'etait pas la
  // bonne : on l'oublie, sinon la page suivante la reprendrait.
  oublierMoi();
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
  if (fil) {
    fil.hidden = id === "etape-code";
    // La relance ne vaut que tant qu'il reste quelque chose a faire : une
    // fois la personne choisie, « reste a dire qui tu es » serait faux.
    const suite = document.getElementById("fil-suite");
    if (suite) suite.hidden = id !== "etape-prenom";
  }
}

if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}

// ----------------------------------------------------------- rapport
//
// Ou en est le choix, pour tout le monde et pas seulement pour
// l'organisateur.
//
// Le score etait jusqu'ici reserve a admin.html. Le reserver n'avait aucun
// effet : il se deduit des trois compteurs que la page affiche deja, et
// n'importe qui pouvait le refaire de tete. Autant le poser proprement, et
// avec ce qui lui manquait pour vouloir dire quelque chose -- combien de
// gens se sont prononces.
//
// Toujours aucun nom : des totaux, et rien d'autre.

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
      // Ceux qui n'ont rien dit sur CE week-end. Ils comptent : un week-end
      // en tete avec trois reponses sur vingt n'est pas un resultat.
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
// Les trois groupes se forment ici : « sans reponse » n'est pas une donnee,
// c'est le reste de la famille. La base sert les reponses brutes.
const NOMS_CHOIX = [
  ["oui", "Oui"],
  ["non", "Non"],
  ["muet", "Sans réponse"],
];

// Les prenoms se repetent dans une famille de quatre-vingts personnes. On
// n'ajoute la precision que lorsqu'elle sert : « Alice (Bernard) » partout
// alourdirait une liste ou la moitie des prenoms sont uniques.
function nommerRepondant(personne) {
  const tous = (etat.donnees && etat.donnees.tous) || [];
  const homonymes = tous.filter((p) => p.prenom === personne.prenom).length > 1;
  return homonymes && personne.famille && personne.famille !== personne.prenom
    ? `${personne.prenom} (${personne.famille})`
    : personne.prenom;
}

function grouperReponses(optionId) {
  const reponses = (etat.donnees && etat.donnees.reponses) || [];
  const dit = new Map(
    reponses
      .filter((r) => r.option_id === optionId)
      .map((r) => [r.participant_id, r.choix])
  );
  const groupes = { oui: [], non: [], muet: [] };
  for (const personne of (etat.donnees && etat.donnees.tous) || []) {
    groupes[dit.get(personne.id) || "muet"].push(personne);
  }
  return groupes;
}

function quiADitQuoi(ligne) {
  const groupes = grouperReponses(ligne.id);

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
    bloc.append(fort(libelle), " — ");
    bloc.append(
      groupes[cle].length ? groupes[cle].map(nommerRepondant).join(", ") : "personne"
    );
    pli.appendChild(bloc);
  }
  return pli;
}

function dessinerRapport() {
  const donnees = etat.donnees;
  const classement = classer(donnees.options, donnees.participants);

  // Entre parentheses, et seulement s'il y a quelque chose a dire : la
  // legende se lit « Résultat des choix (12 personnes sur 20 ont répondu) ».
  const combien = participationTexte(donnees);
  participation.textContent = combien ? `(${combien})` : "";

  verdict.className = classement.vide ? "note" : "note resultat";
  verdict.textContent = verdictTexte(classement);

  zoneClassement.textContent = "";
  for (const ligne of classement.lignes) {
    const item = document.createElement("li");

    const titre = document.createElement("div");
    titre.className = "rang-titre";
    titre.append(span(ordinal(ligne.rang), "etiquette"), fort(ligne.libelle));
    if (ligne.date_debut && ligne.date_fin) {
      titre.append(
        span(`du ${afficherJour(ligne.date_debut)} au ${afficherJour(ligne.date_fin)}`, "lien")
      );
    }

    const chiffres = document.createElement("div");
    chiffres.className = "rang-chiffres";
    chiffres.textContent =
      `${ligne.oui} oui · ${ligne.non} non` +
      (ligne.muets ? ` · ${ligne.muets} sans réponse` : "");

    item.append(titre, barre(ligne, donnees.participants || ligne.repondu || 1), chiffres);
    item.appendChild(quiADitQuoi(ligne));
    zoneClassement.appendChild(item);
  }
}
