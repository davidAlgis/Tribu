"use strict";

// Les preferences alimentaires : ce que chacun mange et boit.
//
// Meme modele d'identite et de droits que les autres pages familiales :
// code famille, prenom, et l'on repond pour les personnes qu'on gere.
//
// UNE DIFFERENCE : tout le monde tient sur le meme ecran. Les autres
// pages font choisir une personne a la fois parce qu'elles demandent
// quinze cases par personne ; ici il y en a quatre, et un foyer se
// remplit d'un seul regard.
//
// CHAQUE CASE PART TOUTE SEULE. Pas de bouton « Enregistrer » : une case
// a cocher qui attend un bouton est une case qu'on croit cochee.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

// L'ordre dans lequel on les pose a l'ecran. Le boire d'abord, le manger
// ensuite : c'est l'ordre dans lequel on commande.
const CASES = [
  // La CLEF reste `non_buveur` : elle voyage dans les exports et les
  // imports. Seul le mot change -- « sans alcool » dit ce qu'on commande,
  // la ou « non buveur » disait ce qu'on est.
  ["non_buveur", "Sans alcool"],
  ["vegetarien", "Végétarien"],
  ["vegan", "Vegan"],
  ["sans_gluten", "Sans gluten"],
];

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  PAS_A_TOI: "Tu n'as pas le droit de répondre pour cette personne.",
  SAISIE_CLOSE: "La saisie est close. Contacte l'organisateur.",
};

const etat = { code: "", moi: null, gens: [] };

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

// ---------------------------------------------------------------- noeuds

// Prenoms et familles viennent de la base, et la base tient ce que le
// GEDCOM lui a donne : des chaines qu'aucun humain n'a relues. Passees a
// innerHTML, elles seraient interpretees comme du balisage. On fabrique
// donc les noeuds un par un : textContent pose du texte, et rien d'autre.
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
    await recharger();
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    // Apres l'appel, et pas avant : on ne retient pas une personne dont la
    // base vient de refuser les donnees.
    ecrireMoi(personne);
    montrer("etape-regimes");
  } catch (erreur) {
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ------------------------------------------------------------- etape 3

const zoneRegimes = document.getElementById("regimes");
const compteur = document.getElementById("compteur-regimes");
const message = document.getElementById("message");

async function recharger() {
  const d = await rpc("regimes_charger", {
    p_code: etat.code,
    p_acteur: etat.moi.id,
  });
  etat.gens = d.gens || [];
  etat.ouverte = d.ouverte;
  dessiner();
}

function dessiner() {
  compteur.textContent = etat.gens.length
    ? `${etat.gens.length} personne(s) à ta charge`
    : "";

  zoneRegimes.textContent = "";
  for (const personne of etat.gens) {
    const bloc = document.createElement("div");
    bloc.className = "personne-regime";
    bloc.dataset.personne = personne.id;

    const nom = document.createElement("div");
    nom.className = "nom-regime";
    nom.append(fort(personne.prenom));
    if (personne.mineur) nom.append(span("mineur", "etiquette"));
    bloc.appendChild(nom);

    const cases = document.createElement("div");
    cases.className = "cases-regime";
    for (const [champ, libelle] of CASES) {
      const etiquette = document.createElement("label");
      etiquette.className = "interrupteur";
      const boite = document.createElement("input");
      boite.type = "checkbox";
      boite.dataset.champ = champ;
      boite.checked = !!personne[champ];
      // Un mineur ne boit pas : la case est cochee et ne se decoche pas.
      // La base le refuserait de toute facon -- une page ne fait pas foi
      // -- mais un refus qu'on voit venir vaut mieux qu'un refus recu.
      if (champ === "non_buveur" && personne.mineur) {
        boite.checked = true;
        boite.disabled = true;
        etiquette.title = "Un mineur ne boit pas : la case ne se décoche pas.";
      }
      if (!etat.ouverte) boite.disabled = true;
      boite.addEventListener("change", () => enregistrer(personne, bloc));
      etiquette.append(boite, ` ${libelle}`);
      cases.appendChild(etiquette);
    }
    bloc.appendChild(cases);
    zoneRegimes.appendChild(bloc);
  }

  if (!etat.gens.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = "Personne à ta charge : il n'y a rien à remplir ici.";
    zoneRegimes.appendChild(rien);
  }
  if (!etat.ouverte) {
    const close = document.createElement("p");
    close.className = "note";
    close.textContent =
      "La saisie est close : les cases se lisent, mais ne se changent plus.";
    zoneRegimes.appendChild(close);
  }
}

async function enregistrer(personne, bloc) {
  const regimes = {};
  for (const boite of bloc.querySelectorAll("input[data-champ]")) {
    regimes[boite.dataset.champ] = boite.checked;
  }

  message.className = "";
  message.textContent = "Enregistrement…";
  try {
    await rpc("regimes_enregistrer", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_cible: personne.id,
      p_regimes: regimes,
    });
    Object.assign(personne, regimes);
    message.className = "ok";
    message.textContent = `C'est noté pour ${personne.prenom}.`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
    // La base a refuse : l'ecran doit revenir a ce qu'elle garde, sinon
    // la case reste cochee et ment.
    await recharger();
  }
}

document.getElementById("changer").addEventListener("click", () => {
  // Changer de personne, c'est dire que celle qu'on retenait n'etait pas la
  // bonne : on l'oublie, sinon la page suivante la reprendrait.
  oublierMoi();
  etat.moi = null;
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

// Le code est deja connu de cet appareil -- il vient de la page
// d'accueil, ou d'une autre etape : on saute la premiere etape, comme
// partout ailleurs.
if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
