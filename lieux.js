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
  peint: null, // pendant un glisse : true = on peint, false = on efface
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
    item.innerHTML = `<strong>${personne.prenom}</strong> <span>${personne.famille}</span>`;
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
const zonePersonnes = document.getElementById("personnes");
const legende = document.getElementById("legende-carte");
const carteLegende = document.getElementById("carte-legende");
const carteAide = document.getElementById("carte-aide");
const message = document.getElementById("message");
const boutonEnregistrer = document.getElementById("enregistrer");
const boutonTous = document.getElementById("appliquer-tous");
const portee = document.getElementById("portee-saisie");

const formes = new Map(); // code -> <path>

function dessinerCarte() {
  svg.setAttribute("viewBox", window.CARTE.viewBox);
  svg.innerHTML = "";
  formes.clear();

  for (const dep of window.CARTE.departements) {
    const forme = document.createElementNS("http://www.w3.org/2000/svg", "path");
    forme.setAttribute("d", dep.d);
    forme.dataset.code = dep.c;
    forme.classList.add("dep");

    const titre = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titre.textContent = `${dep.c} — ${dep.n}`;
    forme.appendChild(titre);

    svg.appendChild(forme);
    formes.set(dep.c, forme);
  }
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

svg.addEventListener("pointerdown", (e) => {
  if (etat.vue !== "moi") return;
  e.preventDefault();
  etat.peint = null;
  basculer(codeSous(e));
  // Sans capture, quitter la forme d'origine interromprait le glisse.
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener("pointermove", (e) => {
  if (etat.peint === null || !svg.hasPointerCapture(e.pointerId)) return;
  basculer(codeSous(e));
});

for (const fin of ["pointerup", "pointercancel"]) {
  svg.addEventListener(fin, () => {
    etat.peint = null;
  });
}

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
    carteLegende.innerHTML =
      `<span class="pastille-legende vert"></span> possible ` +
      `<span class="pastille-legende rouge"></span> ${etat.refuses.size} refusé(s)`;
    carteAide.textContent =
      "Glisse le doigt pour peindre, repasse dessus pour effacer.";
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
  carteLegende.innerHTML =
    `<span class="pastille-legende vert"></span> aucun refus (${acceptes.length}) ` +
    `<span class="pastille-legende c1"></span> 1 ` +
    `<span class="pastille-legende c2"></span> 2 ` +
    `<span class="pastille-legende c3"></span> 3 ou plus`;

  const { repondants, participants } = etat.donnees;
  carteAide.textContent =
    `${repondants} personne(s) sur ${participants} se sont prononcées. ` +
    (acceptes.length === 0
      ? "Aucun département ne fait l'unanimité : les plus clairs restent les moins contestés."
      : "Les départements en vert ne sont refusés par personne.");
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
    pastille.innerHTML =
      personne.prenom +
      (personne.id === etat.moi.id ? " <span class='moi'>(toi)</span>" : "") +
      (personne.repondu ? "" : " <span class='vide'>•</span>");
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

function majBoutons() {
  const autres = etat.donnees.modifiables.filter((p) => p.id !== etat.cible.id);
  boutonEnregistrer.textContent = `Enregistrer pour ${etat.cible.prenom}`;
  boutonTous.hidden = autres.length === 0;
  boutonTous.textContent = `Appliquer à tous (${etat.donnees.modifiables.length})`;
  portee.textContent = autres.length
    ? `« Appliquer à tous » recopie cette carte sur ${autres
        .map((p) => p.prenom)
        .join(", ")} — les leurs sont remplacées.`
    : "";
}

document.getElementById("vues").addEventListener("click", (e) => {
  const bouton = e.target.closest(".pastille");
  if (!bouton) return;
  etat.vue = bouton.dataset.vue;
  for (const autre of e.currentTarget.children) {
    autre.classList.toggle("active", autre === bouton);
  }
  svg.classList.toggle("lecture", etat.vue !== "moi");
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
  const tous = etat.donnees.modifiables;
  const ecrases = tous.filter((p) => p.id !== etat.cible.id && p.repondu);
  let question = `Appliquer cette carte à ${tous.map((p) => p.prenom).join(", ")} ?`;
  if (ecrases.length) {
    question += `\n\nLes cartes de ${ecrases.map((p) => p.prenom).join(", ")} seront remplacées.`;
  }
  if (confirm(question)) enregistrer(tous);
});

document.getElementById("changer").addEventListener("click", () => {
  champPrenom.value = "";
  listeSuggestions.innerHTML = "";
  montrer("etape-prenom");
  champPrenom.focus();
});

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
}

if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
