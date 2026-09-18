"use strict";

// Le formulaire n'envoie que des FAITS : qui dort ou, et quels repas.
// Aucun regime, aucun tarif, aucun total n'est calcule ici : c'est le role
// du Python. Le jour ou une regle de l'hotel change, ce fichier ne bouge pas.
//
// Il ne touche a aucune table non plus : trois fonctions SQL sont les seules
// portes d'entree, et elles verifient le code et les droits a chaque appel.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const REPAS = ["petit_dejeuner", "dejeuner", "diner"];
const ABSENT = "absent"; // valeur d'interface : ne produit aucune ligne en base

const HEBERGEMENTS = [
  [ABSENT, "absente"],
  ["chambre", "en chambre"],
  ["gite", "en gîte"],
  ["exterieur", "ailleurs"],
];

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  DROIT_REFUSE: "Tu n'as pas le droit de modifier cette personne.",
  SAISIE_FERMEE: "La saisie est fermée. Contacte l'organisateur.",
  TROP_DE_LIGNES: "Saisie trop volumineuse.",
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
    item.innerHTML = `<strong>${personne.prenom}</strong> <span>${personne.famille}</span>`;
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

  document.getElementById("sous-titre").textContent =
    `Du ${afficherJour(date_debut)} au ${afficherJour(date_fin)}.`;

  construireGrille(listerJours(date_debut, date_fin));

  zonePersonnes.innerHTML = "";
  for (const personne of modifiables) {
    const pastille = document.createElement("button");
    pastille.type = "button";
    pastille.className = "pastille";
    pastille.dataset.id = personne.id;
    pastille.innerHTML =
      `${personne.prenom}` +
      (personne.id === etat.moi.id ? " <span class='moi'>(toi)</span>" : "") +
      (personne.saisi ? "" : " <span class='vide'>•</span>");
    pastille.title = personne.saisi ? "Déjà saisi" : "Rien de saisi pour l'instant";
    pastille.addEventListener("click", () => selectionnerCible(personne));
    zonePersonnes.appendChild(pastille);
  }

  if (!saisie_ouverte) {
    document.getElementById("enregistrer").disabled = true;
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

    for (const champ of ["vue_mer", ...REPAS]) {
      const cellule = document.createElement("td");
      const caseACocher = document.createElement("input");
      caseACocher.type = "checkbox";
      caseACocher.dataset.champ = champ;
      caseACocher.setAttribute("aria-label", `${champ} du ${jour}`);
      cellule.appendChild(caseACocher);
      ligne.appendChild(cellule);
    }

    choix.addEventListener("change", () => appliquerContraintes(ligne));
    corpsJours.appendChild(ligne);
  }
}

// Absente = rien du tout : ni nuit, ni repas. Le supplement vue mer, lui,
// n'existe que pour les chambres.
function appliquerContraintes(ligne) {
  const hebergement = ligne.querySelector('[data-champ="hebergement"]').value;
  const absente = hebergement === ABSENT;

  for (const repas of REPAS) {
    const c = ligne.querySelector(`[data-champ="${repas}"]`);
    c.disabled = absente;
    if (absente) c.checked = false;
  }

  const vueMer = ligne.querySelector('[data-champ="vue_mer"]');
  vueMer.disabled = hebergement !== "chambre";
  if (vueMer.disabled) vueMer.checked = false;

  ligne.classList.toggle("absente", absente);
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
  message.className = "";
  message.textContent = "";
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

    // Absent par defaut : sans ligne en base, la journee reste vide.
    champ("hebergement").value = presence ? presence.hebergement : ABSENT;
    champ("vue_mer").checked = presence ? presence.vue_mer : false;
    for (const repas of REPAS) champ(repas).checked = presence ? presence[repas] : false;

    appliquerContraintes(ligne);
  }
}

function lireGrille() {
  const lignes = [];
  for (const ligne of corpsJours.querySelectorAll("tr")) {
    const champ = (nom) => ligne.querySelector(`[data-champ="${nom}"]`);
    const hebergement = champ("hebergement").value;
    if (hebergement === ABSENT) continue;

    lignes.push({
      jour: ligne.dataset.jour,
      hebergement,
      vue_mer: champ("vue_mer").checked,
      ...Object.fromEntries(REPAS.map((r) => [r, champ(r).checked])),
    });
  }
  return lignes;
}

const boutonEnregistrer = document.getElementById("enregistrer");

boutonEnregistrer.addEventListener("click", async () => {
  const lignes = lireGrille();
  boutonEnregistrer.disabled = true;
  message.className = "";
  message.textContent = "Enregistrement…";

  try {
    await rpc("sejour_enregistrer", {
      p_code: etat.code,
      p_acteur: etat.moi.id,
      p_cible: etat.cible.id,
      p_lignes: lignes,
    });

    // L'etat local doit refleter la base, sinon changer de personne puis
    // revenir reafficherait l'ancienne saisie.
    etat.donnees.presences = etat.donnees.presences
      .filter((p) => p.participant_id !== etat.cible.id)
      .concat(lignes.map((l) => ({ ...l, participant_id: etat.cible.id })));

    const pastille = zonePersonnes.querySelector(`[data-id="${etat.cible.id}"]`);
    if (pastille) pastille.querySelector(".vide")?.remove();

    message.className = "ok";
    message.textContent = lignes.length
      ? `${etat.cible.prenom} : ${lignes.length} jour(s) enregistré(s).`
      : `${etat.cible.prenom} est notée absente sur tout le séjour.`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
  } finally {
    boutonEnregistrer.disabled = false;
  }
});

document.getElementById("changer").addEventListener("click", () => {
  champPrenom.value = "";
  listeSuggestions.innerHTML = "";
  montrer("etape-prenom");
  champPrenom.focus();
});

// ------------------------------------------------------------ affichage

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
}

// Le code est deja connu de cet appareil : on saute la premiere etape.
if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
