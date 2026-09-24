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
  DATES_MANQUANTES: "Il manque une des deux dates du séjour.",
  REGLAGES_ABSENTS: "Les réglages du séjour sont absents de la base.",
  CATEGORIE_INCONNUE: "Type de couchage inconnu.",
  CAPACITE_INVALIDE: "La capacité doit être un nombre entre 1 et 30.",
  NOMBRE_INVALIDE: "Le nombre de logements doit être entre 1 et 200.",
  VUE_MER_HORS_CHAMBRE: "La vue mer ne concerne que les chambres.",
  LOGEMENT_EXISTANT: "Ce type est déjà dans l'inventaire : corrige plutôt sa ligne.",
  UNITE_INCONNUE: "Ce couchage n'existe plus. Recharge la page.",
  PAS_SUR_PLACE: "Cette personne n'a pas déclaré dormir sur place cette nuit-là.",
};

const etat = {
  code: "",
  participants: [],
  type: "famille",
  logements: [],
  nuits: [],
  plan: { jour: null, nuits: [], unites: [], dormeurs: [] },
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
  await rechargerSejour();
  await rechargerLogements();
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

// `conjoint_id` est pose des DEUX cotes par `admin_ajouter` -- mais le
// schema lui-meme prevoit qu'il ne le soit que d'un (section 5 en tient
// compte pour les droits). On regarde donc dans les deux sens : autrement,
// la moitie d'un couple parait celibataire, et c'est justement celle-la
// qu'on cherchait a nommer.
function conjointDe(personne) {
  return (
    parId(personne.conjoint_id) ||
    etat.participants.find((p) => p.conjoint_id === personne.id)
  );
}

// « enfant de Alice » fait buter la lecture. L'elision n'est pas un detail
// de style ici : la precision n'existe que pour etre lue d'un coup d'oeil.
// Tout h initial est traite comme muet. Les quelques prenoms a h aspire,
// ou l'elision serait fautive, sont assez rares pour qu'on l'assume.
function de(prenom) {
  return /^[aeiouyàâäéèêëîïôöùûüh]/i.test(prenom) ? `d'${prenom}` : `de ${prenom}`;
}

function decrireLien(personne) {
  const conjoint = conjointDe(personne);
  if (conjoint) return `conjoint·e ${de(conjoint.prenom)}`;

  const parent = parId(personne.parent_id);
  if (parent) return `${personne.invite ? "invité·e" : "enfant"} ${de(parent.prenom)}`;

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

// ------------------------------------------------------------- onglets
//
// Six sujets sans rapport se suivaient dans une seule colonne : pour ouvrir
// la carte, il fallait passer devant la liste entiere des participants.
//
// L'etat n'est ecrit qu'a UN endroit, l'`aria-selected` du bouton : le style
// s'y accroche, le lecteur d'ecran le lit, et il n'y a rien a synchroniser.
//
// Le `tabindex` roulant est la moitie du motif qu'on oublie. Sans lui, la
// tabulation traverse les six boutons avant d'atteindre le contenu ; avec
// lui, un seul onglet est atteignable et les fleches passent de l'un a
// l'autre, comme dans n'importe quelle barre d'onglets.

// La requete est ancree sur `.onglets` : une autre rangee de boutons
// ailleurs dans la page ne doit pas se retrouver pilotee d'ici.
const onglets = [...document.querySelectorAll('.onglets [role="tab"]')];

function ouvrirOnglet(onglet) {
  for (const o of onglets) {
    const actif = o === onglet;
    o.setAttribute("aria-selected", actif ? "true" : "false");
    o.tabIndex = actif ? 0 : -1;
    document.getElementById(o.getAttribute("aria-controls")).hidden = !actif;
  }
}

onglets.forEach((onglet, i) => {
  onglet.addEventListener("click", () => ouvrirOnglet(onglet));
  onglet.addEventListener("keydown", (e) => {
    const pas = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    let cible = null;
    if (pas) cible = onglets[(i + pas + onglets.length) % onglets.length];
    else if (e.key === "Home") cible = onglets[0];
    else if (e.key === "End") cible = onglets[onglets.length - 1];
    if (!cible) return;
    e.preventDefault();
    ouvrirOnglet(cible);
    cible.focus();
  });
});


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


// ------------------------------------------------------ les logements
//
// Un inventaire, et rien de plus : combien de chambres de deux, combien de
// gites de six. Pas de plan de couchage -- « qui dort avec qui » est une
// autre question, et la melanger a celle-ci ferait de la saisie d'un nombre
// une reunion de famille.
//
// L'offre seule ne dit rien. Le second panneau la confronte a la demande,
// nuit par nuit : c'est l'ecart qui interesse, pas le total.
//
// Rien n'est ecrit en dur. Une autre annee, un autre lieu : on retape
// l'inventaire, et le reste suit -- comme les dates du sejour, sorties de
// l'editeur SQL pour la meme raison.

// Meme vocabulaire que la grille de saisie (`app.js`) : la vue mer est une
// VARIANTE DE CHAMBRE, pas une option a cote. La base, elle, garde deux
// champs -- une categorie et un supplement -- parce que c'est ainsi que
// l'hotel facture.
const CHAMBRE_VUE_MER = "chambre+vue_mer";

const TYPES_LOGEMENT = {
  chambre: { categorie: "chambre", vue_mer: false, un: "chambre", plusieurs: "chambres" },
  [CHAMBRE_VUE_MER]: {
    categorie: "chambre",
    vue_mer: true,
    un: "chambre vue mer",
    plusieurs: "chambres vue mer",
  },
  gite: { categorie: "gite", vue_mer: false, un: "gîte", plusieurs: "gîtes" },
};

// Deux champs en base, une seule valeur dans l'interface. La conversion tient
// en une ligne, mais elle doit repondre exactement a l'index unique
// `(categorie, capacite, vue_mer)` : c'est lui qui decide si reposer un type
// le corrige ou en ajoute un second.
function typeDe(ligne) {
  return ligne.categorie === "chambre" && ligne.vue_mer ? CHAMBRE_VUE_MER : ligne.categorie;
}

function nommerLogement(ligne) {
  const t = TYPES_LOGEMENT[typeDe(ligne)] || { un: ligne.categorie, plusieurs: ligne.categorie };
  const quoi = ligne.nombre > 1 ? t.plusieurs : t.un;
  const gens = ligne.capacite > 1 ? "personnes" : "personne";
  return `${ligne.nombre} ${quoi} de ${ligne.capacite} ${gens}`;
}

// Ce que l'inventaire offre, par type d'interface.
function placesParType(logements) {
  const total = { chambre: 0, [CHAMBRE_VUE_MER]: 0, gite: 0 };
  for (const l of logements || []) total[typeDe(l)] += l.capacite * l.nombre;
  return total;
}

const zoneLogements = document.getElementById("liste-logements");
const zoneTension = document.getElementById("tension-logements");
const compteurLogements = document.getElementById("compteur-logements");
const compteurTension = document.getElementById("compteur-tension");
const messageLogements = document.getElementById("message-logements");

async function rechargerLogements() {
  const d = await rpc("admin_logements", { p_code: etat.code });
  etat.logements = d.logements || [];
  etat.nuits = d.nuits || [];
  dessinerLogements();
  dessinerTension();
  // Le plan depend de l'inventaire : retirer un type ou baisser son nombre
  // change les rectangles sous les jetons. On garde la nuit regardee.
  await rechargerPlan(etat.plan.jour);
}

function dessinerLogements() {
  const offre = placesParType(etat.logements);
  const total = offre.chambre + offre[CHAMBRE_VUE_MER] + offre.gite;
  compteurLogements.textContent = etat.logements.length
    ? `${total} place(s) au total`
    : "rien de déclaré";

  zoneLogements.textContent = "";
  if (!etat.logements.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent =
      "Aucun type posé. Tant que l'inventaire est vide, le panneau d'à côté " +
      "n'a rien à comparer.";
    zoneLogements.appendChild(rien);
    return;
  }

  for (const l of etat.logements) {
    const ligne = document.createElement("div");
    ligne.className = "personne";

    const gauche = document.createElement("div");
    gauche.append(fort(nommerLogement(l)), span(`${l.capacite * l.nombre} places`, "lien"));

    const modifier = document.createElement("button");
    modifier.type = "button";
    modifier.className = "modifier";
    modifier.textContent = "✎";
    modifier.title = `Corriger ${nommerLogement(l)}`;
    modifier.setAttribute("aria-label", `Corriger ${nommerLogement(l)}`);
    modifier.addEventListener("click", () => editerLogement(l, ligne));

    const retirer = document.createElement("button");
    retirer.type = "button";
    retirer.className = "retirer";
    retirer.textContent = "✕";
    retirer.title = `Retirer ${nommerLogement(l)} de l'inventaire`;
    retirer.setAttribute("aria-label", `Retirer ${nommerLogement(l)} de l'inventaire`);
    retirer.addEventListener("click", () => retirerLogement(l));

    ligne.append(gauche, pasAPas(l), modifier, retirer);
    zoneLogements.appendChild(ligne);
  }
}

// Un de plus, un de moins. C'est le geste le plus frequent -- on compte les
// chambres en les parcourant -- et il ne merite pas d'ouvrir un formulaire.
//
// Le nombre affiche entre les deux boutons n'est pas un champ : un champ
// libre poserait la question de savoir quand il s'enregistre. Ici chaque
// clic est un enregistrement, et la ligne entiere se reprend au crayon.
function pasAPas(l) {
  const bloc = document.createElement("div");
  bloc.className = "pas-a-pas";
  const un = TYPES_LOGEMENT[typeDe(l)].un;

  const moins = document.createElement("button");
  moins.type = "button";
  moins.className = "pas";
  moins.textContent = "−";
  moins.title = `Une ${un} de ${l.capacite} de moins`;
  moins.setAttribute("aria-label", moins.title);
  moins.addEventListener("click", () => changerNombre(l, l.nombre - 1));

  const valeur = span(String(l.nombre), "valeur");
  valeur.setAttribute("aria-live", "polite");

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "pas";
  plus.textContent = "+";
  plus.title = `Une ${un} de ${l.capacite} de plus`;
  plus.setAttribute("aria-label", plus.title);
  plus.addEventListener("click", () => changerNombre(l, l.nombre + 1));

  bloc.append(moins, valeur, plus);
  return bloc;
}

// Descendre sous un, c'est retirer le dernier -- donc le type. On ne grise
// pas le bouton pour autant : « en enlever un » reste ce qu'on a voulu
// faire, et la confirmation dit ou cela mene.
function changerNombre(l, nombre) {
  if (nombre < 1) return retirerLogement(l);
  return modifierLogement(l, { ...l, nombre });
}

// ---------------------------------------------------------- corriger
//
// Une capacite mal tapee obligeait a retirer la ligne et a la reposer. Le
// type, la capacite et le nombre se reprennent maintenant d'un coup, la ou
// ils se lisent -- comme le prenom d'une personne.

function editerLogement(l, zone) {
  const choix = document.createElement("select");
  for (const [valeur, t] of Object.entries(TYPES_LOGEMENT)) {
    const option = document.createElement("option");
    option.value = valeur;
    option.textContent = t.un.charAt(0).toUpperCase() + t.un.slice(1);
    choix.appendChild(option);
  }
  choix.value = typeDe(l);
  choix.setAttribute("aria-label", "Type de couchage");

  const nombrePour = (valeur, min, max, etiquette) => {
    const champ = document.createElement("input");
    champ.type = "number";
    champ.min = min;
    champ.max = max;
    champ.step = 1;
    champ.value = valeur;
    champ.setAttribute("aria-label", etiquette);
    return champ;
  };
  const capacite = nombrePour(l.capacite, 1, 30, "Pour combien de personnes");
  const nombre = nombrePour(l.nombre, 1, 200, "Combien de logements de ce type");

  const valider = document.createElement("button");
  valider.type = "button";
  valider.textContent = "Corriger";

  const annuler = document.createElement("button");
  annuler.type = "button";
  annuler.className = "discret";
  annuler.textContent = "Annuler";

  const bloc = document.createElement("div");
  bloc.className = "renommage";
  bloc.append(choix, capacite, nombre, valider, annuler);

  // On remplace la LIGNE ENTIERE, et non son seul libelle : le pas a pas et
  // la croix agiraient encore sur les anciennes valeurs, a cote de champs
  // qui en montrent de nouvelles. Deux verites pour une meme ligne.
  zone.replaceChildren(bloc);
  choix.focus();

  const saisie = () => ({
    ...TYPES_LOGEMENT[choix.value],
    id: l.id,
    capacite: Number(capacite.value),
    nombre: Number(nombre.value),
  });

  annuler.addEventListener("click", dessinerLogements);
  valider.addEventListener("click", () => modifierLogement(l, saisie()));
  for (const champ of [choix, capacite, nombre]) {
    champ.addEventListener("keydown", (e) => {
      if (e.key === "Enter") modifierLogement(l, saisie());
      if (e.key === "Escape") dessinerLogements();
    });
  }
}

async function modifierLogement(avant, apres) {
  messageLogements.className = "";
  messageLogements.textContent = "Enregistrement…";
  try {
    await rpc("admin_logement_modifier", {
      p_code: etat.code,
      p_id: avant.id,
      p_categorie: apres.categorie,
      p_capacite: apres.capacite,
      p_nombre: apres.nombre,
      p_vue_mer: apres.vue_mer,
    });
    await rechargerLogements();
    messageLogements.className = "ok";
    messageLogements.textContent =
      `${nommerLogement(avant)} → ${nommerLogement(apres)}.`;
  } catch (erreur) {
    messageLogements.className = "erreur";
    messageLogements.textContent = erreur.message;
    // Le serveur a refuse : la ligne doit revenir a ce que la base contient,
    // sans quoi l'ecran montrerait une correction qui n'a pas eu lieu.
    dessinerLogements();
  }
}

const COLONNES_TENSION = [
  ["chambre", "Chambre"],
  [CHAMBRE_VUE_MER, "Vue mer"],
  ["gite", "Gîte"],
];

// La base renvoie `chambre` et `chambre_vue_mer` separement -- exactement les
// deux types que l'inventaire distingue. Les confondre ici ferait passer pour
// disponible une chambre vue mer que personne n'a.
function demandeDe(nuit, type) {
  return (type === CHAMBRE_VUE_MER ? nuit.chambre_vue_mer : nuit[type]) || 0;
}

function celluleTension(demande, offre) {
  const c = document.createElement("td");
  c.textContent = `${demande} / ${offre}`;
  // Un depassement n'est pas une erreur de saisie : c'est un fait dont
  // l'organisateur doit decider. La cellule le montre, la page ne l'empeche
  // pas -- et le titre le dit pour qui ne voit pas la couleur.
  if (demande > offre) {
    c.className = "trop";
    c.title = `${demande - offre} de plus que ce qui existe`;
  }
  return c;
}

function dessinerTension() {
  const offre = placesParType(etat.logements);
  zoneTension.textContent = "";

  if (!etat.nuits.length) {
    compteurTension.textContent = "";
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = "Personne n'a encore déclaré de nuit sur place.";
    zoneTension.appendChild(rien);
    return;
  }

  const cadre = document.createElement("div");
  cadre.className = "defilement";
  const table = document.createElement("table");

  const tete = document.createElement("tr");
  tete.appendChild(document.createElement("th")).textContent = "Nuit du";
  for (const [, titre] of COLONNES_TENSION) {
    tete.appendChild(document.createElement("th")).textContent = titre;
  }
  const thead = document.createElement("thead");
  thead.appendChild(tete);
  table.appendChild(thead);

  const corps = document.createElement("tbody");
  let depassements = 0;
  for (const nuit of etat.nuits) {
    const ligne = document.createElement("tr");
    ligne.appendChild(document.createElement("td")).textContent = afficherJour(nuit.jour);
    let serree = false;
    for (const [type] of COLONNES_TENSION) {
      const demande = demandeDe(nuit, type);
      if (demande > offre[type]) serree = true;
      ligne.appendChild(celluleTension(demande, offre[type]));
    }
    if (serree) depassements += 1;
    corps.appendChild(ligne);
  }
  table.appendChild(corps);
  cadre.appendChild(table);
  zoneTension.appendChild(cadre);

  compteurTension.textContent = depassements
    ? `${depassements} nuit(s) au-delà de l'inventaire`
    : "tout tient";
}

document.getElementById("logement-poser").addEventListener("click", async () => {
  const choisi = document.getElementById("logement-categorie").value;
  const type = TYPES_LOGEMENT[choisi];
  const capacite = Number(document.getElementById("logement-capacite").value);
  const nombre = Number(document.getElementById("logement-nombre").value);

  messageLogements.className = "";
  messageLogements.textContent = "Enregistrement…";
  try {
    // La conversion se fait ici et nulle part ailleurs : l'interface parle de
    // « chambre vue mer », la base de deux colonnes.
    await rpc("admin_logement_poser", {
      p_code: etat.code,
      p_categorie: type.categorie,
      p_capacite: capacite,
      p_nombre: nombre,
      p_vue_mer: type.vue_mer,
    });
    await rechargerLogements();
    messageLogements.className = "ok";
    messageLogements.textContent = `${nommerLogement({
      categorie: type.categorie,
      vue_mer: type.vue_mer,
      capacite,
      nombre,
    })} : enregistré.`;
  } catch (erreur) {
    messageLogements.className = "erreur";
    messageLogements.textContent = erreur.message;
  }
});

async function retirerLogement(ligne) {
  // Rien ne pointe vers un logement : les presences disent une categorie, pas
  // une unite. Retirer un type ne casse donc aucune saisie -- il change
  // seulement ce que le panneau d'a cote compte comme places disponibles.
  if (!confirm(`Retirer ${nommerLogement(ligne)} de l'inventaire ?`)) return;

  messageLogements.className = "";
  messageLogements.textContent = "Suppression…";
  try {
    await rpc("admin_logement_retirer", { p_code: etat.code, p_id: ligne.id });
    await rechargerLogements();
    messageLogements.className = "ok";
    messageLogements.textContent = `${nommerLogement(ligne)} : retiré.`;
  } catch (erreur) {
    messageLogements.className = "erreur";
    messageLogements.textContent = erreur.message;
  }
}


// ---------------------------------------------------- plan de couchage
//
// L'inventaire dit COMBIEN de couchages ; ce panneau dit QUI est dans
// lequel. Un rectangle par unite, un jeton par personne, et l'on deplace
// les seconds entre les premiers.
//
// UNE NUIT A LA FOIS. Le plan change d'un soir a l'autre -- c'est tout
// l'interet -- mais huit tableaux cote a cote ne se lisent pas. Le bouton
// « reporter » rend ensuite le cas courant, « la meme chose toute la
// semaine », aussi court qu'une affectation unique.
//
// DEUX FACONS DE DEPLACER, et non une. Le glisser-deposer du navigateur
// ne repond pas au doigt et pas au clavier ; un jeton qu'on saisit d'un
// clic et qu'on pose d'un autre repond aux trois. Les deux chemins
// aboutissent a `placer()`, qui est le seul a ecrire.

const zonePlan = document.getElementById("plan");
const zoneNuits = document.getElementById("choix-nuit");
const compteurCouchages = document.getElementById("compteur-couchages");
const messageCouchages = document.getElementById("message-couchages");

// `null` = personne de saisi. C'est le seul etat que ce panneau garde pour
// lui : tout le reste vient de la base a chaque rechargement.
let saisi = null;

const TAS = "tas"; // l'unite qui n'en est pas une : ceux qui restent a placer

// Ce qu'un jeton met dans le presse-papiers du glisser-deposer.
//
// Un type A NOUS, et surtout PAS `text/plain`. Avec du texte ordinaire, un
// depose qui rate la boite -- l'espace entre deux rectangles suffit --
// n'est plus notre affaire : le navigateur reprend la main et fait ce
// qu'il fait de tout texte lache sur une page, c'est-a-dire l'ouvrir dans
// un onglet et le chercher sur Google. Avec un type inconnu de lui, il n'a
// rien a en faire.
const TYPE_JETON = "application/x-tribu-jeton";

function cleUnite(logementId, numero) {
  return `${logementId}#${numero}`;
}

// « Chambre 3 », « Gîte 1 ». Le rang vient de la position dans la liste, et
// se compte PAR CATEGORIE : deux lignes d'inventaire de chambres donnent
// une seule suite de chambres, sans quoi la page afficherait deux
// « Chambre 1 ».
function nommerUnites(unites) {
  const rangs = {};
  return unites.map((u) => {
    rangs[u.categorie] = (rangs[u.categorie] || 0) + 1;
    // Le rang se compte par CATEGORIE, pas par type d'interface : une
    // chambre vue mer reste une chambre, et elle prend son tour dans la
    // meme suite. Le supplement se dit apres le numero -- « Chambre 7
    // (vue mer) » se lit, « Chambre vue mer 7 » se dechiffre.
    const t = TYPES_LOGEMENT[u.categorie] || { un: u.categorie };
    const base = `${t.un.charAt(0).toUpperCase()}${t.un.slice(1)}`;
    return {
      ...u,
      cle: cleUnite(u.logement_id, u.numero),
      nom: `${base} ${rangs[u.categorie]}${u.vue_mer ? " (vue mer)" : ""}`,
    };
  });
}

// Soixante personnes, quelques prenoms portes deux fois : « Marie » sur un
// jeton ne designe alors personne. On precise -- mais SEULEMENT pour les
// prenoms qui reviennent, sinon chaque rectangle porterait une phrase la ou
// un mot suffit.
//
// L'ambiguite se juge sur la FAMILLE ENTIERE, et non sur les dormeurs du
// soir : une personne qui changerait d'etiquette d'une nuit a l'autre --
// precisee mardi, nue mercredi parce que son homonyme est reparti -- serait
// plus deroutante que deux jetons identiques.
function prenomsPortesPlusieursFois() {
  const comptes = new Map();
  for (const p of etat.participants) {
    comptes.set(p.prenom, (comptes.get(p.prenom) || 0) + 1);
  }
  return new Set([...comptes].filter(([, n]) => n > 1).map(([nom]) => nom));
}

// Le plus court qui suffise a trancher, dans cet ordre : le conjoint, puis
// le parent, puis la branche. `admin_couchages` ne renvoie pas les liens de
// parente -- c'est `admin_lister` qui les porte -- d'ou la jointure par
// identifiant.
function preciser(id) {
  const personne = parId(id);
  if (!personne) return "";

  const conjoint = conjointDe(personne);
  if (conjoint) return `conjoint ${de(conjoint.prenom)}`;

  const parent = parId(personne.parent_id);
  if (parent) return `${personne.invite ? "invité" : "enfant"} ${de(parent.prenom)}`;

  // Reste les tetes de branche, que rien ne rattache. `famille` porte le
  // prenom du chef de branche : il ne dit rien quand c'est le sien.
  if (personne.famille && personne.famille !== personne.prenom) {
    return `branche ${personne.famille}`;
  }
  return "";
}

let ambigus = new Set();

async function rechargerPlan(jour) {
  const d = await rpc("admin_couchages", { p_code: etat.code, p_jour: jour || null });
  etat.plan = { ...d, unites: nommerUnites(d.unites || []) };
  saisi = null;
  dessinerNuits();
  dessinerPlan();
}

function dessinerNuits() {
  const { nuits, jour } = etat.plan;
  zoneNuits.textContent = "";
  for (const n of nuits || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nuit";
    b.setAttribute("aria-pressed", n.jour === jour ? "true" : "false");
    b.append(span(afficherJour(n.jour), "jour"), span(`${n.dormeurs}`, "combien"));
    b.title = `${n.dormeurs} personne(s) dorment sur place la nuit du ${afficherJour(n.jour)}`;
    b.addEventListener("click", () => changerNuit(n.jour));
    zoneNuits.appendChild(b);
  }
}

async function changerNuit(jour) {
  messageCouchages.className = "";
  messageCouchages.textContent = "";
  try {
    await rechargerPlan(jour);
  } catch (erreur) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = erreur.message;
  }
}

// Le jeton d'une personne. C'est un vrai bouton : il prend le focus, il
// s'active a la barre d'espace, et un lecteur d'ecran l'annonce -- ce
// qu'un <div draggable> ne fait pas.
function jeton(personne, dansUneUnite) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "jeton";
  b.draggable = true;
  b.dataset.personne = personne.id;
  b.append(span(personne.prenom, "nom"));

  // Le detail qui tranche entre deux homonymes. Il ne parait que si le
  // prenom revient ; l'infobulle, elle, le donne toujours -- elle a la
  // place, et le survol est le bon endroit pour ce qu'on ne lit qu'en cas
  // de doute.
  const precision = preciser(personne.id);
  if (precision && ambigus.has(personne.prenom)) {
    b.append(span(`(${precision})`, "precision"));
  }

  if (personne.categorie_age !== "adulte") {
    b.append(span(AGES[personne.categorie_age], "etiquette"));
  }

  // Ce que la personne a demande dans sa grille. On ne l'impose pas -- c'est
  // l'organisateur qui arbitre -- mais un ecart doit se voir, sinon il ne
  // se decouvre qu'a l'arrivee.
  b.dataset.demande = personne.vue_mer ? CHAMBRE_VUE_MER : personne.hebergement;

  if (saisi === personne.id) b.classList.add("saisi");
  b.setAttribute("aria-pressed", saisi === personne.id ? "true" : "false");
  const nomComplet = precision ? `${personne.prenom} (${precision})` : personne.prenom;
  b.title = dansUneUnite
    ? `${nomComplet} — cliquer pour le déplacer`
    : `${nomComplet} — à placer`;

  b.addEventListener("click", () => {
    saisi = saisi === personne.id ? null : personne.id;
    dessinerPlan();
  });
  b.addEventListener("dragstart", (e) => {
    // On ne touche PAS a `saisi` : cet etat-la sert au clic-clic, et un
    // glisser qui rate sa cible le laisserait arme. Le prochain clic
    // n'importe ou deplacerait alors quelqu'un sans qu'on l'ait demande.
    // La classe suffit a montrer le jeton en vol, et `dragend` la retire.
    e.dataTransfer.setData(TYPE_JETON, personne.id);
    e.dataTransfer.effectAllowed = "move";
    b.classList.add("saisi");
  });
  b.addEventListener("dragend", () => b.classList.remove("saisi"));
  return b;
}

// Le rectangle d'une unite -- ou le tas de ceux qui restent a placer, qui
// se comporte comme une unite sans capacite.
function rectangle(unite, occupants) {
  const boite = document.createElement("div");
  boite.className = unite.cle === TAS ? "unite tas" : "unite";

  const titre = document.createElement("h4");
  titre.append(span(unite.nom, "titre-unite"));

  if (unite.cle === TAS) {
    titre.append(span(`${occupants.length}`, "compte-unite"));
  } else {
    const compte = span(`${occupants.length} / ${unite.capacite}`, "compte-unite");
    if (occupants.length > unite.capacite) {
      compte.classList.add("trop");
      compte.title = `${occupants.length - unite.capacite} de plus que la capacité`;
      boite.classList.add("debordee");
    }
    titre.append(compte);
  }
  boite.appendChild(titre);

  const places = document.createElement("div");
  places.className = "places";
  for (const p of occupants) {
    const j = jeton(p, unite.cle !== TAS);
    // Un lit de chambre pour qui a demande un gite : l'ecart se marque sur
    // le jeton, la ou il se lit, et pas dans un message a part.
    if (unite.cle !== TAS && j.dataset.demande !== typeDe(unite)) {
      j.classList.add("ecart");
      j.title += ` — a demandé « ${etiquetteDemande(j.dataset.demande)} »`;
    }
    places.appendChild(j);
  }
  if (!occupants.length) places.append(span("vide", "vide"));
  boite.appendChild(places);

  // La zone de depot est la boite entiere, et non la seule bande des
  // jetons : viser trois pixels de haut dans un rectangle vide serait un
  // jeu d'adresse.
  boite.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    boite.classList.add("visee");
  });
  boite.addEventListener("dragleave", () => boite.classList.remove("visee"));
  boite.addEventListener("drop", (e) => {
    e.preventDefault();
    boite.classList.remove("visee");
    placer(e.dataTransfer.getData(TYPE_JETON), unite);
  });
  // Le meme geste au clic, pour le doigt et pour le clavier.
  boite.addEventListener("click", (e) => {
    if (e.target.closest(".jeton")) return; // le jeton gere son propre clic
    if (saisi) placer(saisi, unite);
  });

  return boite;
}

function etiquetteDemande(valeur) {
  const t = TYPES_LOGEMENT[valeur];
  return t ? t.un : valeur;
}

function dessinerPlan() {
  const { unites, dormeurs, jour } = etat.plan;
  ambigus = prenomsPortesPlusieursFois();
  zonePlan.textContent = "";

  const places = dormeurs.filter((d) => d.logement_id).length;
  compteurCouchages.textContent = dormeurs.length
    ? `nuit du ${afficherJour(jour)} — ${places} placé(s) sur ${dormeurs.length}`
    : `nuit du ${afficherJour(jour)} — personne ne dort sur place`;

  if (!unites.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent =
      "L'inventaire est vide : il n'y a aucun couchage où poser quelqu'un.";
    zonePlan.appendChild(rien);
    return;
  }

  // Ceux qui restent a placer d'abord, en pleine largeur : c'est le tas qui
  // doit se vider, et c'est donc lui qu'on regarde.
  const dans = (cle) =>
    dormeurs.filter((d) => cleUnite(d.logement_id, d.numero) === cle);

  zonePlan.appendChild(
    rectangle(
      { cle: TAS, nom: "À placer" },
      dormeurs.filter((d) => !d.logement_id)
    )
  );

  const grille = document.createElement("div");
  grille.className = "plan-grille";
  for (const u of unites) grille.appendChild(rectangle(u, dans(u.cle)));
  zonePlan.appendChild(grille);
}

async function placer(personneId, unite) {
  const personne = etat.plan.dormeurs.find((d) => d.id === personneId);
  if (!personne) return;

  const dejaLa =
    unite.cle === TAS
      ? !personne.logement_id
      : cleUnite(personne.logement_id, personne.numero) === unite.cle;
  if (dejaLa) {
    saisi = null;
    return dessinerPlan();
  }

  messageCouchages.className = "";
  messageCouchages.textContent = "Enregistrement…";
  try {
    await rpc("admin_couchage_placer", {
      p_code: etat.code,
      p_participant: personneId,
      p_jour: etat.plan.jour,
      p_logement: unite.cle === TAS ? null : unite.logement_id,
      p_numero: unite.cle === TAS ? null : unite.numero,
    });
    await rechargerPlan(etat.plan.jour);
    messageCouchages.className = "ok";
    messageCouchages.textContent =
      unite.cle === TAS
        ? `${personne.prenom} n'a plus de place attribuée.`
        : `${personne.prenom} → ${unite.nom}.`;
  } catch (erreur) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = erreur.message;
    // Le serveur a refuse : l'ecran doit revenir a ce que la base contient.
    await rechargerPlan(etat.plan.jour);
  }
}

// Le reste de la page absorbe nos deposes rates.
//
// Entre deux rectangles il y a dix pixels, et sous eux toute une note. Un
// jeton lache la n'atteint aucune zone d'arrivee : sans ces deux lignes, le
// navigateur reprend la main sur le geste. On l'annule partout ou il
// s'agit d'un de NOS jetons -- reconnus a leur type -- et nulle part
// ailleurs : un fichier depose sur la page reste l'affaire du navigateur.
//
// Rien n'est pose ici. Rater sa cible ne doit pas deplacer quelqu'un au
// hasard ; cela doit ne rien faire du tout.
for (const evenement of ["dragover", "drop"]) {
  document.addEventListener(evenement, (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes(TYPE_JETON)) {
      e.preventDefault();
    }
  });
}

// Échap repose ce qu'on avait saisi. Sans cette porte de sortie, un jeton
// saisi par erreur suit le prochain clic n'importe ou.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && saisi) {
    saisi = null;
    dessinerPlan();
  }
});

document.getElementById("couchages-reporter").addEventListener("click", async () => {
  const { jour, nuits } = etat.plan;
  const suivantes = (nuits || []).filter((n) => n.jour > jour).length;
  if (!suivantes) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = "C'est la dernière nuit du séjour.";
    return;
  }
  if (
    !confirm(
      `Reporter le plan de la nuit du ${afficherJour(jour)} sur les ` +
        `${suivantes} nuit(s) suivantes ?\n\nCe qui y était déjà posé sera ` +
        `remplacé. Seules les personnes présentes ces nuits-là suivent.`
    )
  ) {
    return;
  }

  messageCouchages.className = "";
  messageCouchages.textContent = "Report…";
  try {
    const r = await rpc("admin_couchages_reporter", { p_code: etat.code, p_jour: jour });
    await rechargerPlan(jour);
    messageCouchages.className = "ok";
    messageCouchages.textContent =
      `${r.ecrits} place(s) posée(s) sur ${r.nuits} nuit(s) suivante(s).`;
  } catch (erreur) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = erreur.message;
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
// celle-ci (cf. schema.sql, section 12).
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
  // Le plan de couchage se compte comme les presences : une ligne par
  // personne et par nuit, donc la meme cle naturelle et le meme affichage
  // « untel : 4 -> 6 ».
  {
    clef: "couchages",
    nom: "Couchages",
    cle: ["participant_id", "jour"],
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
const CHAMPS_LOGEMENT = ["categorie", "capacite", "nombre", "vue_mer"];

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
  categorie: "type",
  capacite: "capacité",
  nombre: "nombre",
  vue_mer: "vue mer",
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

  // L'inventaire n'entre dans les copies que depuis qu'il existe. Une copie
  // plus ancienne ne dit RIEN a son sujet, et le silence n'est pas « il n'y
  // en avait aucun » : on ne compare pas, exactement comme la restauration
  // n'y touche pas. Annoncer « 3 types ajoutes » pour ensuite les laisser en
  // place serait la pire des deux reponses.
  const logements = avant.logements
    ? comparerParId(avant.logements, apres.logements, CHAMPS_LOGEMENT)
    : null;

  const tables = COMPARABLES.map((def) => {
    const r = comparerTable(avant[def.clef], apres[def.clef], def);
    for (const g of r.personnes) g.prenom = noms.get(g.pid) || "(inconnu)";
    r.personnes.sort((x, y) => x.prenom.localeCompare(y.prenom, "fr"));
    return { clef: def.clef, nom: def.nom, ...r };
  });

  const bouge = (d) => !!d && (d.ajoutes.length || d.retires.length || d.modifies.length);
  return {
    participants,
    options,
    logements,
    tables,
    identique:
      !bouge(participants) &&
      !bouge(options) &&
      !bouge(logements) &&
      tables.every((t) => !t.personnes.length),
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

  const g = d.logements;
  if (g && (g.ajoutes.length || g.retires.length || g.modifies.length)) {
    zoneComparaison.appendChild(sousTitre(`Logements : ${g.avant} → ${g.apres}`));
    for (const x of g.ajoutes) zoneComparaison.appendChild(ligneDiff("ajouté", nommerLogement(x)));
    for (const x of g.retires) zoneComparaison.appendChild(ligneDiff("retiré", nommerLogement(x)));
    for (const m of g.modifies) {
      zoneComparaison.appendChild(
        ligneDiff("modifié", `${nommerLogement(m.avant)} → ${nommerLogement(m.apres)}`)
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


// ---------------------------------------------------------- le sejour
//
// Deux dates, et rien d'autre -- mais ce sont elles qui bornent la grille
// de saisie et qui filtrent tout ce qui s'ecrit dans `presences`. Laissees
// sur les valeurs d'exemple, elles font echouer un import entier sans que
// rien n'explique pourquoi. Elles ne vivaient que dans l'editeur SQL.

const champDebut = document.getElementById("sejour-debut");
const champFin = document.getElementById("sejour-fin");
const resumeSejour = document.getElementById("sejour-resume");
const messageSejour = document.getElementById("message-sejour");
const interrupteurSaisie = document.getElementById("saisie-ouverte");

// Deplacer les dates ne deplace pas ce qui a ete saisi. Les journees qui
// tombent hors des nouvelles bornes restent en base, invisibles du
// formulaire et ignorees a l'export : on ne les efface pas, mais on ne les
// tait pas non plus.
function direHorsSejour(combien) {
  messageSejour.className = combien ? "erreur" : "";
  messageSejour.textContent = combien
    ? `${combien} journée(s) déjà saisies tombent hors de ces dates : ` +
      `elles n'apparaissent plus dans le formulaire et sortent de l'export.`
    : "";
}

async function rechargerSejour() {
  const d = await rpc("admin_sejour", { p_code: etat.code });
  champDebut.value = d.date_debut;
  champFin.value = d.date_fin;
  interrupteurSaisie.checked = d.saisie_ouverte;
  resumeSejour.textContent =
    `${d.jours} jour(s), ${d.presences} journée(s) saisie(s)`;
  direHorsSejour(d.presences_hors);
}

document.getElementById("sejour-enregistrer").addEventListener("click", async () => {
  messageSejour.className = "";
  messageSejour.textContent = "Enregistrement…";
  try {
    const d = await rpc("admin_sejour_dates", {
      p_code: etat.code,
      p_debut: champDebut.value || null,
      p_fin: champFin.value || null,
    });
    await recharger();
    if (!d.presences_hors) {
      messageSejour.className = "ok";
      messageSejour.textContent =
        `Séjour du ${afficherJour(d.date_debut)} au ${afficherJour(d.date_fin)}` +
        ` — ${d.jours} jour(s).`;
    }
  } catch (erreur) {
    messageSejour.className = "erreur";
    messageSejour.textContent = erreur.message;
  }
});

interrupteurSaisie.addEventListener("change", async () => {
  try {
    await rpc("admin_saisie_ouvrir", {
      p_code: etat.code,
      p_ouvert: interrupteurSaisie.checked,
    });
    messageSejour.className = "ok";
    messageSejour.textContent = interrupteurSaisie.checked
      ? "Saisie ouverte."
      : "Saisie close : la famille ne peut plus remplir ses présences.";
  } catch (erreur) {
    // Le serveur n'a pas suivi : la case doit revenir a ce qu'elle etait,
    // sans quoi elle montrerait un etat que la base ne connait pas.
    interrupteurSaisie.checked = !interrupteurSaisie.checked;
    messageSejour.className = "erreur";
    messageSejour.textContent = erreur.message;
  }
});
