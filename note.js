"use strict";

// La note, cote famille : ce que je paie, et ce que paient ceux dont je
// remplis les presences.
//
// CE FICHIER NE CALCULE NI NE DESSINE RIEN. Les montants viennent de
// `facture.js`, les tableaux de `tableaux.js` -- les deux memes que la
// page de l'organisateur. C'est tout l'interet : celui qui demande
// l'argent et celui qui le paie lisent le meme tableau, au meme format,
// sorti du meme calcul. Il ne reste ici que le branchement -- l'identite,
// l'appel, et le tri de ce qui me regarde.
//
// LE NOM DU FICHIER. `facture.js` etait pris par le calcul, qui vit hors
// du navigateur et se compare au moteur Python. Celui-ci est le script de
// `facture.html`, comme `app.js` est celui de `presences.html`.
//
// RIEN NE S'ECRIT. Pas de bouton, pas de champ : la page lit. Pour changer
// un montant, il faut changer ce qu'il compte -- une nuit se decoche sur
// les presences.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  REGLAGES_ABSENTS: "Les dates du séjour ne sont pas encore posées.",
};

const etat = { code: "", moi: null };

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
  messagePrenom.textContent = "Calcul…";
  try {
    etat.moi = personne;
    await recharger();
    messagePrenom.textContent = "";
    listeSuggestions.innerHTML = "";
    // Apres l'appel, et pas avant : on ne retient pas une personne dont la
    // base vient de refuser les donnees.
    ecrireMoi(personne);
    montrer("etape-facture");
  } catch (erreur) {
    messagePrenom.className = "erreur";
    messagePrenom.textContent = erreur.message;
  }
}

// ------------------------------------------------------------- etape 3

const zoneResume = document.getElementById("facture-resume");
const zoneNuits = document.getElementById("facture-hebergement");
const zoneRepas = document.getElementById("facture-repas");
const alerteFacture = document.getElementById("alerte-facture");
const compteurFacture = document.getElementById("compteur-facture");
const compteurNuits = document.getElementById("compteur-nuits");
const compteurRepas = document.getElementById("compteur-repas");
const message = document.getElementById("message");

const { euros, rienDire, tableau, colonnes } = TABLEAUX;
const arrondi = (v) => Math.round(v * 100) / 100;

async function recharger() {
  const donnees = await rpc("facture_charger", {
    p_code: etat.code,
    p_acteur: etat.moi.id,
  });
  dessiner(donnees, FACTURE.calculer(donnees.faits, donnees.grille));
}

function dessiner(donnees, calcul) {
  const gens = new Map((donnees.gens || []).map((p) => [p.id, p]));

  // CE QUI SORT DU CALCUL N'EST PAS CE QU'ON MONTRE.
  //
  // La base a joint les co-occupants de gite : sans eux, la part qu'on
  // afficherait serait fausse -- plus chere, puisqu'on diviserait le gite
  // par les seuls occupants qu'on voit. Ils ont donc une ligne dans le
  // calcul ; ils n'en ont pas a l'ecran. On ne garde que les miens.
  const lignes = calcul.lignes.filter((l) => gens.has(l.personne_id));
  const total = arrondi(lignes.reduce((somme, l) => somme + l.total, 0));

  compteurFacture.textContent = lignes.length
    ? `${lignes.length} personne(s) — ${euros(total)} en tout`
    : "";

  // Ce qui rend le total faux se dit AVANT le total, et non en note de bas
  // de page : une somme qu'on lit sans savoir qu'elle est incomplete est
  // pire qu'une somme absente. Et ici, le lecteur n'a aucun moyen de
  // deviner qu'un prix manque -- ni rien pour le corriger.
  alerteFacture.textContent = "";
  if (calcul.manquants.length) {
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent =
      "Tous les prix ne sont pas encore posés : ce total est provisoire, " +
      "et plus bas que ce qu'il sera. Ce n'est pas à toi de le corriger — " +
      "l'organisateur le verra de son côté.";
    alerteFacture.appendChild(p);
  }
  const sansPlace = calcul.sansPlace.filter((x) => gens.has(x.personne_id));
  if (sansPlace.length) {
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent =
      `${sansPlace.length} nuit(s) en gîte sans place attribuée : tant que le ` +
      "plan de couchage n'est pas fini, ces nuits ne sont comptées à " +
      "personne, et ce total est incomplet.";
    alerteFacture.appendChild(p);
  }

  if (!lignes.length) {
    rienDire(
      zoneResume,
      "Rien de déclaré pour l'instant : ni nuit, ni repas. Le total viendra " +
        "quand la grille des présences sera remplie."
    );
    rienDire(zoneNuits, "Aucune nuit déclarée.");
    rienDire(zoneRepas, "Aucun repas déclaré.");
    compteurNuits.textContent = "";
    compteurRepas.textContent = "";
    return;
  }

  zoneResume.textContent = "";
  // Trois colonnes, et pas sept : hebergement, repas, total. Les rapports
  // servent a comparer des sejours de longueurs differentes, ce qu'on ne
  // fait pas sur sa propre note.
  //
  // Les supplements et reductions que l'organisateur a poses sur les miens
  // se montrent : sans eux, le total ne serait pas la somme de ce qui le
  // precede.
  zoneResume.appendChild(
    tableau(
      colonnes.resume({
        rapports: false,
        ajustements: lignes.some((l) => l.ajustement),
      }),
      lignes,
      gens
    )
  );

  // --- les nuits
  const dormeurs = lignes.filter((l) => l.nuits > 0);
  compteurNuits.textContent = dormeurs.length
    ? `${calcul.nuits.length} nuit(s) — ${euros(
        arrondi(dormeurs.reduce((t, l) => t + l.hebergement + l.taxe, 0))
      )}`
    : "";
  if (!dormeurs.length) {
    rienDire(zoneNuits, "Personne n'a déclaré dormir sur place : rien à compter ici.");
  } else {
    zoneNuits.textContent = "";
    zoneNuits.appendChild(tableau(colonnes.nuits(calcul), dormeurs, gens));
  }

  // --- les repas hors pension
  const mangeurs = lignes.filter((l) => Object.keys(l.parRepas).length);
  compteurRepas.textContent = mangeurs.length
    ? `${calcul.repasColonnes.length} repas — ${euros(
        arrondi(mangeurs.reduce((t, l) => t + l.repas, 0))
      )}`
    : "";
  if (!mangeurs.length) {
    rienDire(
      zoneRepas,
      "Aucun repas hors pension : tout ce qui a été coché est compris dans une nuit."
    );
  } else {
    zoneRepas.textContent = "";
    zoneRepas.appendChild(tableau(colonnes.repas(calcul), mangeurs, gens));
  }
}

document.getElementById("changer").addEventListener("click", () => {
  // Changer de personne, c'est dire que celle qu'on retenait n'etait pas la
  // bonne : on l'oublie, sinon la page suivante la reprendrait.
  oublierMoi();
  etat.moi = null;
  champPrenom.value = "";
  message.className = "";
  message.textContent = "";
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
