"use strict";

// Sondage sur la date du sejour, en amont du formulaire de presences.
//
// Meme modele d'identite et de droits que celui-ci : code famille, prenom,
// et l'on repond pour les personnes qu'on gere. Rien de nouveau a
// expliquer a la famille, et aucune table n'est touchee directement.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

// Trois reponses, et non deux : « si besoin » est ce qui departage deux
// week-ends quand personne n'a de disponibilite parfaite.
const CHOIX = [
  ["oui", "Oui"],
  ["peut_etre", "Si besoin"],
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
const legende = document.getElementById("legende-voeux");
const message = document.getElementById("message");
const boutonEnregistrer = document.getElementById("enregistrer");
const boutonTous = document.getElementById("appliquer-tous");
const portee = document.getElementById("portee-saisie");

function construire() {
  const { options, modifiables, voeux_ouverts } = etat.donnees;

  if (options.length === 0) {
    document.getElementById("sous-titre").textContent =
      "Aucun week-end n'est encore proposé. Reviens plus tard.";
    legende.textContent = "Rien à choisir pour l'instant";
    boutonEnregistrer.disabled = true;
    return;
  }

  construireOptions(options);

  zonePersonnes.innerHTML = "";
  for (const personne of modifiables) {
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
    titre.innerHTML =
      `<strong>${option.libelle}</strong>` +
      (periode ? `<span class="lien">${periode}</span>` : "") +
      `<span class="lien">${option.oui} oui · ${option.peut_etre} si besoin · ${option.non} non</span>`;

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

function majBoutons() {
  const autres = etat.donnees.modifiables.filter((p) => p.id !== etat.cible.id);
  boutonEnregistrer.textContent = `Enregistrer pour ${etat.cible.prenom}`;
  boutonTous.hidden = autres.length === 0;
  boutonTous.textContent = `Appliquer à tous (${etat.donnees.modifiables.length})`;
  portee.textContent = autres.length
    ? `« Appliquer à tous » recopie ces réponses sur ${autres
        .map((p) => p.prenom)
        .join(", ")} — les leurs sont remplacées.`
    : "";
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
  const tous = etat.donnees.modifiables;
  const ecrases = tous.filter((p) => p.id !== etat.cible.id && p.repondu);

  let question = `Appliquer ces réponses à ${tous.map((p) => p.prenom).join(", ")} ?`;
  if (ecrases.length) {
    question += `\n\nLes réponses de ${ecrases.map((p) => p.prenom).join(", ")} seront remplacées.`;
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
