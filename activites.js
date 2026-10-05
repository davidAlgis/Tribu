"use strict";

// Les activites : ce qu'on a envie de faire sur place.
//
// Meme modele d'identite et de droits que les autres pages familiales :
// code famille, prenom, et l'on repond pour les personnes qu'on gere.
//
// DEUX DIFFERENCES avec les preferences alimentaires.
//
// TOUT LE MONDE VOIT TOUT. On se decide pour une randonnee en sachant qui
// vient ; la question n'a pas de sens amputee des autres. Ce que mange le
// cousin, lui, ne regarde que lui.
//
// N'IMPORTE QUI AJOUTE A LA LISTE. C'est la seule page ou la famille pose
// une ligne que l'organisateur n'a pas prevue. Retirer reste a
// l'organisateur : une idee effacee emporte les reponses de tous.
//
// NON EST LA REPONSE PAR DEFAUT, et elle ne s'ecrit pas : la base ne garde
// que les « oui » et les « pourquoi pas ». Le nombre de « non » se deduit
// donc de la liste des participants, ici, et non d'un comptage de lignes.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

// L'ordre de la liste deroulante. « Non » en dernier bien qu'il soit le
// defaut : on ouvre le menu pour dire oui, pas pour confirmer un refus.
const AVIS = [
  ["oui", "Oui"],
  ["peut_etre", "Pourquoi pas"],
  ["non", "Non"],
];

const NOM_AVIS = Object.fromEntries(AVIS);

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  PAS_A_TOI: "Tu n'as pas le droit de répondre pour cette personne.",
  SAISIE_CLOSE: "La saisie est close. Contacte l'organisateur.",
  TITRE_VIDE: "Il faut un intitulé.",
  ACTIVITE_EXISTE: "Cette idée est déjà dans la liste.",
  ACTIVITE_INCONNUE: "Cette idée vient d'être retirée de la liste.",
  AVIS_INCONNU: "Réponse inconnue.",
  INCONNU: "On ne te trouve pas dans la liste.",
};

const etat = { code: "", moi: null, cible: null, donnees: null };

// Les panneaux « qui a dit quoi » qu'on a ouverts. Redessiner la liste
// refait les elements : sans cette memoire, le panneau se refermerait sous
// le doigt a chaque reponse donnee.
const deplies = new Set();

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

// Le code est partage avec les autres pages : entre une fois, entre
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

// ---------------------------------------------------------------- noeuds

// Prenoms, familles et intitules viennent de la base, et la base tient ce
// que le GEDCOM lui a donne -- plus, ici, ce que la famille y ecrit
// elle-meme. Passes a innerHTML, ces textes seraient interpretes comme du
// balisage. On fabrique donc les noeuds un par un : textContent pose du
// texte, et rien d'autre.
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
    etat.cible = null;
    await recharger();
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    // Apres l'appel, et pas avant : on ne retient pas une personne dont la
    // base vient de refuser les donnees.
    ecrireMoi(personne);
    montrer("etape-activites");
  } catch (erreur) {
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ------------------------------------------------------------- etape 3

const zoneActivites = document.getElementById("activites");
const zonePersonnes = document.getElementById("personnes");
const blocPourQui = document.getElementById("bloc-pour-qui");
const compteur = document.getElementById("compteur-activites");
const message = document.getElementById("message");

async function recharger() {
  etat.donnees = await rpc("activites_charger", {
    p_code: etat.code,
    p_acteur: etat.moi.id,
  });
  const gens = etat.donnees.gens || [];
  // Celle qu'on avait sous la main, si elle est toujours a nous ; sinon
  // soi-meme, et a defaut la premiere venue.
  etat.cible =
    gens.find((p) => etat.cible && p.id === etat.cible.id) ||
    gens.find((p) => p.id === etat.moi.id) ||
    gens[0] ||
    null;
  dessinerPersonnes();
  dessiner();
}

// Les prenoms se repetent dans une famille de soixante personnes. On
// n'ajoute la precision que lorsqu'elle sert : « Bruno (Alice) » partout
// alourdirait une liste ou la moitie des prenoms sont uniques.
function nommer(personne) {
  const tous = (etat.donnees && etat.donnees.tous) || [];
  const homonymes = tous.filter((p) => p.prenom === personne.prenom).length > 1;
  return homonymes && personne.famille && personne.famille !== personne.prenom
    ? `${personne.prenom} (${personne.famille})`
    : personne.prenom;
}

function dessinerPersonnes() {
  const gens = (etat.donnees && etat.donnees.gens) || [];
  // Une seule personne a sa charge : la rangee de pastilles ne proposerait
  // qu'un choix, et un choix unique n'est pas un choix.
  blocPourQui.hidden = gens.length < 2;

  zonePersonnes.textContent = "";
  for (const personne of gens) {
    const pastille = document.createElement("button");
    pastille.type = "button";
    pastille.className = "pastille";
    pastille.dataset.id = personne.id;
    pastille.append(personne.prenom);
    if (personne.id === etat.moi.id) pastille.append(" ", span("(toi)", "moi"));
    pastille.addEventListener("click", () => {
      etat.cible = personne;
      dessinerPersonnes();
      dessiner();
      message.className = "";
      message.textContent = "";
    });
    zonePersonnes.appendChild(pastille);
  }
  for (const pastille of zonePersonnes.children) {
    pastille.classList.toggle(
      "active",
      !!etat.cible && pastille.dataset.id === etat.cible.id
    );
  }
}

// Ce que la base garde : rien pour un « non ». Le defaut se lit ici.
function avisDe(participant, activite) {
  const ligne = (etat.donnees.envies || []).find(
    (e) => e.participant_id === participant && e.activite_id === activite
  );
  return ligne ? ligne.avis : "non";
}

// Trois listes de prenoms, dans l'ordre familial -- celui de `tous`.
function repartir(activite) {
  const groupes = { oui: [], peut_etre: [], non: [] };
  for (const personne of etat.donnees.tous || []) {
    groupes[avisDe(personne.id, activite.id)].push(personne);
  }
  return groupes;
}

function dessiner() {
  const activites = (etat.donnees && etat.donnees.activites) || [];
  const ouverte = etat.donnees && etat.donnees.ouverte;
  signalerFermeture(ouverte);

  compteur.textContent = activites.length
    ? `${activites.length} idée(s)`
    : "";

  zoneActivites.textContent = "";

  if (!activites.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent =
      "Rien dans la liste pour l'instant. Ouvre « Proposer une activité » " +
      "et mets-y la première idée.";
    zoneActivites.appendChild(rien);
  }

  for (const activite of activites) {
    zoneActivites.appendChild(carte(activite, ouverte));
  }

  if (!ouverte) {
    const close = document.createElement("p");
    close.className = "note";
    close.textContent =
      "La saisie est close : la liste se lit, elle ne se change plus.";
    zoneActivites.appendChild(close);
  }
}

function carte(activite, ouverte) {
  const groupes = repartir(activite);

  const bloc = document.createElement("div");
  bloc.className = "activite";
  bloc.dataset.activite = activite.id;

  const tete = document.createElement("div");
  tete.className = "activite-tete";
  tete.appendChild(fort(activite.titre));

  // La liste deroulante ne vaut que pour la personne choisie : c'est son
  // prenom qui doit etre dans l'etiquette, sinon un lecteur d'ecran
  // annonce trois fois « Oui » sans dire de qui.
  if (etat.cible) {
    const choix = document.createElement("select");
    choix.dataset.activite = activite.id;
    choix.setAttribute(
      "aria-label",
      `${activite.titre} — réponse de ${etat.cible.prenom}`
    );
    for (const [valeur, libelle] of AVIS) {
      const option = document.createElement("option");
      option.value = valeur;
      option.textContent = libelle;
      choix.appendChild(option);
    }
    choix.value = avisDe(etat.cible.id, activite.id);
    choix.disabled = !ouverte;
    choix.addEventListener("change", () => voter(activite, choix.value));
    tete.appendChild(choix);
  }
  bloc.appendChild(tete);

  if (activite.description) {
    const precision = document.createElement("p");
    precision.className = "note";
    precision.textContent = activite.description;
    bloc.appendChild(precision);
  }

  const comptes = document.createElement("div");
  comptes.className = "etiquettes";
  comptes.append(
    span(`${groupes.oui.length} oui`, "etiquette ok"),
    span(`${groupes.peut_etre.length} pourquoi pas`, "etiquette"),
    span(`${groupes.non.length} non`, "etiquette")
  );

  const bas = document.createElement("div");
  bas.className = "activite-bas";
  bas.appendChild(comptes);
  const propose = nomDuProposant(activite);
  if (propose) bas.appendChild(span(`proposé par ${propose}`, "discret-inline"));
  bloc.appendChild(bas);

  bloc.appendChild(qui(activite, groupes));
  return bloc;
}

function nomDuProposant(activite) {
  if (!activite.propose_par) return "";
  const personne = (etat.donnees.tous || []).find((p) => p.id === activite.propose_par);
  return personne ? nommer(personne) : "";
}

// Les noms, derriere un pli. Depliee, la liste des « non » fait soixante
// prenoms sous chaque idee, et la page ne montre plus les idees.
function qui(activite, groupes) {
  const pli = document.createElement("details");
  pli.className = "qui-a-dit";
  pli.open = deplies.has(activite.id);
  pli.addEventListener("toggle", () => {
    if (pli.open) deplies.add(activite.id);
    else deplies.delete(activite.id);
  });

  const resume = document.createElement("summary");
  resume.textContent = "Qui a dit quoi";
  pli.appendChild(resume);

  for (const [valeur, libelle] of AVIS) {
    const ligne = document.createElement("p");
    ligne.className = "note";
    ligne.append(fort(libelle), " — ");
    ligne.append(
      groupes[valeur].length
        ? groupes[valeur].map(nommer).join(", ")
        : "personne"
    );
    pli.appendChild(ligne);
  }
  return pli;
}

async function voter(activite, avis) {
  if (!etat.cible) return;
  const cible = etat.cible;

  message.className = "";
  message.textContent = "Enregistrement…";
  try {
    await rpc("activites_voter", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_cible: cible.id,
      p_activite: activite.id,
      p_avis: avis,
    });

    // La base a pris : on range la meme chose ici, sans tout recharger --
    // les comptes doivent bouger tout de suite, y compris pour les autres
    // lignes de la personne.
    const envies = (etat.donnees.envies || []).filter(
      (e) => !(e.participant_id === cible.id && e.activite_id === activite.id)
    );
    if (avis !== "non") {
      envies.push({
        participant_id: cible.id,
        activite_id: activite.id,
        avis,
      });
    }
    etat.donnees.envies = envies;
    dessiner();

    message.className = "ok";
    message.textContent = `${NOM_AVIS[avis]} pour ${cible.prenom} : c'est noté.`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
    // La base a refuse : l'ecran doit revenir a ce qu'elle garde, sinon la
    // liste deroulante affiche une reponse qui n'existe pas.
    await recharger();
  }
}

// ---------------------------------------------------------- proposer

const champTitre = document.getElementById("titre");
const champDescription = document.getElementById("description");
const messageProposer = document.getElementById("message-proposer");

document.getElementById("proposer").addEventListener("click", async () => {
  messageProposer.className = "";
  messageProposer.textContent = "Enregistrement…";
  try {
    await rpc("activites_proposer", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_titre: champTitre.value,
      p_description: champDescription.value,
    });
    champTitre.value = "";
    champDescription.value = "";
    await recharger();
    messageProposer.className = "ok";
    messageProposer.textContent = "C'est dans la liste. À toi de répondre.";
  } catch (erreur) {
    messageProposer.className = "erreur";
    messageProposer.textContent = erreur.message;
  }
});

document.getElementById("changer").addEventListener("click", () => {
  // Changer de personne, c'est dire que celle qu'on retenait n'etait pas la
  // bonne : on l'oublie, sinon la page suivante la reprendrait.
  oublierMoi();
  etat.moi = null;
  etat.cible = null;
  champPrenom.value = "";
  montrer("etape-prenom");
  champPrenom.focus();
});

// ---------------------------------------------------------------- etapes

const fil = document.getElementById("fil");
const filSuite = document.getElementById("fil-suite");

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
  // Les deux premieres etapes se ressemblent : un fieldset, un champ de
  // texte, au meme endroit. Le fil, lui, apparait et ne repart plus.
  if (fil) {
    fil.hidden = id === "etape-code";
    filSuite.textContent =
      id === "etape-prenom" ? "Reste à dire qui tu es." : "";
  }
}

// Le code est deja connu de cet appareil -- il vient de la page d'accueil,
// ou d'une autre etape : on saute la premiere etape, comme partout
// ailleurs.
if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
