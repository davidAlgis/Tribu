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
  INCONNU: "Cet élément n'existe plus. Recharge la page.",
  LIBELLE_VIDE: "Il manque l'intitulé du week-end.",
  DATES_INVERSEES: "La date de fin précède la date de début.",
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
  await rechargerDates();
  await rechargerLieux();
  await rechargerSauvegardes();
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

      const etiquettes = span("", "etiquettes");
      if (personne.categorie_age !== "adulte") {
        etiquettes.append(span(AGES[personne.categorie_age], "etiquette"));
      }
      if (personne.invite) etiquettes.append(span("invité", "etiquette"));
      if (personne.a_saisi) etiquettes.append(span("a saisi", "etiquette ok"));

      const gauche = document.createElement("div");
      gauche.append(
        fort(personne.prenom),
        etiquettes,
        span(decrireLien(personne), "lien")
      );

      gauche.appendChild(selecteurPortee(personne));

      const renommer = document.createElement("button");
      renommer.type = "button";
      renommer.className = "modifier";
      renommer.textContent = "✎";
      renommer.title = `Renommer ${personne.prenom}`;
      renommer.setAttribute("aria-label", `Renommer ${personne.prenom}`);
      renommer.addEventListener("click", () => editerPrenom(personne, gauche));

      const retirer = document.createElement("button");
      retirer.type = "button";
      retirer.className = "retirer";
      retirer.textContent = "✕";
      retirer.title = `Retirer ${personne.prenom}`;
      retirer.setAttribute("aria-label", `Retirer ${personne.prenom}`);
      retirer.addEventListener("click", () => demanderRetrait(personne));

      ligne.append(gauche, renommer, retirer);
      zoneListe.appendChild(ligne);
    }
  }
}

// ---------------------------------------------------------- renommer
//
// Une faute de frappe dans un prenom n'obligeait qu'a retirer la personne
// et a la recreer -- ce qui emportait ses presences et cassait les liens
// de parente autour d'elle. Le RPC existait ; il n'avait pas de bouton.

function editerPrenom(personne, zone) {
  const champ = document.createElement("input");
  champ.type = "text";
  champ.value = personne.prenom;
  champ.maxLength = 40;
  champ.setAttribute("aria-label", `Nouveau prénom pour ${personne.prenom}`);

  const valider = document.createElement("button");
  valider.type = "button";
  valider.textContent = "Renommer";

  const annuler = document.createElement("button");
  annuler.type = "button";
  annuler.className = "discret";
  annuler.textContent = "Annuler";

  const bloc = document.createElement("div");
  bloc.className = "renommage";
  bloc.append(champ, valider, annuler);

  // On remplace le contenu de la ligne plutot que d'ouvrir une boite :
  // le nom se corrige la ou il se lit.
  zone.replaceChildren(bloc);
  champ.focus();
  champ.select();

  annuler.addEventListener("click", dessinerListe);
  valider.addEventListener("click", () => renommer(personne, champ.value));
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter") renommer(personne, champ.value);
    if (e.key === "Escape") dessinerListe();
  });
}

async function renommer(personne, saisi) {
  const neuf = saisi.trim();
  if (!neuf || neuf === personne.prenom) return dessinerListe();

  message.className = "";
  message.textContent = "Renommage…";
  try {
    // `p_age: null` : la fonction garde la categorie d'age telle quelle.
    const r = await rpc("admin_modifier", {
      p_code: etat.code,
      p_id: personne.id,
      p_prenom: neuf,
      p_age: null,
    });
    const ancien = personne.prenom;
    await recharger();
    message.className = "ok";
    message.textContent =
      `« ${ancien} » devient « ${r.prenom} ».` +
      // `famille` porte le prenom du chef de branche : quand c'est lui
      // qu'on renomme, le libelle suit pour toute sa descendance.
      (r.branche ? ` La branche du même nom suit : ${r.branche} personne(s).` : "");
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = erreur.message;
    dessinerListe();
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


// ------------------------------------------------------- choix de la date
//
// L'organisateur propose les week-ends, la famille repond sur dates.html.
// Personne d'autre ne propose de date, sans quoi le sondage se diluerait.

const zoneDates = document.getElementById("liste-dates");
const compteurDates = document.getElementById("compteur-dates");
const messageDates = document.getElementById("message-dates");
const interrupteur = document.getElementById("voeux-ouverts");

function afficherJour(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

async function rechargerDates() {
  const donnees = await rpc("admin_dates_lister", { p_code: etat.code });
  interrupteur.checked = donnees.voeux_ouverts;
  compteurDates.textContent = donnees.options.length
    ? `${donnees.options.length} proposé(s)`
    : "aucun pour l'instant";

  zoneDates.innerHTML = "";
  for (const option of donnees.options) {
    const ligne = document.createElement("div");
    ligne.className = "personne";

    const periode =
      option.date_debut && option.date_fin
        ? `${afficherJour(option.date_debut)} → ${afficherJour(option.date_fin)}`
        : "sans dates";

    const etiquettes = span("", "etiquettes");
    etiquettes.append(
      span(`${option.oui} oui`, "etiquette ok"),
      span(`${option.non} non`, "etiquette")
    );

    const gauche = document.createElement("div");
    gauche.append(
      fort(option.libelle),
      etiquettes,
      span(`${periode} · ${option.oui} oui sur ${donnees.participants}`, "lien")
    );

    const retirer = document.createElement("button");
    retirer.type = "button";
    retirer.className = "retirer";
    retirer.textContent = "✕";
    retirer.setAttribute("aria-label", `Retirer ${option.libelle}`);
    retirer.addEventListener("click", async () => {
      const repondu = option.oui + option.non;
      const question =
        `Retirer « ${option.libelle} » ?` +
        (repondu ? `

${repondu} réponse(s) déjà données seront supprimées.` : "");
      if (!confirm(question)) return;
      try {
        await rpc("admin_date_retirer", { p_code: etat.code, p_id: option.id });
        await rechargerDates();
        messageDates.className = "ok";
        messageDates.textContent = `« ${option.libelle} » a été retiré.`;
      } catch (erreur) {
        messageDates.className = "erreur";
        messageDates.textContent = erreur.message;
      }
    });

    ligne.append(gauche, retirer);
    zoneDates.appendChild(ligne);
  }
}

document.getElementById("ajouter-date").addEventListener("click", async () => {
  const libelle = document.getElementById("date-libelle");
  const debut = document.getElementById("date-debut");
  const fin = document.getElementById("date-fin");

  messageDates.className = "";
  messageDates.textContent = "Ajout…";
  try {
    await rpc("admin_date_ajouter", {
      p_code: etat.code,
      p_libelle: libelle.value.trim(),
      p_debut: debut.value || null,
      p_fin: fin.value || null,
    });
    libelle.value = debut.value = fin.value = "";
    await rechargerDates();
    messageDates.className = "ok";
    messageDates.textContent = "Week-end proposé.";
  } catch (erreur) {
    messageDates.className = "erreur";
    messageDates.textContent = erreur.message;
  }
});

interrupteur.addEventListener("change", async () => {
  try {
    await rpc("admin_voeux_ouvrir", { p_code: etat.code, p_ouvert: interrupteur.checked });
    messageDates.className = "ok";
    messageDates.textContent = interrupteur.checked
      ? "Sondage ouvert."
      : "Sondage clos : la famille ne peut plus répondre.";
  } catch (erreur) {
    interrupteur.checked = !interrupteur.checked;
    messageDates.className = "erreur";
    messageDates.textContent = erreur.message;
  }
});


// ------------------------------------------------------------ le lieu
//
// La carte se peint sur lieux.html ; ici on ne montre que le resultat du
// croisement, et on ouvre ou ferme la saisie.

const zoneLieux = document.getElementById("classement-lieux");
const compteurLieux = document.getElementById("compteur-lieux");
const messageLieux = document.getElementById("message-lieux");
const interrupteurLieux = document.getElementById("lieux-ouverts");

async function rechargerLieux() {
  const d = await rpc("admin_lieux", { p_code: etat.code });
  interrupteurLieux.checked = d.lieux_ouverts;
  compteurLieux.textContent = `${d.repondants} réponse(s) sur ${d.participants}`;

  const totaux = d.totaux || {};
  const classes = (window.CARTE?.departements || [])
    .map((dep) => ({ ...dep, refus: totaux[dep.c] || 0 }))
    .sort((a, b) => a.refus - b.refus || a.n.localeCompare(b.n, "fr"));

  zoneLieux.innerHTML = "";
  if (!classes.length) {
    zoneLieux.innerHTML = '<p class="note">carte.js manque sur cette page.</p>';
    return;
  }

  const sansRefus = classes.filter((x) => x.refus === 0);
  // Quand tout le monde a une objection quelque part, il n'existe plus de
  // departement parfait : on montre alors les moins contestes, sans quoi la
  // page n'afficherait rien.
  const aMontrer = (sansRefus.length ? sansRefus : classes).slice(0, 12);

  const titre = document.createElement("p");
  titre.className = "note";
  titre.textContent = sansRefus.length
    ? `${sansRefus.length} département(s) ne sont refusés par personne :`
    : "Aucun département ne fait l'unanimité. Les moins contestés :";
  zoneLieux.appendChild(titre);

  const liste = document.createElement("div");
  liste.className = "pastilles";
  for (const dep of aMontrer) {
    const etiquette = document.createElement("span");
    etiquette.className = "pastille";
    etiquette.textContent = dep.refus
      ? `${dep.n} (${dep.refus} refus)`
      : dep.n;
    liste.appendChild(etiquette);
  }
  zoneLieux.appendChild(liste);
}

interrupteurLieux.addEventListener("change", async () => {
  try {
    await rpc("admin_lieux_ouvrir", {
      p_code: etat.code,
      p_ouvert: interrupteurLieux.checked,
    });
    messageLieux.className = "ok";
    messageLieux.textContent = interrupteurLieux.checked
      ? "Carte ouverte."
      : "Carte close : la famille ne peut plus la modifier.";
  } catch (erreur) {
    interrupteurLieux.checked = !interrupteurLieux.checked;
    messageLieux.className = "erreur";
    messageLieux.textContent = erreur.message;
  }
});


// ------------------------------------------------------ sauvegardes
//
// La base ne garde que l'etat courant : « Appliquer a tous », le retrait
// d'un participant et le reamorcage GEDCOM effacent sans retour. Une copie
// part donc a la premiere ecriture de chaque semaine, prise juste avant
// celle-ci (cf. schema.sql, section 11).
//
// La COMPARAISON se fait ici, et non en SQL. Deux raisons : la base sert
// des faits et laisse les derivees au reste du projet, et une fonction
// JavaScript se met sur un banc d'essai -- ce qu'une fonction PL/pgSQL ne
// fait pas sans une vraie base sous la main.

// Ce qui identifie une ligne, et ce qu'on ignore en comparant.
//
// La cle est NATURELLE, jamais l'`id`. Enregistrer une grille efface les
// lignes de la personne et les reecrit : chaque `id` change a chaque
// enregistrement, meme quand la reponse est identique au caractere pres.
// Comparer sur l'`id` signalerait donc tout comme « retire puis ajoute »,
// a chaque fois, et la comparaison ne dirait plus rien.
//
// `maj_le` part pour la meme raison : il bouge quand la valeur ne bouge pas.
const COMPARABLES = [
  {
    clef: "presences",
    nom: "Présences",
    cle: ["participant_id", "jour"],
    ignorer: ["id", "maj_le"],
  },
  {
    clef: "voeux",
    nom: "Dates",
    cle: ["participant_id", "option_id"],
    ignorer: ["id", "maj_le"],
  },
  {
    clef: "refus_lieu",
    nom: "Lieux",
    cle: ["participant_id", "departement"],
    ignorer: ["id", "maj_le"],
  },
];

const CHAMPS_PARTICIPANT = [
  "prenom",
  "famille",
  "categorie_age",
  "parent_id",
  "conjoint_id",
  "invite",
  "portee",
];
const CHAMPS_OPTION = ["libelle", "date_debut", "date_fin"];

// Les noms de colonnes ne sortent pas de la base : « categorie_age » ne
// veut rien dire pour qui lit la page.
const NOMS_CHAMPS = {
  prenom: "prénom",
  famille: "famille",
  categorie_age: "âge",
  parent_id: "rattachement",
  conjoint_id: "conjoint",
  invite: "invité",
  portee: "portée",
  libelle: "intitulé",
  date_debut: "date de début",
  date_fin: "date de fin",
};

function nommerChamps(champs) {
  return champs.map((c) => NOMS_CHAMPS[c] || c).join(", ");
}

// `null` cote base et `undefined` cote JSON disent la meme chose : absent.
function memeValeur(a, b) {
  const net = (x) => String(x === null || x === undefined ? "" : x);
  return net(a) === net(b);
}

function empreinte(ligne, cle) {
  // JSON.stringify plutot qu'un separateur : deux valeurs collees
  // bout a bout pourraient se confondre avec deux autres.
  return JSON.stringify(cle.map((c) => ligne[c]));
}

// Les cles triees, sinon deux lignes identiques dont les champs sont
// ranges autrement passeraient pour differentes.
function corpsDe(ligne, ignorer) {
  const garde = {};
  for (const c of Object.keys(ligne).sort()) {
    if (!ignorer.includes(c)) garde[c] = ligne[c];
  }
  return JSON.stringify(garde);
}

function indexer(lignes, def) {
  const index = new Map();
  for (const ligne of lignes || []) {
    index.set(empreinte(ligne, def.cle), { ligne, corps: corpsDe(ligne, def.ignorer) });
  }
  return index;
}

// Un decompte par personne, et seulement celles qui ont bouge : ce qui n'a
// pas change n'a pas besoin d'etre lu.
function comparerTable(avant, apres, def) {
  const a = indexer(avant, def);
  const b = indexer(apres, def);
  const gens = new Map();
  const voir = (pid) => {
    if (!gens.has(pid)) gens.set(pid, { pid, avant: 0, apres: 0, differe: false });
    return gens.get(pid);
  };

  for (const [k, v] of a) {
    const g = voir(v.ligne.participant_id);
    g.avant += 1;
    if (!b.has(k) || b.get(k).corps !== v.corps) g.differe = true;
  }
  for (const [k, v] of b) {
    const g = voir(v.ligne.participant_id);
    g.apres += 1;
    if (!a.has(k)) g.differe = true;
  }

  return {
    avant: a.size,
    apres: b.size,
    personnes: [...gens.values()].filter((g) => g.differe),
  };
}

// Participants et week-ends gardent leur `id` d'un bout a l'autre : eux,
// on les compare dessus.
function comparerParId(avant, apres, champs) {
  const a = new Map((avant || []).map((x) => [x.id, x]));
  const b = new Map((apres || []).map((x) => [x.id, x]));
  const ajoutes = [];
  const retires = [];
  const modifies = [];

  for (const [id, x] of b) if (!a.has(id)) ajoutes.push(x);
  for (const [id, x] of a) {
    if (!b.has(id)) {
      retires.push(x);
      continue;
    }
    const y = b.get(id);
    const changes = champs.filter((c) => !memeValeur(x[c], y[c]));
    if (changes.length) modifies.push({ avant: x, apres: y, champs: changes });
  }
  return { avant: a.size, apres: b.size, ajoutes, retires, modifies };
}

// Le resultat complet, sans rien du DOM : c'est cette fonction-la qui passe
// sur le banc d'essai.
function comparerEtats(avant, apres) {
  // Les prenoms des deux cotes : quelqu'un de retire depuis n'existe plus
  // que dans la copie, et il faut pouvoir le nommer quand meme.
  const noms = new Map();
  for (const p of avant.participants || []) noms.set(p.id, p.prenom);
  for (const p of apres.participants || []) noms.set(p.id, p.prenom);

  const participants = comparerParId(avant.participants, apres.participants, CHAMPS_PARTICIPANT);
  const options = comparerParId(avant.options_date, apres.options_date, CHAMPS_OPTION);

  const tables = COMPARABLES.map((def) => {
    const r = comparerTable(avant[def.clef], apres[def.clef], def);
    for (const g of r.personnes) g.prenom = noms.get(g.pid) || "(inconnu)";
    r.personnes.sort((x, y) => x.prenom.localeCompare(y.prenom, "fr"));
    return { clef: def.clef, nom: def.nom, ...r };
  });

  const bouge = (d) => d.ajoutes.length || d.retires.length || d.modifies.length;
  return {
    participants,
    options,
    tables,
    identique:
      !bouge(participants) && !bouge(options) && tables.every((t) => !t.personnes.length),
  };
}

// ---------------------------------------------------------- l'affichage

const zoneSauvegardes = document.getElementById("liste-sauvegardes");
const zoneComparaison = document.getElementById("comparaison");
const compteurSauvegardes = document.getElementById("compteur-sauvegardes");
const messageSauvegardes = document.getElementById("message-sauvegardes");

const MOTIFS = {
  hebdomadaire: "début de semaine",
  manuelle: "prise à la demande",
  avant_restauration: "prise avant une restauration",
};

function afficherInstant(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function rechargerSauvegardes() {
  const liste = await rpc("admin_sauvegardes_lister", { p_code: etat.code });
  compteurSauvegardes.textContent = liste.length
    ? `${liste.length} copie(s)`
    : "aucune copie";

  zoneSauvegardes.textContent = "";
  zoneComparaison.textContent = "";

  if (!liste.length) {
    const vide = document.createElement("p");
    vide.className = "note";
    vide.textContent =
      "Aucune copie pour l'instant. La première part toute seule, " +
      "à la première modification de la semaine.";
    zoneSauvegardes.appendChild(vide);
    return;
  }

  for (const copie of liste) {
    const c = copie.compteurs;
    const etiquettes = span("", "etiquettes");
    etiquettes.append(
      span(`${c.participants} personnes`, "etiquette"),
      span(`${c.presences} jours`, "etiquette"),
      span(`${c.voeux} réponses`, "etiquette"),
      span(`${c.refus_lieu} refus`, "etiquette")
    );

    const gauche = document.createElement("div");
    gauche.append(
      fort(afficherInstant(copie.prise_le)),
      etiquettes,
      span(MOTIFS[copie.motif] || copie.motif, "lien")
    );

    const boutonComparer = document.createElement("button");
    boutonComparer.type = "button";
    boutonComparer.className = "discret";
    boutonComparer.textContent = "Comparer";
    boutonComparer.addEventListener("click", () => montrerComparaison(copie));

    const boutonRestaurer = document.createElement("button");
    boutonRestaurer.type = "button";
    boutonRestaurer.className = "discret";
    boutonRestaurer.textContent = "Restaurer";
    boutonRestaurer.addEventListener("click", () => restaurer(copie));

    const ligne = document.createElement("div");
    ligne.className = "personne";
    ligne.append(gauche, boutonComparer, boutonRestaurer);
    zoneSauvegardes.appendChild(ligne);
  }
}

function sousTitre(texte) {
  const t = document.createElement("p");
  t.className = "titre-famille";
  t.textContent = texte;
  return t;
}

function ligneDiff(etiquette, texte) {
  const l = document.createElement("div");
  l.className = "diff";
  l.append(span(etiquette, "etiquette"), span(texte, "diff-texte"));
  return l;
}

function dessinerComparaison(copie, d) {
  zoneComparaison.textContent = "";

  const titre = document.createElement("p");
  titre.className = "note";
  titre.textContent = `Ce qui a changé depuis la copie du ${afficherInstant(copie.prise_le)}.`;
  zoneComparaison.appendChild(titre);

  if (d.identique) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = "Rien. La base est exactement dans l'état de cette copie.";
    zoneComparaison.appendChild(rien);
    return;
  }

  const p = d.participants;
  if (p.ajoutes.length || p.retires.length || p.modifies.length) {
    zoneComparaison.appendChild(sousTitre(`Participants : ${p.avant} → ${p.apres}`));
    for (const x of p.ajoutes) zoneComparaison.appendChild(ligneDiff("ajouté", x.prenom));
    for (const x of p.retires) zoneComparaison.appendChild(ligneDiff("retiré", x.prenom));
    for (const m of p.modifies) {
      zoneComparaison.appendChild(
        ligneDiff("modifié", `${m.avant.prenom} — ${nommerChamps(m.champs)}`)
      );
    }
  }

  const o = d.options;
  if (o.ajoutes.length || o.retires.length || o.modifies.length) {
    zoneComparaison.appendChild(sousTitre(`Week-ends proposés : ${o.avant} → ${o.apres}`));
    for (const x of o.ajoutes) zoneComparaison.appendChild(ligneDiff("ajouté", x.libelle));
    for (const x of o.retires) zoneComparaison.appendChild(ligneDiff("retiré", x.libelle));
    for (const m of o.modifies) {
      zoneComparaison.appendChild(
        ligneDiff("modifié", `${m.avant.libelle} — ${nommerChamps(m.champs)}`)
      );
    }
  }

  for (const t of d.tables) {
    if (!t.personnes.length) continue;
    zoneComparaison.appendChild(sousTitre(`${t.nom} : ${t.avant} → ${t.apres}`));
    for (const g of t.personnes) {
      // Le mot dit ce qui s'est passe ; les deux nombres disent combien.
      const quoi = g.avant === 0 ? "ajouté" : g.apres === 0 ? "effacé" : "modifié";
      zoneComparaison.appendChild(ligneDiff(quoi, `${g.prenom} — ${g.avant} → ${g.apres}`));
    }
  }
}

async function montrerComparaison(copie) {
  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Comparaison…";
  try {
    // L'etat courant est relu a chaque fois : comparer contre une version
    // chargee il y a dix minutes dirait le faux.
    const [avant, apres] = await Promise.all([
      rpc("admin_sauvegarde_lire", { p_code: etat.code, p_id: copie.id }),
      rpc("admin_etat", { p_code: etat.code }),
    ]);
    dessinerComparaison(copie, comparerEtats(avant, apres));
    messageSauvegardes.textContent = "";
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
}

async function restaurer(copie) {
  const c = copie.compteurs;
  const question =
    `Revenir à la copie du ${afficherInstant(copie.prise_le)} ?\n\n` +
    `Toute la base est remplacée : ${c.participants} participants, ` +
    `${c.presences} jours de présence, ${c.voeux} réponses de dates et ` +
    `${c.refus_lieu} refus de lieux reprennent leur état d'alors. Ce qui a ` +
    `été saisi depuis disparaît.\n\n` +
    `Une copie de l'état actuel est prise juste avant, pour que ce geste-ci ` +
    `soit lui aussi annulable.`;
  if (!confirm(question)) return;

  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Restauration…";
  try {
    const r = await rpc("admin_sauvegarde_restaurer", {
      p_code: etat.code,
      p_id: copie.id,
    });
    await recharger();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent =
      `Restauré : ${r.participants} participants, ${r.presences} jours, ` +
      `${r.voeux} réponses, ${r.refus_lieu} refus.`;
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
}

document.getElementById("sauver-maintenant").addEventListener("click", async () => {
  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Copie en cours…";
  try {
    await rpc("admin_sauvegarde_prendre", { p_code: etat.code });
    await rechargerSauvegardes();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent = "Copie prise.";
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
});
