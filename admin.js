"use strict";

// Page d'administration des participants.
//
// La base est la source de verite : le GEDCOM n'a servi qu'une fois, a
// l'amorcage. Tout ajout, tout retrait passe desormais par ici.
//
// Comme le formulaire familial, cette page ne touche aucune table : elle
// n'appelle que des fonctions SQL, qui exigent le code ORGANISATEUR. Il
// est distinct du code famille — saisir ses vacances et modifier la liste
// ne sont pas le meme pouvoir.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const AGES = { adulte: "adulte", enfant: "enfant", bebe: "bébé" };

// Les trois seuls rattachements possibles, et ce qu'ils impliquent.
const LIENS = {
  conjoint: {
    libelle: "conjoint·e de…",
    cible: true,
    explication:
      "Entre dans le foyer de son/sa partenaire. Les mêmes personnes " +
      "pourront gérer sa présence.",
  },
  enfant: {
    libelle: "enfant de…",
    cible: true,
    explication:
      "Son parent le gère, ainsi que les ascendants de son parent — " +
      "grands-parents compris.",
  },
  invite_de: {
    libelle: "invité·e de…",
    cible: true,
    explication:
      "Son hôte gère sa présence, comme s'il s'agissait de son enfant.",
  },
  independant: {
    libelle: "indépendant·e",
    cible: false,
    explication:
      "Personne d'autre ne peut modifier sa présence : il devra la saisir " +
      "lui-même avec le code famille.",
  },
};

const LIENS_PAR_TYPE = {
  famille: ["conjoint", "enfant"],
  invite: ["invite_de", "independant"],
};

// Ce que chacun a le droit de modifier. Par defaut l'arbre decide ; ces
// reglages servent quand il dit plus que la realite.
const PORTEES = {
  descendance: "toute sa descendance",
  foyer: "son conjoint",
  soi: "elle-même seulement",
};

const MESSAGES = {
  CODE_REFUSE: "Code organisateur incorrect.",
  PORTEE_INCONNUE: "Portée inconnue.",
  PRENOM_VIDE: "Il manque le prénom.",
  DEUX_LIENS: "Un seul rattachement à la fois.",
  RATTACHEMENT_INCONNU: "La personne de rattachement n'existe plus. Recharge la page.",
  CONJOINT_DEJA_PRIS: "Cette personne a déjà un conjoint enregistré.",
  INCONNU: "Cette personne n'existe plus. Recharge la page.",
  LISTE_VIDE: "La liste envoyée est vide.",
};

const etat = { code: "", participants: [], type: "famille" };

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

// ------------------------------------------------------------- etape 1

const champCode = document.getElementById("code");
const messageCode = document.getElementById("message-code");

document.getElementById("form-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  messageCode.className = "";
  messageCode.textContent = "Vérification…";
  try {
    etat.code = champCode.value.trim();
    await recharger();
    messageCode.textContent = "";
    montrer("etape-liste");
  } catch (erreur) {
    // Le code n'est volontairement pas memorise : cette page ouvre plus de
    // droits que le formulaire familial.
    etat.code = "";
    messageCode.className = "erreur";
    messageCode.textContent = erreur.message;
    champCode.select();
  }
});

// --------------------------------------------------------------- liste

const zoneListe = document.getElementById("liste");
const compteur = document.getElementById("compteur");
const message = document.getElementById("message");

async function recharger() {
  etat.participants = await rpc("admin_lister", { p_code: etat.code });
  dessinerListe();
  remplirSelecteurs();
}

function parId(id) {
  return etat.participants.find((p) => p.id === id);
}

function decrireLien(personne) {
  const conjoint = parId(personne.conjoint_id);
  if (conjoint) return `conjoint·e de ${conjoint.prenom}`;

  const parent = parId(personne.parent_id);
  if (parent) return `${personne.invite ? "invité·e" : "enfant"} de ${parent.prenom}`;

  return personne.invite ? "indépendant·e" : "—";
}

function dessinerListe() {
  zoneListe.innerHTML = "";
  compteur.textContent = `${etat.participants.length} personnes`;

  const familles = [...new Set(etat.participants.map((p) => p.famille))].sort();

  for (const famille of familles) {
    const titre = document.createElement("h3");
    titre.className = "titre-famille";
    titre.textContent = famille;
    zoneListe.appendChild(titre);

    for (const personne of etat.participants.filter((p) => p.famille === famille)) {
      const ligne = document.createElement("div");
      ligne.className = "personne";

      const gauche = document.createElement("div");
      gauche.innerHTML =
        `<strong>${personne.prenom}</strong>` +
        `<span class="etiquettes">` +
        (personne.categorie_age === "adulte"
          ? ""
          : `<span class="etiquette">${AGES[personne.categorie_age]}</span>`) +
        (personne.invite ? `<span class="etiquette">invité</span>` : "") +
        (personne.a_saisi ? `<span class="etiquette ok">a saisi</span>` : "") +
        `</span>` +
        `<span class="lien">${decrireLien(personne)}</span>`;

      gauche.appendChild(selecteurPortee(personne));

      const retirer = document.createElement("button");
      retirer.type = "button";
      retirer.className = "retirer";
      retirer.textContent = "✕";
      retirer.title = `Retirer ${personne.prenom}`;
      retirer.setAttribute("aria-label", `Retirer ${personne.prenom}`);
      retirer.addEventListener("click", () => demanderRetrait(personne));

      ligne.append(gauche, retirer);
      zoneListe.appendChild(ligne);
    }
  }
}

// Le nombre de personnes gerees accompagne le choix : « 16 » puis « 2 »
// rend le reglage concret, la ou le seul mot « foyer » ne dit rien.
function selecteurPortee(personne) {
  const bloc = document.createElement("div");
  bloc.className = "portee";

  const etiquette = document.createElement("span");
  etiquette.textContent = "gère";

  const choix = document.createElement("select");
  for (const [valeur, libelle] of Object.entries(PORTEES)) {
    choix.add(new Option(libelle, valeur));
  }
  choix.value = personne.portee;

  const compte = document.createElement("span");
  compte.className = "compte";
  compte.textContent = `${personne.nb_geres} pers.`;

  choix.addEventListener("change", async () => {
    const avant = personne.portee;
    choix.disabled = true;
    message.className = "";
    message.textContent = "Mise à jour…";
    try {
      await rpc("admin_portee", {
        p_code: etat.code,
        p_id: personne.id,
        p_portee: choix.value,
      });
      // Restreindre une personne change le decompte des autres : on
      // recharge tout plutot que de le recalculer dans le navigateur.
      await recharger();
      message.className = "ok";
      message.textContent = `${personne.prenom} gère désormais ${PORTEES[choix.value]}.`;
    } catch (erreur) {
      choix.value = avant;
      choix.disabled = false;
      message.className = "erreur";
      message.textContent = erreur.message;
    }
  });

  bloc.append(etiquette, choix, compte);
  return bloc;
}


async function demanderRetrait(personne) {
  const enfants = etat.participants.filter((p) => p.parent_id === personne.id);
  let question = `Retirer ${personne.prenom} ?`;
  if (personne.a_saisi) question += "\n\nSa saisie de présences sera supprimée.";
  if (enfants.length) {
    const repreneur = parId(personne.conjoint_id) || parId(personne.parent_id);
    question +=
      `\n\n${enfants.map((e) => e.prenom).join(", ")} ` +
      (repreneur ? `sera/seront repris par ${repreneur.prenom}.` : "n'aura/auront plus de parent.");
  }
  if (!confirm(question)) return;

  message.className = "";
  message.textContent = "Suppression…";
  try {
    await rpc("admin_retirer", { p_code: etat.code, p_id: personne.id });
    await recharger();
    message.className = "ok";
    message.textContent = `${personne.prenom} a été retiré·e.`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
  }
}

// --------------------------------------------------------------- ajout

const boutonsType = document.getElementById("type-personne");
const selectLien = document.getElementById("lien");
const selectCible = document.getElementById("cible");
const blocCible = document.getElementById("bloc-cible");
const explication = document.getElementById("explication-lien");

boutonsType.addEventListener("click", (e) => {
  const bouton = e.target.closest(".pastille");
  if (!bouton) return;
  etat.type = bouton.dataset.type;
  for (const autre of boutonsType.children) {
    autre.classList.toggle("active", autre === bouton);
  }
  remplirSelecteurs();
});

selectLien.addEventListener("change", majExplication);

function remplirSelecteurs() {
  const liens = LIENS_PAR_TYPE[etat.type];
  const choisi = liens.includes(selectLien.value) ? selectLien.value : liens[0];

  selectLien.innerHTML = "";
  for (const cle of liens) selectLien.add(new Option(LIENS[cle].libelle, cle));
  selectLien.value = choisi;

  const precedent = selectCible.value;
  selectCible.innerHTML = "";
  for (const personne of [...etat.participants].sort((a, b) =>
    a.prenom.localeCompare(b.prenom, "fr")
  )) {
    selectCible.add(new Option(`${personne.prenom} — ${personne.famille}`, personne.id));
  }
  if (precedent) selectCible.value = precedent;

  majExplication();
}

function majExplication() {
  const lien = LIENS[selectLien.value];
  blocCible.hidden = !lien.cible;
  explication.textContent = lien.explication;
}

document.getElementById("ajouter").addEventListener("click", async () => {
  const champPrenom = document.getElementById("prenom");
  const prenom = champPrenom.value.trim();
  if (!prenom) {
    message.className = "erreur";
    message.textContent = MESSAGES.PRENOM_VIDE;
    champPrenom.focus();
    return;
  }

  const lien = selectLien.value;
  const cible = LIENS[lien].cible ? selectCible.value : null;

  message.className = "";
  message.textContent = "Ajout…";
  try {
    await rpc("admin_ajouter", {
      p_code: etat.code,
      p_prenom: prenom,
      p_age: document.getElementById("age").value,
      p_conjoint_de: lien === "conjoint" ? cible : null,
      // Un invité rattaché passe par le même lien qu'un enfant : c'est ce
      // lien qui dit « cette personne est gérée par celle-là ».
      p_enfant_de: lien === "enfant" || lien === "invite_de" ? cible : null,
      p_invite: etat.type === "invite",
      p_famille: null,
    });

    champPrenom.value = "";
    champPrenom.focus();
    await recharger();
    message.className = "ok";
    message.textContent = `${prenom} a été ajouté·e.`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
  }
});

// ------------------------------------------------------------ affichage

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
}
