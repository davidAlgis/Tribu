"use strict";

// Qui dort où, côté famille.
//
// Le plan était réservé à l'organisateur. Le voilà ouvert à tous — mais
// CHACUN NE DÉPLACE QUE LES SIENS : soi, son conjoint, ses descendants et
// leurs conjoints, exactement la règle qui vaut déjà pour les présences.
// Rien de nouveau à expliquer, rien de nouveau à tenir à jour.
//
// Tout le monde est VISIBLE, et c'est voulu : un plan amputé des autres ne
// répond pas à la question qu'on lui pose, qui est « avec qui ». Les jetons
// qu'on ne peut pas bouger paraissent donc, grisés.
//
// Le plateau lui-même vit dans `plan.js`, partagé avec `admin.html`. Ici on
// ne fournit que les deux portes — comment lire, comment écrire — et les
// deux étapes d'identité, qui sont celles des autres pages familiales.
//
// Le refus de déplacer quelqu'un d'autre est posé EN BASE. Cette page grise
// les jetons, mais une page ne fait pas foi : elle se recharge, elle se
// modifie, elle s'inspecte.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  PAS_A_TOI: "Ce n'est pas à toi de placer cette personne.",
  SAISIE_CLOSE: "La saisie est fermée. Contacte l'organisateur.",
  PAS_SUR_PLACE: "Cette personne n'a pas déclaré dormir sur place cette nuit-là.",
  UNITE_INCONNUE: "Ce couchage n'existe plus. Recharge la page.",
  INCONNU: "Cet élément n'existe plus. Recharge la page.",
  REGLAGES_ABSENTS: "Les réglages du séjour sont absents de la base.",
};

const etat = { code: "", acteur: null };

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

// ---------------------------------------------------------------- noeuds

// Les prenoms viennent de la base, et la base tient ce que le GEDCOM lui a
// donne : des chaines qu'aucun humain n'a relues. Passees a innerHTML,
// elles seraient interpretees comme du balisage. On fabrique donc les
// noeuds un par un : textContent pose du texte, et rien d'autre.
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

// ------------------------------------------------------------ affichage

const fil = document.getElementById("fil");

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
  // Les deux premieres etapes se ressemblent : un fieldset, un champ de
  // texte, au meme endroit. Le fil apparait et ne repart plus.
  if (fil) {
    fil.hidden = id === "etape-code";
    const suite = document.getElementById("fil-suite");
    if (suite) suite.hidden = id !== "etape-prenom";
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
    // Les prenoms sont des donnees personnelles : c'est cet appel qui les
    // debloque, et il echoue si le code est faux.
    const participants = await rpc("participants_lister", { p_code: code });
    etat.code = code;
    ecrireMemoire(code);
    messageCode.textContent = "";
    annuaire = participants;
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
    etat.acteur = personne.id;
    await plateau.recharger(null);
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    montrer("etape-plan");
  } catch (erreur) {
    etat.acteur = null;
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ----------------------------------------------------------- le plateau

const plateau = PLAN.monter({
  plan: document.getElementById("plan"),
  nuits: document.getElementById("choix-nuit"),
  compteur: document.getElementById("compteur-couchages"),
  message: document.getElementById("message-couchages"),

  charger: (jour) =>
    rpc("couchage_charger", { p_code: etat.code, p_acteur: etat.acteur, p_jour: jour }),

  // `unite` nul = le tas : la personne n'a plus de place attribuee.
  ecrire: (personneId, unite) =>
    rpc("couchage_placer", {
      p_code: etat.code,
      p_acteur: etat.acteur,
      p_participant: personneId,
      p_jour: plateau.jour(),
      p_logement: unite ? unite.logement_id : null,
      p_numero: unite ? unite.numero : null,
    }),
});
