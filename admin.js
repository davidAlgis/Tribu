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

// LA PAGE ET CE SCRIPT SE METTENT EN CACHE SEPAREMENT.
//
// Un navigateur peut donc servir l'admin.html d'hier avec l'admin.js
// d'aujourd'hui. Le script meurt alors a la premiere ligne qui touche un
// element que l'ancienne page n'a pas -- « Cannot read properties of null
// (reading 'addEventListener') » -- et il meurt EN SILENCE, au milieu,
// laissant la moitie des boutons sans gestionnaire.
//
// Ce qu'on voit ensuite parle d'autre chose : la premiere fonction
// appelee se plaint d'une constante que le fichier n'a jamais atteinte
// (« can't access lexical declaration ... before initialization »). Le
// message est vrai et n'aide personne.
//
// On attrape donc ce qui casse AVANT la fin du cablage -- apres, c'est un
// vrai defaut, pas une histoire de cache -- et on dit quoi faire.
let cablageTermine = false;

window.addEventListener("error", () => {
  if (cablageTermine || document.getElementById("page-perimee")) return;
  const banniere = document.createElement("p");
  banniere.id = "page-perimee";
  banniere.className = "erreur";
  banniere.textContent =
    "Cette page n'est pas à jour : recharge-la en forçant le cache " +
    "(Ctrl+Shift+R, ou Cmd+Shift+R). Sans cela, une partie des boutons " +
    "ne répondra pas.";
  const ou = document.querySelector("main");
  if (ou) ou.prepend(banniere);
});

const AGES = { adulte: "adulte", jeune: "jeune", enfant: "enfant", bebe: "bébé" };

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
  AGE_INVALIDE: "Les bornes d'âge doivent être des nombres positifs.",
  NAISSANCE_INVALIDE: "Cette date de naissance est impossible : ni dans l'avenir, ni avant 1900.",
  AGES_INVERSES:
    "Les bornes doivent monter : bébé, puis enfant, puis jeune.",
  CATEGORIE_INCONNUE: "Type de couchage inconnu.",
  CAPACITE_INVALIDE: "La capacité doit être un nombre entre 1 et 30.",
  NOMBRE_INVALIDE: "Le nombre de logements doit être entre 1 et 200.",
  VUE_MER_HORS_CHAMBRE: "La vue mer ne concerne que les chambres.",
  LOGEMENT_EXISTANT: "Ce type est déjà dans l'inventaire : corrige plutôt sa ligne.",
  UNITE_INCONNUE: "Ce couchage n'existe plus. Recharge la page.",
  PAS_SUR_PLACE: "Cette personne n'a pas déclaré dormir sur place cette nuit-là.",
  TITRE_VIDE: "Il manque l'intitulé de l'activité.",
  ACTIVITE_EXISTE: "Cette idée est déjà dans la liste.",
  ACTIVITE_INCONNUE: "Cette idée n'existe plus. Recharge la page.",
  REDUCTION_INVALIDE:
    "Une réduction est un nombre positif — et un pourcentage ne dépasse pas 100.",
};

const etat = {
  code: "",
  participants: [],
  type: "famille",
  logements: [],
  nuits: [],
  sansTaille: [],
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
  dessinerRegimes();
  remplirSelecteurs();
  await rechargerSejour();
  await rechargerLogements();
  await rechargerDates();
  await rechargerLieux();
  await rechargerActivites();
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

      // La categorie FACTURE ; la date de naissance, elle, ne fait que la
      // proposer. Quand les deux divergent, on le dit -- sans rien changer :
      // l'hotel compte parfois autrement pour telle personne, et c'est
      // l'organisateur qui tranche, pas la page.
      if (
        personne.categorie_attendue &&
        personne.categorie_attendue !== personne.categorie_age
      ) {
        const ecart = span(`l'âge dit : ${AGES[personne.categorie_attendue]}`, "etiquette alerte");
        ecart.title =
          `${personne.age} ans à la date du séjour. ` +
          `« Recalculer les catégories », dans l'onglet Séjour, corrige tout d'un coup.`;
        etiquettes.append(ecart);
      }

      const gauche = document.createElement("div");
      // « conjoint·e de Paul · 42 ans ». L'age vient de la base, calcule a
      // la date du sejour : c'est celui que l'hotel facturera, et non celui
      // d'aujourd'hui.
      const lien =
        personne.age === null || personne.age === undefined
          ? decrireLien(personne)
          : `${decrireLien(personne)} · ${personne.age} ans`;
      gauche.append(fort(personne.prenom), etiquettes, span(lien, "lien"));

      gauche.appendChild(selecteurPortee(personne));

      const renommer = document.createElement("button");
      renommer.type = "button";
      renommer.className = "modifier";
      renommer.textContent = "✎";
      renommer.title = `Corriger ${personne.prenom} — prénom, date de naissance`;
      renommer.setAttribute("aria-label", `Corriger ${personne.prenom}`);
      renommer.addEventListener("click", () => editerPersonne(personne, gauche));

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

// ---------------------------------------------------------- corriger
//
// Une faute de frappe dans un prenom n'obligeait qu'a retirer la personne
// et a la recreer -- ce qui emportait ses presences et cassait les liens
// de parente autour d'elle. Le RPC existait ; il n'avait pas de bouton.
//
// La date de naissance a rejoint le meme formulaire. Le GEDCOM en pose
// beaucoup, jamais toutes : les invites n'y figurent pas, et il en manque
// pour les plus anciens. Les saisir une par une demandait jusqu'ici de
// passer par l'editeur SQL.

function editerPersonne(personne, zone) {
  const champ = document.createElement("input");
  champ.type = "text";
  champ.value = personne.prenom;
  champ.maxLength = 40;
  champ.setAttribute("aria-label", `Nouveau prénom pour ${personne.prenom}`);

  const naissance = document.createElement("input");
  naissance.type = "date";
  // Vide quand on ne sait pas -- et le rester est une reponse valable : la
  // laisser vide vaut mieux qu'une date inventee, qui donnerait un age faux
  // sans jamais se signaler.
  naissance.value = personne.date_naissance || "";
  naissance.max = new Date().toISOString().slice(0, 10);
  naissance.setAttribute("aria-label", `Date de naissance de ${personne.prenom}`);

  const valider = document.createElement("button");
  valider.type = "button";
  valider.textContent = "Corriger";

  const annuler = document.createElement("button");
  annuler.type = "button";
  annuler.className = "discret";
  annuler.textContent = "Annuler";

  const bloc = document.createElement("div");
  bloc.className = "renommage";
  bloc.append(champ, naissance, valider, annuler);

  // On remplace le contenu de la ligne plutot que d'ouvrir une boite :
  // le nom se corrige la ou il se lit.
  zone.replaceChildren(bloc);
  champ.focus();
  champ.select();

  const saisie = () => ({ prenom: champ.value, naissance: naissance.value });

  annuler.addEventListener("click", dessinerListe);
  valider.addEventListener("click", () => corriger(personne, saisie()));
  for (const entree of [champ, naissance]) {
    entree.addEventListener("keydown", (e) => {
      if (e.key === "Enter") corriger(personne, saisie());
      if (e.key === "Escape") dessinerListe();
    });
  }
}

// « 12 juin 1965 » plutot que « 1965-06-12 » : on relit une date de
// naissance, on ne la trie pas.
function afficherNaissance(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function corriger(personne, saisie) {
  const neuf = saisie.prenom.trim();
  const avantNaissance = personne.date_naissance || "";
  const apresNaissance = saisie.naissance || "";

  // Rien n'a bouge : on referme sans rien envoyer. Un enregistrement pour
  // rien poserait une sauvegarde hebdomadaire, et brouillerait la
  // comparaison des copies.
  if ((!neuf || neuf === personne.prenom) && apresNaissance === avantNaissance) {
    return dessinerListe();
  }

  message.className = "";
  message.textContent = "Correction…";
  try {
    const r = await rpc("admin_modifier", {
      p_code: etat.code,
      p_id: personne.id,
      p_prenom: neuf || personne.prenom,
      // `p_age: null` : la fonction garde la categorie d'age telle quelle.
      // Elle se refait en bloc depuis l'onglet Sejour, apres coup -- une
      // date corrigee ne doit pas changer une facture dans le dos.
      p_age: null,
      // Le champ vide EFFACE : ne pas savoir est une reponse, et il faut
      // pouvoir revenir dessus quand le GEDCOM s'est trompe de personne.
      p_naissance: apresNaissance || null,
      p_effacer_naissance: apresNaissance === "",
    });
    const ancien = personne.prenom;
    await recharger();

    const dits = [];
    if (r.prenom !== ancien) dits.push(`« ${ancien} » devient « ${r.prenom} »`);
    if (apresNaissance !== avantNaissance) {
      dits.push(
        r.date_naissance
          ? `né·e le ${afficherNaissance(r.date_naissance)}`
          : "date de naissance effacée"
      );
    }
    message.className = "ok";
    message.textContent =
      `${r.prenom} : ${dits.join(", ")}.` +
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
  // Dans l'ordre de la base, comme la liste au-dessus : chercher quelqu'un
  // dans deux rangements differents sur la meme page est un effort qu'on
  // peut epargner.
  for (const personne of etat.participants) {
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
  // La facture se refait a chaque ouverture : elle ne garde rien, et les
  // faits changent sans arret pendant qu'on organise. Rien a perdre non
  // plus, ce volet ne se saisit pas.
  if (onglet.id === "onglet-facture") rechargerFacture();
  if (onglet.id === "onglet-hotel") rechargerHotel();
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

function afficherJour(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

async function rechargerDates() {
  const donnees = await rpc("admin_dates_lister", { p_code: etat.code });
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

// -------------------------------------------------------- ouvertures
//
// UNE PAGE, UN VERROU, UN SEUL PANNEAU. Ils existaient deja, mais chacun
// se tournait dans un onglet different : on ne savait jamais ce qui
// restait ouvert sans faire le tour.
//
// Fermer ne cache rien : la page se lit encore, elle ne s'ecrit plus.
// C'est la base qui refuse -- la page le montre seulement.

const PAGES_FAMILLE = [
  ["lieux", "Le lieu", "lieux.html"],
  ["voeux", "La date", "dates.html"],
  ["saisie", "Les présences", "presences.html"],
  ["regimes", "Préférences alimentaires", "regimes.html"],
  ["activites", "Les activités", "activites.html"],
];

const zoneOuvertures = document.getElementById("ouvertures");
const compteurOuvertures = document.getElementById("compteur-ouvertures");
const messageOuvertures = document.getElementById("message-ouvertures");

function dessinerOuvertures() {
  const etats = etat.ouvertures || {};
  const fermees = PAGES_FAMILLE.filter(([cle]) => etats[cle] === false).length;
  compteurOuvertures.textContent = fermees
    ? `${fermees} page(s) fermée(s)`
    : "toutes ouvertes";

  zoneOuvertures.textContent = "";
  for (const [cle, titre, page] of PAGES_FAMILLE) {
    const ligne = document.createElement("div");
    ligne.className = "personne-regime";

    const etiquette = document.createElement("label");
    etiquette.className = "interrupteur";
    const boite = document.createElement("input");
    boite.type = "checkbox";
    boite.id = `ouvrir-${cle}`;
    boite.checked = etats[cle] !== false;
    boite.addEventListener("change", () => ouvrir(cle, boite.checked));
    etiquette.append(boite, ` ${titre}`);

    const ou = document.createElement("a");
    ou.href = `./${page}`;
    ou.className = "discret-inline";
    ou.textContent = page;

    ligne.append(etiquette, " ", ou);
    if (etats[cle] === false) ligne.append(span("fermée", "etiquette alerte"));
    zoneOuvertures.appendChild(ligne);
  }
}

async function ouvrir(quoi, ouvert) {
  messageOuvertures.className = "";
  messageOuvertures.textContent = "Enregistrement…";
  try {
    etat.ouvertures = await rpc("admin_ouvrir", {
      p_code: etat.code,
      p_quoi: quoi,
      p_ouvert: ouvert,
    });
    dessinerOuvertures();
    const nom = (PAGES_FAMILLE.find(([c]) => c === quoi) || [])[1] || quoi;
    messageOuvertures.className = "ok";
    messageOuvertures.textContent = ouvert
      ? `« ${nom} » est de nouveau ouverte.`
      : `« ${nom} » est fermée : elle se lit, elle ne s'écrit plus.`;
  } catch (erreur) {
    messageOuvertures.className = "erreur";
    messageOuvertures.textContent = erreur.message;
    dessinerOuvertures();
  }
}

// Toutes d'un coup : une par une, c'est autant d'allers-retours et
// autant d'occasions d'en oublier une ouverte.
async function toutes(ouvert) {
  messageOuvertures.className = "";
  messageOuvertures.textContent = "Enregistrement…";
  try {
    for (const [cle] of PAGES_FAMILLE) {
      etat.ouvertures = await rpc("admin_ouvrir", {
        p_code: etat.code,
        p_quoi: cle,
        p_ouvert: ouvert,
      });
    }
    dessinerOuvertures();
    messageOuvertures.className = "ok";
    messageOuvertures.textContent = ouvert
      ? "Toutes les pages sont ouvertes."
      : "Toutes les pages sont fermées : la famille lit, elle n'écrit plus.";
  } catch (erreur) {
    messageOuvertures.className = "erreur";
    messageOuvertures.textContent = erreur.message;
    dessinerOuvertures();
  }
}

document.getElementById("tout-fermer").addEventListener("click", () => toutes(false));
document.getElementById("tout-ouvrir").addEventListener("click", () => toutes(true));


// ------------------------------------------ preferences alimentaires
//
// Quatre cases par personne. La famille les remplit elle-meme sur
// `regimes.html` ; ici l'organisateur remplit pour ceux qui n'ouvriront
// pas la page, et corrige.
//
// CHAQUE CASE PART TOUTE SEULE, comme cote famille : une case a cocher
// qui attend un bouton est une case qu'on croit cochee.

const CASES_REGIME = [
  // La clef reste `non_buveur` ; seul le mot change.
  ["non_buveur", "Sans alcool"],
  ["vegetarien", "Végétarien"],
  ["vegan", "Vegan"],
  ["sans_gluten", "Sans gluten"],
];

const zoneRegimes = document.getElementById("tableau-regimes");
const compteurRegimes = document.getElementById("compteur-regimes");
const messageRegimes = document.getElementById("message-regimes");

function dessinerRegimes() {
  const gens = etat.participants || [];

  // Ce que le traiteur demandera : des nombres, pas des noms.
  const comptes = CASES_REGIME.map(
    ([champ, libelle]) => `${gens.filter((p) => p[champ]).length} ${libelle.toLowerCase()}`
  );
  compteurRegimes.textContent = gens.length ? comptes.join(", ") : "";

  zoneRegimes.textContent = "";
  if (!gens.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = "Aucun participant : rien à remplir ici.";
    zoneRegimes.appendChild(rien);
    return;
  }

  const cadre = document.createElement("div");
  cadre.className = "tableau-large";
  const table = document.createElement("table");

  const tete = document.createElement("thead");
  const rangee = document.createElement("tr");
  for (const titre of ["Personne", ...CASES_REGIME.map(([, l]) => l)]) {
    const th = document.createElement("th");
    th.textContent = titre;
    rangee.appendChild(th);
  }
  tete.appendChild(rangee);
  table.appendChild(tete);

  const corps = document.createElement("tbody");
  for (const personne of gens) {
    const mineur = personne.categorie_age !== "adulte";
    const tr = document.createElement("tr");
    tr.dataset.personne = personne.id;

    const nom = document.createElement("th");
    nom.scope = "row";
    nom.append(personne.prenom);
    if (personne.famille && personne.famille !== personne.prenom) {
      nom.append(span(` (${personne.famille})`, "precision"));
    }
    if (mineur) nom.append(span("mineur", "etiquette"));
    tr.appendChild(nom);

    for (const [champ, libelle] of CASES_REGIME) {
      const td = document.createElement("td");
      const etiquette = document.createElement("label");
      etiquette.className = "interrupteur";
      const boite = document.createElement("input");
      boite.type = "checkbox";
      boite.dataset.champ = champ;
      boite.checked = !!personne[champ];
      boite.setAttribute("aria-label", `${personne.prenom} — ${libelle}`);
      // Un mineur ne boit pas : la case est cochee et ne se decoche pas.
      // La base le refuse aussi -- une page ne fait pas foi -- mais un
      // refus qu'on voit venir vaut mieux qu'un refus recu.
      if (champ === "non_buveur" && mineur) {
        boite.checked = true;
        boite.disabled = true;
        etiquette.title = "Un mineur ne boit pas : la case ne se décoche pas.";
      }
      boite.addEventListener("change", () => enregistrerRegime(personne, tr));
      etiquette.appendChild(boite);
      td.appendChild(etiquette);
      tr.appendChild(td);
    }
    corps.appendChild(tr);
  }
  table.appendChild(corps);
  cadre.appendChild(table);
  zoneRegimes.appendChild(cadre);
}

async function enregistrerRegime(personne, rangee) {
  const regimes = {};
  for (const boite of rangee.querySelectorAll("input[data-champ]")) {
    regimes[boite.dataset.champ] = boite.checked;
  }

  messageRegimes.className = "";
  messageRegimes.textContent = "Enregistrement…";
  try {
    const r = await rpc("admin_regime", {
      p_code: etat.code,
      p_id: personne.id,
      p_regimes: regimes,
    });
    // La base tranche sur « sans alcool » : on reprend ce qu'elle rend.
    Object.assign(personne, regimes, { non_buveur: r.non_buveur });
    dessinerRegimes();
    messageRegimes.className = "ok";
    messageRegimes.textContent = `C'est noté pour ${personne.prenom}.`;
  } catch (erreur) {
    messageRegimes.className = "erreur";
    messageRegimes.textContent = erreur.message;
    await recharger();
  }
}



// ------------------------------------------------------ les activites
//
// Une liste d'idees, et trois reponses par personne. L'organisateur en
// AJOUTE et en RETIRE ; il ne repond pour personne.
//
// Ce n'est pas une symetrie oubliee avec les preferences alimentaires,
// ou il remplit pour ceux qui n'ouvriront pas la page : une allergie est
// un fait qu'un tiers peut connaitre, une envie non. Le tableau du bas se
// lit donc, et ne se remplit pas.
//
// NON EST LA REPONSE PAR DEFAUT, ET LA BASE NE LE GARDE PAS. Elle ne
// stocke que les « oui » et les « pourquoi pas » : le nombre de « non »
// se calcule ici, comme le reste de la famille.

const AVIS_ACTIVITE = [
  ["oui", "Oui"],
  ["peut_etre", "Pourquoi pas"],
  ["non", "Non"],
];

const listeActivites = document.getElementById("liste-activites");
const tableauActivites = document.getElementById("tableau-activites");
const compteurActivites = document.getElementById("compteur-activites");
const compteurAvis = document.getElementById("compteur-avis");
const messageActivites = document.getElementById("message-activites");

async function rechargerActivites() {
  const donnees = await rpc("admin_activites", { p_code: etat.code });
  etat.activites = donnees.activites || [];
  etat.envies = donnees.envies || [];
  dessinerActivites();
}

// Ce que la base garde : rien pour un « non ». Le defaut se lit ici.
function avisDe(participant, activite) {
  const ligne = (etat.envies || []).find(
    (e) => e.participant_id === participant && e.activite_id === activite
  );
  return ligne ? ligne.avis : "non";
}

function comptesDe(activite) {
  const gens = etat.participants || [];
  const oui = gens.filter((p) => avisDe(p.id, activite.id) === "oui").length;
  const peutEtre = gens.filter((p) => avisDe(p.id, activite.id) === "peut_etre").length;
  return { oui, peutEtre, non: gens.length - oui - peutEtre };
}

function dessinerActivites() {
  const activites = etat.activites || [];
  compteurActivites.textContent = activites.length ? `${activites.length} idée(s)` : "";

  // ---- La liste, et le bouton qui retire ----
  listeActivites.textContent = "";
  if (!activites.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent =
      "Aucune idée pour l'instant. Pose-en une ci-dessus, ou attends " +
      "que la famille s'en charge.";
    listeActivites.appendChild(rien);
  }

  for (const activite of activites) {
    const compte = comptesDe(activite);

    const bloc = document.createElement("div");
    bloc.className = "activite";
    bloc.dataset.activite = activite.id;

    const tete = document.createElement("div");
    tete.className = "activite-tete";
    tete.appendChild(fort(activite.titre));

    const retirer = document.createElement("button");
    retirer.type = "button";
    retirer.className = "retirer";
    retirer.textContent = "Retirer";
    retirer.title = `Retirer « ${activite.titre} » et les réponses de tous`;
    retirer.addEventListener("click", () => retirerActivite(activite, compte));
    tete.appendChild(retirer);
    bloc.appendChild(tete);

    if (activite.description) {
      const precision = document.createElement("p");
      precision.className = "note";
      precision.textContent = activite.description;
      bloc.appendChild(precision);
    }

    const etiquettes = span("", "etiquettes");
    etiquettes.append(
      span(`${compte.oui} oui`, "etiquette ok"),
      span(`${compte.peutEtre} pourquoi pas`, "etiquette"),
      span(`${compte.non} non`, "etiquette")
    );

    const bas = document.createElement("div");
    bas.className = "activite-bas";
    bas.appendChild(etiquettes);
    // `propose_par` est vide quand l'idee vient d'ici -- ou quand celui qui
    // l'a proposee a quitte la liste depuis. On ne dit donc rien plutot que
    // d'affirmer l'un pour l'autre.
    const propose = activite.propose_par && parId(activite.propose_par);
    if (propose) bas.appendChild(span(`proposé par ${propose.prenom}`, "discret-inline"));
    bloc.appendChild(bas);

    listeActivites.appendChild(bloc);
  }

  dessinerAvis();
}

// Une ligne par personne, une colonne par idee. C'est la vue qu'on veut
// quand on cherche qui manque a l'appel d'une sortie.
function dessinerAvis() {
  const activites = etat.activites || [];
  const gens = etat.participants || [];

  const repondants = new Set((etat.envies || []).map((e) => e.participant_id)).size;
  compteurAvis.textContent = activites.length
    ? `${repondants} personne(s) ont répondu`
    : "";

  tableauActivites.textContent = "";
  if (!activites.length || !gens.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = activites.length
      ? "Aucun participant : rien à montrer ici."
      : "Aucune idée : rien à montrer ici.";
    tableauActivites.appendChild(rien);
    return;
  }

  const cadre = document.createElement("div");
  cadre.className = "tableau-large";
  const table = document.createElement("table");

  const tete = document.createElement("thead");
  const rangee = document.createElement("tr");
  const vide = document.createElement("th");
  vide.textContent = "Personne";
  rangee.appendChild(vide);
  for (const activite of activites) {
    const th = document.createElement("th");
    th.textContent = activite.titre;
    rangee.appendChild(th);
  }
  tete.appendChild(rangee);
  table.appendChild(tete);

  const corps = document.createElement("tbody");
  for (const personne of gens) {
    const tr = document.createElement("tr");
    const nom = document.createElement("th");
    nom.scope = "row";
    nom.append(personne.prenom);
    if (personne.famille && personne.famille !== personne.prenom) {
      nom.append(span(` (${personne.famille})`, "precision"));
    }
    tr.appendChild(nom);

    for (const activite of activites) {
      const avis = avisDe(personne.id, activite.id);
      const td = document.createElement("td");
      // Un « non » deduit du silence ne doit pas peser autant qu'un « oui »
      // ecrit : il se lit en gris, comme un zero dans la facture.
      if (avis === "non") td.className = "rien";
      td.textContent = (AVIS_ACTIVITE.find(([v]) => v === avis) || [])[1] || avis;
      tr.appendChild(td);
    }
    corps.appendChild(tr);
  }

  // La somme sous chaque colonne : c'est elle qu'on lit pour trancher.
  const somme = document.createElement("tr");
  somme.className = "sous-total";
  const titre = document.createElement("th");
  titre.scope = "row";
  titre.textContent = "Oui / pourquoi pas";
  somme.appendChild(titre);
  for (const activite of activites) {
    const compte = comptesDe(activite);
    const td = document.createElement("td");
    td.textContent = `${compte.oui} / ${compte.peutEtre}`;
    somme.appendChild(td);
  }
  corps.appendChild(somme);

  table.appendChild(corps);
  cadre.appendChild(table);
  tableauActivites.appendChild(cadre);
}

const champActiviteTitre = document.getElementById("activite-titre");
const champActiviteDescription = document.getElementById("activite-description");

document.getElementById("activite-ajouter").addEventListener("click", async () => {
  messageActivites.className = "";
  messageActivites.textContent = "Enregistrement…";
  try {
    await rpc("admin_activite_ajouter", {
      p_code: etat.code,
      p_titre: champActiviteTitre.value,
      p_description: champActiviteDescription.value,
    });
    champActiviteTitre.value = "";
    champActiviteDescription.value = "";
    await rechargerActivites();
    messageActivites.className = "ok";
    messageActivites.textContent = "Idée ajoutée.";
  } catch (erreur) {
    messageActivites.className = "erreur";
    messageActivites.textContent = erreur.message;
  }
});

// Le nombre de reponses emportees se dit AVANT, avec ce qu'on a deja sous
// la main : « supprimer 14 réponses » ne se decouvre pas apres coup.
async function retirerActivite(activite, compte) {
  const donnees = compte.oui + compte.peutEtre;
  const question =
    `Retirer « ${activite.titre} » ?\n\n` +
    (donnees
      ? `${donnees} réponse(s) partent avec, sans retour.`
      : "Personne n'y a répondu : rien d'autre ne part avec.");
  if (!confirm(question)) return;

  messageActivites.className = "";
  messageActivites.textContent = "Suppression…";
  try {
    await rpc("admin_activite_retirer", { p_code: etat.code, p_id: activite.id });
    await rechargerActivites();
    messageActivites.className = "ok";
    messageActivites.textContent = `« ${activite.titre} » est retirée.`;
  } catch (erreur) {
    messageActivites.className = "erreur";
    messageActivites.textContent = erreur.message;
  }
}

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
  etat.sansTaille = d.sans_taille || [];
  dessinerLogements();
  dessinerPreciser();
  dessinerTension();
  // Le plan depend de l'inventaire : retirer un type ou baisser son nombre
  // change les rectangles sous les jetons. On garde la nuit regardee.
  await plateau.recharger(plateau.jour());

  // La grille des tarifs aussi -- mais seulement si les TYPES ont change.
  // Sans cette garde, n'importe quelle relecture de l'inventaire effacerait
  // des prix en cours de saisie dans l'autre onglet.
  const types = (etat.logements || []).map((l) => l.id).sort().join(",");
  if (types !== tarifs.signature) await rechargerTarifs();
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

// ---------------------------------------------------- donner une taille
//
// Le tableur ne donne la capacite QUE DES GITES : « chambre_4 » y est la
// chambre n° 4, pas une chambre de quatre. Toutes les chambres importees
// arrivent donc sans taille, et les preciser une par une sur soixante
// personnes et cinq nuits n'est pas une option.
//
// Le bloc ne parait que s'il reste quelque chose a preciser : un controle
// qui ne sert a rien est un controle qui fait douter.

const blocPreciser = document.getElementById("bloc-preciser");
const choixPreciser = document.getElementById("preciser-type");
const compteurSansTaille = document.getElementById("compteur-sans-taille");

function memeCategorie(a, b) {
  return a.categorie === b.categorie && !!a.vue_mer === !!b.vue_mer;
}

function dessinerPreciser() {
  // On ne propose que les types dont la categorie a effectivement des
  // declarations en attente : offrir « gîte de 6 » quand tous les gites
  // sont deja precises ferait croire qu'il reste du travail.
  const utiles = etat.logements.filter((l) =>
    (etat.sansTaille || []).some((x) => memeCategorie(x, l))
  );

  blocPreciser.hidden = !utiles.length;
  if (!utiles.length) {
    compteurSansTaille.textContent = "";
    return;
  }

  const total = (etat.sansTaille || []).reduce((n, x) => n + x.lignes, 0);
  // Le tiret separe : sans lui, le compte se colle au libelle et la
  // phrase devient « …qui n'en ont pas 41 journées ».
  compteurSansTaille.textContent = `— ${total} journée(s)`;

  const garde = choixPreciser.value;
  choixPreciser.textContent = "";
  for (const l of utiles) {
    const attente = (etat.sansTaille || []).find((x) => memeCategorie(x, l));
    choixPreciser.add(
      new Option(`${nommerLogement({ ...l, nombre: 1 }).replace(/^1 /, "")} (${attente.lignes} j.)`, l.id)
    );
  }
  if ([...choixPreciser.options].some((o) => o.value === garde)) choixPreciser.value = garde;
}

document.getElementById("preciser-appliquer").addEventListener("click", async () => {
  const type = etat.logements.find((l) => l.id === choixPreciser.value);
  if (!type) return;

  const attente = (etat.sansTaille || []).find((x) => memeCategorie(x, type));
  const quoi = nommerLogement({ ...type, nombre: 1 }).replace(/^1 /, "");
  if (
    !confirm(
      `Donner « ${quoi} » aux ${attente ? attente.lignes : 0} journée(s) de cette ` +
        `catégorie qui n'ont pas de taille ?

Celles qui en ont déjà une ne ` +
        `bougent pas, même d'une autre taille. Une copie de sauvegarde est ` +
        `prise avant.`
    )
  ) {
    return;
  }

  messageLogements.className = "";
  messageLogements.textContent = "Application…";
  try {
    const r = await rpc("admin_presences_preciser", {
      p_code: etat.code,
      p_logement: type.id,
    });
    await rechargerLogements();
    messageLogements.className = "ok";
    messageLogements.textContent = r.precisees
      ? `${r.precisees} journée(s) précisée(s) en « ${quoi} ».`
      : "Rien à préciser : toutes ces déclarations avaient déjà une taille.";
  } catch (erreur) {
    messageLogements.className = "erreur";
    messageLogements.textContent = erreur.message;
  }
});


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


// ------------------------------------------------------------- tarifs
//
// LA GRILLE SUIT L'INVENTAIRE : un tableau par type de couchage pose dans
// l'onglet d'a cote, et rien pour ce qui n'existe pas. C'etait la demande,
// et c'est aussi ce qui evite une grille dont les deux tiers ne serviraient
// jamais.
//
// UNE CHAMBRE SE FACTURE PAR PERSONNE, donc par tranche d'age : quatre
// colonnes. UN GITE SE LOUE ENTIER -- une seule colonne, et l'age n'y change
// rien, puisque c'est le gite qu'on paye et non ceux qui y dorment.
//
// Tout se saisit, puis s'enregistre d'un coup : une case par appel ferait
// quarante allers-retours pour une grille qu'on remplit d'un trait.

const TRANCHES = ["adulte", "jeune", "enfant", "bebe"];

const LIGNES_PRIX = [
  { champ: "semaine", libelle: "Semaine (€)", pas: "0.5" },
  { champ: "weekend", libelle: "Week-end (€)", pas: "0.5" },
  // La remise n'est pas un prix : elle se retranche de ceux du dessus.
  // Un trait l'en separe -- sans lui, elle se perd au milieu de douze
  // cases et l'on croit qu'il n'y en a pas pour les chambres.
  { champ: "remise", libelle: "Remise (%)", pas: "1", max: "100", classe: "a-part" },
];

// Les autres regimes ne sont pas des prix : ce sont des REDUCTIONS sur la
// pension complete. C'est ainsi qu'un hotel les annonce, et ca evite de
// ressaisir quatre prix quand le premier bouge.
const REDUCTIONS = [
  ["demi_pension_soir", "Demi-pension soir"],
  ["demi_pension_midi", "Demi-pension midi"],
  ["nuit_petit_dejeuner", "Nuit + petit-déjeuner"],
  ["nuit_seule", "Nuit seule"],
];

const REPAS_HORS = [
  ["petit_dejeuner", "Petit-déjeuner"],
  ["dejeuner", "Déjeuner"],
  ["diner", "Dîner"],
];

// Lundi = 0, comme dans la base.
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

let tarifs = { logements: [], tarifs: [], annexes: [], jours_weekend: [] };

const zoneGrilleTarifs = document.getElementById("grille-tarifs");
const zoneReductions = document.getElementById("grille-reductions");
const zoneRepas = document.getElementById("grille-repas");
const zoneRepasJour = document.getElementById("grille-repas-jour");
const choixJour = document.getElementById("repas-jour");
const zoneJours = document.getElementById("jours-weekend");
const messageTarifs = document.getElementById("message-tarifs");
const champVueMer = document.getElementById("tarif-vue-mer");
const champTaxe = document.getElementById("tarif-taxe-sejour");

// « Enfant » ne dit pas de quel age. Les bornes voyagent avec la grille :
// l'en-tete les montre, et personne n'a a se souvenir de ce que le mot
// recouvre cette annee.
function libelleTranche(tranche) {
  if (tranche === "bebe") return `Bébé (- de ${tarifs.age_bebe} ans)`;
  if (tranche === "enfant") return `Enfant (${tarifs.age_bebe} à ${tarifs.age_enfant})`;
  if (tranche === "jeune") return `Jeune (${tarifs.age_enfant} à ${tarifs.age_jeune})`;
  return `Adulte (${tarifs.age_jeune} ans et +)`;
}

function champNombre(valeur, options) {
  const champ = document.createElement("input");
  champ.type = "number";
  champ.min = "0";
  champ.step = options.pas || "0.5";
  if (options.max) champ.max = options.max;
  champ.value = valeur === null || valeur === undefined ? "0" : String(Number(valeur));
  // Un champ sans etiquette visible n'est rien pour un lecteur d'ecran :
  // une cellule de tableau ne se lit pas toute seule.
  champ.setAttribute("aria-label", options.aria);
  return champ;
}

function prixPose(logementId, tranche) {
  return (tarifs.tarifs || []).find(
    (t) => t.logement_id === logementId && t.tranche === tranche
  );
}

function annexePosee(cle, tranche) {
  return (tarifs.annexes || []).find(
    (a) => a.cle === cle && (a.tranche || "") === (tranche || "")
  );
}

// Un tableau : des colonnes, des lignes, et une case par croisement.
function tableauTarifs(titre, colonnes, lignes, cellule) {
  const table = document.createElement("table");
  table.className = "tarifs";

  const legende = document.createElement("caption");
  legende.textContent = titre;
  table.appendChild(legende);

  const tete = document.createElement("thead");
  const rangee = document.createElement("tr");
  rangee.appendChild(document.createElement("th"));
  for (const colonne of colonnes) {
    const th = document.createElement("th");
    th.textContent = colonne.libelle;
    rangee.appendChild(th);
  }
  tete.appendChild(rangee);
  table.appendChild(tete);

  const corps = document.createElement("tbody");
  for (const ligne of lignes) {
    const tr = document.createElement("tr");
    if (ligne.classe) tr.className = ligne.classe;
    const th = document.createElement("th");
    th.scope = "row";
    th.appendChild(span(ligne.libelle, "libelle-ligne"));

    // Une ligne se remplit souvent d'une seule valeur : toutes les
    // tranches au meme prix, ou la remise partout pareille. La fleche
    // recopie la PREMIERE case sur les autres -- elle ne devine rien,
    // elle repete.
    if (colonnes.length > 1) {
      const etendre = document.createElement("button");
      etendre.type = "button";
      etendre.className = "etendre";
      etendre.textContent = "→";
      etendre.title = `Recopier la première valeur sur toute la ligne « ${ligne.libelle} »`;
      etendre.setAttribute("aria-label", etendre.title);
      etendre.addEventListener("click", () => {
        const champs = [...tr.querySelectorAll("input")];
        for (const champ of champs.slice(1)) champ.value = champs[0].value;
      });
      th.appendChild(etendre);
    }
    tr.appendChild(th);
    for (const colonne of colonnes) {
      const td = document.createElement("td");
      td.appendChild(cellule(ligne, colonne, titre));
      tr.appendChild(td);
    }
    corps.appendChild(tr);
  }
  table.appendChild(corps);
  return table;
}

// « chambre de 2 », « gîte de 6 ». Sans « personnes » ni nombre
// d'exemplaires : le prix ne depend pas de la quantite, et le tableau se
// lit mieux sans ce qui ne le concerne pas. La capacite reste, elle :
// c'est elle qui distingue deux lignes d'inventaire.
function nommerTarif(logement) {
  const type = TYPES_LOGEMENT[typeDe(logement)];
  return `${type ? type.un : logement.categorie} de ${logement.capacite}`;
}

// Recopier un tableau sur les autres du meme type : quatre tailles de
// chambres ont souvent les memes prix, et les retaper quatre fois est le
// meilleur moyen de se tromper une fois.
function recopierTableau(source) {
  const meme = zoneGrilleTarifs.querySelectorAll(
    `table.tarifs[data-categorie="${source.dataset.categorie}"]`
  );
  let combien = 0;
  for (const autre of meme) {
    if (autre === source) continue;
    for (const champ of source.querySelectorAll("input[data-champ]")) {
      const cible = autre.querySelector(
        `input[data-tranche="${champ.dataset.tranche}"][data-champ="${champ.dataset.champ}"]`
      );
      if (cible) cible.value = champ.value;
    }
    combien += 1;
  }
  return combien;
}

// ---------------------------------------------- comment ca se facture
//
// LE MOT « CHAMBRE » DECIDAIT DE TROIS CHOSES A LA FOIS : on paie par
// personne, on ne paie pas le logement, et la nuit comprend les repas. Le
// mot « gite » decidait des trois autres. Il n'y avait que ces deux
// paquets, et un hotel qui fait payer la chambre ET la personne, sans
// pension, n'etait pas descriptible.
//
// Les trois questions se posent donc separement, et ICI plutot que dans
// l'inventaire : ce sont elles qui commandent les colonnes de prix du
// tableau juste en dessous, et voir la cause a cote de son effet vaut
// mieux que de les separer de deux onglets.

const PARTS_LOGEMENT = [
  ["aucune", "rien"],
  ["fixe", "un prix, divisé entre les occupants"],
  ["selon_occupation", "un prix par nombre d'occupants"],
];

const PARTS_PERSONNE = [
  ["aucune", "rien"],
  ["par_occupant", "selon la tranche d'âge"],
];

const REPAS_NUIT = [
  ["petit_dejeuner", "petit-déjeuner"],
  ["dejeuner", "déjeuner"],
  ["diner", "dîner"],
];

// Ce que valait la regle avant que ces colonnes existent. Elle sert de
// repli tant qu'une base n'a pas ete recollee -- la page ne doit pas
// changer de comportement en attendant.
function reglagesDe(logement) {
  const gite = logement.categorie === "gite";
  return {
    partLogement: logement.part_logement || (gite ? "fixe" : "aucune"),
    partPersonne: logement.part_personne || (gite ? "aucune" : "par_occupant"),
    compris: logement.repas_compris || (gite ? [] : REPAS_NUIT.map(([c]) => c)),
  };
}

// Les colonnes de prix DECOULENT des reponses : une colonne « le logement
// entier » s'il a un prix fixe, une par occupation s'il suit le nombre de
// dormeurs, les quatre tranches d'age s'il se paie par personne.
function colonnesDe(logement) {
  const { partLogement, partPersonne } = reglagesDe(logement);
  const colonnes = [];

  if (partLogement === "fixe") {
    colonnes.push({ cle: "entier", libelle: "Le logement entier" });
  } else if (partLogement === "selon_occupation") {
    for (let n = 1; n <= logement.capacite; n += 1) {
      colonnes.push({ cle: `entier_${n}`, libelle: `À ${n}` });
    }
  }
  if (partPersonne === "par_occupant") {
    colonnes.push(...TRANCHES.map((t) => ({ cle: t, libelle: libelleTranche(t) })));
  }
  return colonnes;
}

async function poserFacturation(logement, reglages) {
  messageTarifs.className = "";
  messageTarifs.textContent = "Enregistrement…";
  try {
    await rpc("admin_logement_facturation", {
      p_code: etat.code,
      p_id: logement.id,
      p_part_logement: reglages.partLogement,
      p_part_personne: reglages.partPersonne,
      p_repas_compris: reglages.compris,
    });
    // `rechargerTarifs` et non `rechargerLogements` : cette derniere ne
    // redessine la grille que si les TYPES ont change -- une garde qui
    // protege les prix en cours de saisie. Ici on VEUT la redessiner,
    // puisque ce sont ses colonnes qui viennent de changer.
    await rechargerTarifs();
    messageTarifs.className = "ok";
    messageTarifs.textContent =
      `${nommerTarif(logement)} : c'est noté. Les colonnes de prix ont suivi — ` +
      "relis-les avant d'enregistrer.";
  } catch (erreur) {
    messageTarifs.className = "erreur";
    messageTarifs.textContent = erreur.message;
    await rechargerTarifs();
  }
}

function listeReglage(titre, valeurs, choisi, quand) {
  const bloc = document.createElement("label");
  bloc.className = "reglage";
  bloc.append(titre);
  const choix = document.createElement("select");
  for (const [valeur, libelle] of valeurs) {
    const option = document.createElement("option");
    option.value = valeur;
    option.textContent = libelle;
    choix.appendChild(option);
  }
  choix.value = choisi;
  choix.addEventListener("change", () => quand(choix.value));
  bloc.appendChild(choix);
  return bloc;
}

function panneauFacturation(logement) {
  const reglages = reglagesDe(logement);

  const bloc = document.createElement("div");
  bloc.className = "facturation";
  bloc.dataset.logement = logement.id;

  bloc.appendChild(
    listeReglage("On paie le logement", PARTS_LOGEMENT, reglages.partLogement, (v) =>
      poserFacturation(logement, { ...reglages, partLogement: v })
    )
  );
  bloc.appendChild(
    listeReglage("On paie par personne", PARTS_PERSONNE, reglages.partPersonne, (v) =>
      poserFacturation(logement, { ...reglages, partPersonne: v })
    )
  );

  const compris = document.createElement("div");
  compris.className = "reglage repas-compris";
  compris.append("La nuit comprend");
  for (const [cle, libelle] of REPAS_NUIT) {
    const etiquette = document.createElement("label");
    etiquette.className = "interrupteur";
    const boite = document.createElement("input");
    boite.type = "checkbox";
    boite.checked = reglages.compris.includes(cle);
    boite.dataset.repas = cle;
    boite.setAttribute("aria-label", `${nommerTarif(logement)} — ${libelle} compris`);
    boite.addEventListener("change", () => {
      const garde = REPAS_NUIT.map(([c]) => c).filter((c) =>
        c === cle ? boite.checked : reglages.compris.includes(c)
      );
      poserFacturation(logement, { ...reglages, compris: garde });
    });
    etiquette.append(boite, ` ${libelle}`);
    compris.appendChild(etiquette);
  }
  bloc.appendChild(compris);

  return bloc;
}

function dessinerGrilleTarifs() {
  const logements = tarifs.logements || [];
  zoneGrilleTarifs.textContent = "";
  if (!logements.length) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent =
      "L'inventaire est vide : pose des chambres ou des gîtes dans l'onglet " +
      "Logements, et leurs prix apparaîtront ici — avec les colonnes que " +
      "leur façon de se facturer appelle.";
    zoneGrilleTarifs.appendChild(rien);
    return;
  }

  for (const logement of logements) {
    const colonnes = colonnesDe(logement);
    const titre = nommerTarif(logement);

    zoneGrilleTarifs.appendChild(panneauFacturation(logement));

    const table = tableauTarifs(titre, colonnes, LIGNES_PRIX, (ligne, colonne) => {
      const pose = prixPose(logement.id, colonne.cle);
      const champ = champNombre(pose ? pose[ligne.champ] : 0, {
        pas: ligne.pas,
        max: ligne.max,
        aria: `${titre} — ${colonne.libelle} — ${ligne.libelle}`,
      });
      champ.dataset.logement = logement.id;
      champ.dataset.tranche = colonne.cle;
      champ.dataset.champ = ligne.champ;
      return champ;
    });
    table.dataset.categorie = logement.categorie;
    zoneGrilleTarifs.appendChild(table);

    // Le bouton ne parait que s'il a quelque chose a recopier.
    const voisins = logements.filter(
      (autre) => autre.categorie === logement.categorie
    ).length;
    if (voisins > 1) {
      const bloc = document.createElement("div");
      bloc.className = "actions recopier";
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "discret";
      bouton.dataset.recopier = logement.id;
      bouton.textContent =
        logement.categorie === "gite"
          ? "Recopier ces prix sur les autres gîtes"
          : "Recopier ces prix sur les autres chambres";
      bouton.addEventListener("click", () => {
        const combien = recopierTableau(table);
        messageTarifs.className = "";
        messageTarifs.textContent = `Prix recopiés sur ${combien} autre(s) couchage(s) — pense à enregistrer.`;
      });
      bloc.appendChild(bouton);
      zoneGrilleTarifs.appendChild(bloc);
    }
  }
}

function dessinerAnnexes() {
  const vueMer = annexePosee("vue_mer", "");
  champVueMer.value = String(Number(vueMer ? vueMer.montant : 0));
  const taxe = annexePosee("taxe_sejour", "");
  champTaxe.value = String(Number(taxe ? taxe.montant : 0));

  zoneReductions.textContent = "";
  for (const [cle, libelle] of REDUCTIONS) {
    const bloc = document.createElement("div");
    const etiquette = document.createElement("label");
    etiquette.setAttribute("for", `reduction-${cle}`);
    etiquette.textContent = libelle;
    const pose = annexePosee(cle, "");
    const champ = champNombre(pose ? pose.montant : 0, {
      pas: "0.5",
      aria: `Réduction — ${libelle}`,
    });
    champ.id = `reduction-${cle}`;
    champ.dataset.cle = cle;
    champ.dataset.tranche = "";
    bloc.append(etiquette, champ);
    zoneReductions.appendChild(bloc);
  }

  // Trois repas, quatre tranches : un tableau plutot que douze champs en
  // colonne -- « le dejeuner d'un enfant » se lit alors d'un coup d'oeil.
  zoneRepas.textContent = "";
  zoneRepas.appendChild(
    tableauTarifs(
      "Hors pension",
      TRANCHES.map((t) => ({ cle: t, libelle: libelleTranche(t) })),
      REPAS_HORS.map(([cle, libelle]) => ({ cle, libelle })),
      (ligne, colonne) => {
        const pose = annexePosee(ligne.cle, colonne.cle);
        const champ = champNombre(pose ? pose.montant : 0, {
          pas: "0.5",
          aria: `${ligne.libelle} — ${colonne.libelle}`,
        });
        champ.dataset.cle = ligne.cle;
        champ.dataset.tranche = colonne.cle;
        return champ;
      }
    )
  );

  zoneJours.textContent = "";
  const choisis = new Set((tarifs.jours_weekend || []).map(Number));
  JOURS.forEach((nom, i) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = choisis.has(i) ? "pastille active" : "pastille";
    bouton.setAttribute("aria-pressed", choisis.has(i) ? "true" : "false");
    bouton.dataset.jour = String(i);
    bouton.textContent = nom;
    bouton.addEventListener("click", () => {
      const actif = bouton.getAttribute("aria-pressed") === "true";
      bouton.setAttribute("aria-pressed", actif ? "false" : "true");
      bouton.classList.toggle("active", !actif);
    });
    zoneJours.appendChild(bouton);
  });
}

// ---- Les jours qui font exception ----
//
// Un repas ne coute pas la meme chose tous les jours : le diner du samedi
// n'est pas celui du mardi. Le prix ORDINAIRE est au-dessus ; ici on ne
// pose que les jours qui s'en ecartent.
//
// Pourquoi pas une case par jour et par repas : huit jours, trois repas et
// quatre tranches font quatre-vingt-seize cases, pour les trois qui
// changent vraiment. On ajoute donc le jour, et son tableau part des prix
// ordinaires -- il n'y a qu'a corriger ce qui differe.

// « samedi 24 octobre » : on choisit un jour dans une semaine, le nom du
// jour fait autant pour s'y retrouver que le quantieme.
function afficherJourLong(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function joursExceptes() {
  return [...zoneRepasJour.querySelectorAll("table.tarifs")].map((t) => t.dataset.jour);
}

function remplirChoixJour() {
  const pris = new Set(joursExceptes());
  const libres = (tarifs.jours || []).filter((jour) => !pris.has(jour));
  choixJour.textContent = "";
  for (const jour of libres) {
    const option = document.createElement("option");
    option.value = jour;
    option.textContent = afficherJourLong(jour);
    choixJour.appendChild(option);
  }
  // Tous les jours du sejour sont deja personnalises : il n'y a plus rien
  // a ajouter, et un bouton qui ne peut rien faire doit le montrer.
  choixJour.disabled = !libres.length;
  document.getElementById("repas-jour-ajouter").disabled = !libres.length;
}

// Le prix ordinaire tel qu'il est A L'ECRAN, et non tel qu'il a ete
// enregistre : on vient peut-etre de le changer, et une exception qui
// partirait de l'ancien serait une surprise.
function prixOrdinaire(repas, tranche) {
  const champ = zoneRepas.querySelector(
    `input[data-cle="${repas}"][data-tranche="${tranche}"]`
  );
  return champ ? Number(champ.value) || 0 : 0;
}

function blocJourExcepte(jour, montant) {
  const bloc = document.createElement("div");

  const table = tableauTarifs(
    afficherJourLong(jour),
    TRANCHES.map((t) => ({ cle: t, libelle: libelleTranche(t) })),
    REPAS_HORS.map(([cle, libelle]) => ({ cle, libelle })),
    (ligne, colonne) => {
      const champ = champNombre(montant(ligne.cle, colonne.cle), {
        pas: "0.5",
        aria: `${afficherJourLong(jour)} — ${ligne.libelle} — ${colonne.libelle}`,
      });
      champ.dataset.repas = ligne.cle;
      champ.dataset.tranche = colonne.cle;
      return champ;
    }
  );
  table.dataset.jour = jour;
  bloc.appendChild(table);

  const retirer = document.createElement("button");
  retirer.type = "button";
  retirer.className = "retirer";
  retirer.textContent = "Retirer ce jour";
  // Retirer ne vide pas : le jour revient simplement au prix ordinaire.
  retirer.addEventListener("click", () => {
    bloc.remove();
    remplirChoixJour();
  });
  bloc.appendChild(retirer);

  return bloc;
}

function dessinerRepasJour() {
  zoneRepasJour.textContent = "";
  const poses = new Map();
  for (const ligne of tarifs.repas_jour || []) {
    if (!poses.has(ligne.jour)) poses.set(ligne.jour, new Map());
    poses.get(ligne.jour).set(`${ligne.repas}|${ligne.tranche}`, Number(ligne.montant));
  }
  for (const jour of [...poses.keys()].sort()) {
    const valeurs = poses.get(jour);
    zoneRepasJour.appendChild(
      blocJourExcepte(jour, (repas, tranche) => {
        const pose = valeurs.get(`${repas}|${tranche}`);
        return pose === undefined ? prixOrdinaire(repas, tranche) : pose;
      })
    );
  }
  remplirChoixJour();
}

document.getElementById("repas-jour-ajouter").addEventListener("click", () => {
  const jour = choixJour.value;
  if (!jour || joursExceptes().includes(jour)) return;
  zoneRepasJour.appendChild(blocJourExcepte(jour, prixOrdinaire));
  // Les jours restent dans l'ordre du sejour, quel que soit l'ordre ou on
  // les a ajoutes : un tableau qui saute d'octobre a juillet se relit mal.
  const blocs = [...zoneRepasJour.children].sort((a, b) =>
    a.querySelector("table").dataset.jour.localeCompare(
      b.querySelector("table").dataset.jour
    )
  );
  for (const bloc of blocs) zoneRepasJour.appendChild(bloc);
  remplirChoixJour();
});

function lireRepasJour() {
  const lignes = [];
  for (const table of zoneRepasJour.querySelectorAll("table.tarifs")) {
    for (const champ of table.querySelectorAll("input[data-repas]")) {
      lignes.push({
        jour: table.dataset.jour,
        repas: champ.dataset.repas,
        tranche: champ.dataset.tranche,
        montant: Number(champ.value) || 0,
      });
    }
  }
  return lignes;
}


// On relit le DOM plutot que de tenir un modele a jour a chaque frappe :
// les champs SONT le modele, et un modele parallele finit toujours par
// diverger de ce que l'organisateur a sous les yeux.
function lireGrilleTarifs() {
  const par = new Map();
  for (const champ of zoneGrilleTarifs.querySelectorAll("input[data-logement]")) {
    const clef = `${champ.dataset.logement}|${champ.dataset.tranche}`;
    if (!par.has(clef)) {
      par.set(clef, {
        logement_id: champ.dataset.logement,
        tranche: champ.dataset.tranche,
        semaine: 0,
        weekend: 0,
        remise: 0,
      });
    }
    par.get(clef)[champ.dataset.champ] = Number(champ.value) || 0;
  }
  return [...par.values()];
}

function lireAnnexes() {
  const lignes = [
    { cle: "vue_mer", tranche: "", montant: Number(champVueMer.value) || 0 },
    { cle: "taxe_sejour", tranche: "", montant: Number(champTaxe.value) || 0 },
  ];
  for (const champ of document.querySelectorAll(
    "#grille-reductions input[data-cle], #grille-repas input[data-cle]"
  )) {
    lignes.push({
      cle: champ.dataset.cle,
      tranche: champ.dataset.tranche || "",
      montant: Number(champ.value) || 0,
    });
  }
  return lignes;
}

async function rechargerTarifs() {
  tarifs = await rpc("admin_tarifs", { p_code: etat.code });
  tarifs.signature = (tarifs.logements || []).map((l) => l.id).sort().join(",");
  dessinerGrilleTarifs();
  dessinerAnnexes();
  // Apres les annexes : les exceptions partent des prix ordinaires, qui
  // viennent d'etre poses a l'ecran.
  dessinerRepasJour();
}

document.getElementById("tarifs-enregistrer").addEventListener("click", async () => {
  messageTarifs.className = "";
  messageTarifs.textContent = "Enregistrement…";
  try {
    const r = await rpc("admin_tarifs_enregistrer", {
      p_code: etat.code,
      p_grille: lireGrilleTarifs(),
      p_annexes: lireAnnexes(),
      p_jours: [...zoneJours.querySelectorAll('[aria-pressed="true"]')].map((b) =>
        Number(b.dataset.jour)
      ),
      p_repas_jour: lireRepasJour(),
    });
    await rechargerTarifs();
    messageTarifs.className = "ok";
    messageTarifs.textContent =
      `${r.tarifs} prix enregistré(s), ${r.annexes} réglage(s) annexe(s)` +
      (r.repas_jour ? `, ${r.repas_jour} repas personnalisé(s).` : ".");
  } catch (erreur) {
    messageTarifs.className = "erreur";
    messageTarifs.textContent = erreur.message;
  }
});


// ------------------------------------------------------------ facture
//
// Ce que chacun paie, une ligne par personne. Le calcul vit dans
// `facture.js` -- hors de la page, donc eprouvable sans navigateur, et
// compare au moteur Python par un test qui les veut d'accord au centime.
//
// La base ne rend que des FAITS : qui dort ou, qui mange quoi. Les prix
// viennent de la grille deja chargee pour l'onglet Tarifs -- celle qui
// est ENREGISTREE, pas celle qu'on est en train de taper a cote.

const zoneResume = document.getElementById("facture-resume");
const zoneNuits = document.getElementById("facture-hebergement");
const zoneRepasFacture = document.getElementById("facture-repas");
const alerteFacture = document.getElementById("alerte-facture");
const compteurFacture = document.getElementById("compteur-facture");
const zoneSynthese = document.getElementById("facture-synthese");
const compteurSynthese = document.getElementById("compteur-synthese");
const compteurNuits = document.getElementById("compteur-nuits");
const compteurRepas = document.getElementById("compteur-repas");
const messageFacture = document.getElementById("message-facture");

// LES TABLEAUX D'ARGENT SE DESSINENT AILLEURS, dans `tableaux.js`, parce
// que la famille lit les memes sur `facture.html`. Deux copies, et c'est
// deux formats qui divergent le jour ou l'un des deux gagne une colonne :
// celui qui demande l'argent et celui qui le paie ne liraient plus la
// meme chose.
//
// On les emprunte sous leur nom : les appels qui suivent ne disent pas
// d'ou vient un `euros()`, et n'ont pas a le dire.
const {
  euros,
  cellule,
  celluleEuros,
  quantieme,
  libelleNuit,
  libelleRepas,
  rienDire,
  tableau: tableauFacture,
  colonnes: COLONNES_FACTURE,
} = TABLEAUX;

const NOMS_REPAS = {
  petit_dejeuner: "Petit-déj.",
  dejeuner: "Déjeuner",
  diner: "Dîner",
};

function dessinerFacture(calcul) {
  const gens = new Map((etat.participants || []).map((p) => [p.id, p]));
  const arrondi = (v) => Math.round(v * 100) / 100;

  compteurFacture.textContent = calcul.lignes.length
    ? `${calcul.lignes.length} personne(s) — ${euros(calcul.total)} en tout` +
      (calcul.reductions ? `, après ${euros(calcul.reductions)} de réductions` : "")
    : "";

  // Ce qui rend le total faux se dit AVANT le total, et non en note de
  // bas de page : une somme qu'on lit sans savoir qu'elle est incomplete
  // est pire qu'une somme absente.
  alerteFacture.textContent = "";
  if (calcul.manquants.length) {
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent =
      `${calcul.manquants.length} prix manquant(s) ou à zéro : ` +
      `${calcul.manquants.join(", ")}. Le total est incomplet.`;
    alerteFacture.appendChild(p);
  }
  if (calcul.sansPlace.length) {
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent =
      `${calcul.sansPlace.length} nuit(s) en gîte sans place attribuée : ces ` +
      "nuits ne sont facturées à personne tant que le plan de couchage n'est pas fini.";
    alerteFacture.appendChild(p);
  }

  // LA TRANCHE D'AGE DECIDE DE TOUT : le prix de la nuit, celui des repas,
  // et si la taxe de sejour est due -- elle ne l'est que par les MAJEURS.
  // Or c'est la tranche ENREGISTREE qui facture, pas la date de naissance :
  // une tranche posee avant que « jeune » existe dit encore « adulte », et
  // fait payer la taxe a un garcon de quinze ans. On le dit ici, ou le
  // chiffre faux se lit.
  const factures = new Set(calcul.lignes.map((l) => l.personne_id));
  const concernes = (etat.participants || []).filter((p) => factures.has(p.id));
  const perimees = concernes.filter(
    (p) => p.categorie_attendue && p.categorie_attendue !== p.categorie_age
  );

  if (perimees.length) {
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent =
      `${perimees.length} personne(s) dont la tranche d'âge ne correspond plus ` +
      `à leur date de naissance (${perimees
        .slice(0, 6)
        .map((x) => x.prenom)
        .join(", ")}${perimees.length > 6 ? "…" : ""}) : leurs prix et leur ` +
      "taxe de séjour sont faux. « Recalculer les catégories », onglet Séjour.";
    alerteFacture.appendChild(p);
  }

  // --- le recapitulatif, en tete : ce que chacun doit
  if (!calcul.lignes.length) {
    rienDire(zoneResume, "Personne n'a encore déclaré de nuit ni de repas.");
  } else {
    zoneResume.textContent = "";
    zoneResume.appendChild(
      tableauFacture(
        COLONNES_FACTURE.resume({ reductions: calcul.reductions > 0 }),
        calcul.lignes,
        gens
      )
    );
  }

  dessinerReductions(calcul);

  // --- la synthese : la forme de la depense, et non son montant
  dessinerSynthese(calcul);

  // --- les nuits
  const dormeurs = calcul.lignes.filter((l) => l.nuits > 0);
  compteurNuits.textContent = dormeurs.length
    ? `${calcul.nuits.length} nuit(s) — ${euros(
        arrondi(dormeurs.reduce((t, l) => t + l.hebergement + l.taxe, 0))
      )}`
    : "";
  if (!dormeurs.length) {
    rienDire(zoneNuits, "Personne n'a déclaré dormir sur place : rien à facturer ici.");
  } else {
    zoneNuits.textContent = "";
    zoneNuits.appendChild(
      tableauFacture(COLONNES_FACTURE.nuits(calcul), dormeurs, gens)
    );
  }

  // --- les repas
  const mangeurs = calcul.lignes.filter((l) => Object.keys(l.parRepas).length);
  compteurRepas.textContent = mangeurs.length
    ? `${calcul.repasColonnes.length} repas — ${euros(
        arrondi(mangeurs.reduce((t, l) => t + l.repas, 0))
      )}`
    : "";
  if (!mangeurs.length) {
    rienDire(
      zoneRepasFacture,
      "Aucun repas hors pension : tout ce qui a été coché est compris dans une nuit."
    );
  } else {
    zoneRepasFacture.textContent = "";
    zoneRepasFacture.appendChild(
      tableauFacture(COLONNES_FACTURE.repas(calcul), mangeurs, gens)
    );
  }
}


function dessinerSynthese(calcul) {
  if (!calcul.lignes.length) {
    compteurSynthese.textContent = "";
    rienDire(zoneSynthese, "Rien de facturé : il n'y a pas de moyenne à faire.");
    return;
  }

  const series = FACTURE.synthese(calcul.lignes);
  const total = series.find((s) => s.cle === "total") || {};
  compteurSynthese.textContent = total.moyenne
    ? `${euros(total.moyenne)} par personne en moyenne`
    : "";

  zoneSynthese.textContent = "";
  zoneSynthese.appendChild(TABLEAUX.synthese(series, calcul.lignes.length));
}

async function rechargerFacture() {
  messageFacture.className = "";
  messageFacture.textContent = "Calcul…";
  try {
    const faits = await rpc("admin_faits", { p_code: etat.code });
    dessinerFacture(FACTURE.calculer(faits, tarifs));
    messageFacture.textContent = "";
  } catch (erreur) {
    messageFacture.className = "erreur";
    messageFacture.textContent = erreur.message;
  }
}


// --------------------------------------------------------- reductions
//
// Une reduction par personne, sur sa note entiere : en pourcentage ou en
// euros. Elle se pose ICI et nulle part ailleurs -- aucune fonction
// familiale n'ecrit ces colonnes. La famille la voit sur sa note.
//
// LE MONTANT N'EST PAS GARDE. La base retient le type et la valeur ; ce
// que cela retire se calcule a la lecture, comme le reste de la facture.
// « 10 % » d'une note qui change suit la note.

const choixReductionPersonne = document.getElementById("reduction-personne");
const choixReductionType = document.getElementById("reduction-type");
const champReductionValeur = document.getElementById("reduction-valeur");
const boutonReduction = document.getElementById("reduction-enregistrer");
const messageReduction = document.getElementById("message-reduction");
const zoneListeReductions = document.getElementById("liste-reductions");
const compteurReductions = document.getElementById("compteur-reductions");

function libelleReduction(personne) {
  const valeur = Number(personne.reduction_valeur) || 0;
  return personne.reduction_type === "pourcentage"
    ? `${String(valeur).replace(".", ",")} %`
    : euros(valeur);
}

function nomReduction(personne) {
  return personne.famille && personne.famille !== personne.prenom
    ? `${personne.prenom} (${personne.famille})`
    : personne.prenom;
}

// Choisir quelqu'un montre ce qu'il a deja : on corrige une reduction,
// on ne la ressaisit pas de memoire.
function remplirReduction() {
  const personne = (etat.participants || []).find(
    (p) => p.id === choixReductionPersonne.value
  );
  if (personne && personne.reduction_type) {
    choixReductionType.value = personne.reduction_type;
    champReductionValeur.value = Number(personne.reduction_valeur);
  } else {
    choixReductionType.value = "pourcentage";
    champReductionValeur.value = "";
  }
  champReductionValeur.disabled = !choixReductionType.value;
}

function dessinerReductions(calcul) {
  const gens = etat.participants || [];

  // La liste se refait a chaque calcul ; la personne choisie reste choisie.
  const garde = choixReductionPersonne.value;
  choixReductionPersonne.textContent = "";
  for (const personne of gens) {
    const option = document.createElement("option");
    option.value = personne.id;
    option.textContent = nomReduction(personne);
    choixReductionPersonne.appendChild(option);
  }
  if (gens.some((p) => p.id === garde)) choixReductionPersonne.value = garde;
  remplirReduction();

  const accordees = gens.filter((p) => p.reduction_type);
  compteurReductions.textContent = accordees.length
    ? `${accordees.length} personne(s) — ${euros(calcul.reductions)} en tout`
    : "";
  if (!accordees.length) {
    rienDire(zoneListeReductions, "Aucune réduction accordée.");
    return;
  }

  const parPersonne = new Map(calcul.lignes.map((l) => [l.personne_id, l]));
  const cadre = document.createElement("div");
  cadre.className = "tableau-large";
  const table = document.createElement("table");
  const tete = document.createElement("thead");
  const rangee = document.createElement("tr");
  for (const titre of ["Personne", "Réduction", "Retiré de sa note", ""]) {
    const th = document.createElement("th");
    th.textContent = titre;
    rangee.appendChild(th);
  }
  tete.appendChild(rangee);
  table.appendChild(tete);

  const corps = document.createElement("tbody");
  for (const personne of accordees) {
    const tr = document.createElement("tr");
    const nom = document.createElement("th");
    nom.scope = "row";
    nom.textContent = nomReduction(personne);
    tr.appendChild(nom);
    tr.appendChild(cellule(libelleReduction(personne)));
    // Sans note -- rien de declare -- il n'y a rien a retirer : la case
    // le dit d'un tiret, la reduction attend.
    const ligne = parPersonne.get(personne.id);
    tr.appendChild(celluleEuros(ligne ? ligne.reduction : 0));

    const td = document.createElement("td");
    const retirer = document.createElement("button");
    retirer.type = "button";
    retirer.className = "retirer";
    retirer.textContent = "Retirer";
    retirer.addEventListener("click", () => enregistrerReduction(personne, null, null));
    td.appendChild(retirer);
    tr.appendChild(td);
    corps.appendChild(tr);
  }
  table.appendChild(corps);
  cadre.appendChild(table);
  zoneListeReductions.textContent = "";
  zoneListeReductions.appendChild(cadre);
}

async function enregistrerReduction(personne, type, valeur) {
  messageReduction.className = "";
  messageReduction.textContent = "Enregistrement…";
  try {
    const r = await rpc("admin_reduction", {
      p_code: etat.code,
      p_id: personne.id,
      p_type: type,
      p_valeur: valeur,
    });
    // On reprend ce que la base a garde -- arrondi au centime -- et non
    // ce qu'on a tape.
    Object.assign(personne, r);
    messageReduction.className = "ok";
    messageReduction.textContent = type
      ? `Réduction de ${libelleReduction(personne)} pour ${personne.prenom}.`
      : `Plus de réduction pour ${personne.prenom}.`;
    await rechargerFacture();
  } catch (erreur) {
    messageReduction.className = "erreur";
    messageReduction.textContent = erreur.message;
  }
}

choixReductionPersonne.addEventListener("change", remplirReduction);
choixReductionType.addEventListener("change", () => {
  champReductionValeur.disabled = !choixReductionType.value;
});

boutonReduction.addEventListener("click", () => {
  const personne = (etat.participants || []).find(
    (p) => p.id === choixReductionPersonne.value
  );
  if (!personne) return;
  const type = choixReductionType.value || null;
  if (!type) {
    enregistrerReduction(personne, null, null);
    return;
  }
  // La base refuse aussi -- une page ne fait pas foi -- mais un refus
  // qu'on voit venir vaut mieux qu'un refus recu.
  const valeur = Number(String(champReductionValeur.value).replace(",", "."));
  if (!(valeur > 0) || (type === "pourcentage" && valeur > 100)) {
    messageReduction.className = "erreur";
    messageReduction.textContent = MESSAGES.REDUCTION_INVALIDE;
    champReductionValeur.focus();
    return;
  }
  enregistrerReduction(personne, type, valeur);
});


// -------------------------------------------------------------- hotel
//
// Ce qu'on envoie a l'hotel : des nombres de chambres et des nombres de
// couverts. AUCUN NOM -- l'hotel n'a pas besoin de savoir qui, et ce qui
// ne sort pas ne se perd pas.
//
// Rien de neuf en base : les faits (qui dort ou, qui mange quoi) et la
// liste des participants (tranche d'age, preferences) sont deja chargees
// pour la facture et pour la liste. On ne fait ici que compter.

const TRANCHES_HOTEL = [
  ["bebe", "Bébés"],
  ["enfant", "Enfants"],
  ["jeune", "Jeunes"],
  ["adulte", "Adultes"],
];

const PREFERENCES_HOTEL = [
  ["vegetarien", "Végétariens"],
  ["vegan", "Vegans"],
  ["sans_gluten", "Sans gluten"],
  ["non_buveur", "Sans alcool"],
];

const zoneHotelDetail = document.getElementById("hotel-detail");
const enteteHotel = document.getElementById("hotel-entete");
const compteurHotelDetail = document.getElementById("compteur-hotel-detail");
const zoneHotelCouchages = document.getElementById("hotel-couchages");
const zoneHotelCouverts = document.getElementById("hotel-couverts");
const alerteHotel = document.getElementById("alerte-hotel");
const compteurHotelNuits = document.getElementById("compteur-hotel-nuits");
const compteurHotelRepas = document.getElementById("compteur-hotel-repas");
const messageHotel = document.getElementById("message-hotel");

// Combien d'exemplaires de chaque type sont occupes, nuit par nuit.
//
// C'EST LE PLAN QUI COMPTE, et non l'inventaire -- qui dit ce qu'on
// pourrait prendre -- ni les souhaits, qui disent ce qu'on voudrait. Une
// chambre ou dort une seule personne compte pour une chambre : c'est la
// chambre qu'on reserve, pas le lit.
function couchagesParNuit(faits) {
  const parJour = new Map();
  for (const c of faits.couchages || []) {
    if (!parJour.has(c.jour)) parJour.set(c.jour, new Map());
    const parType = parJour.get(c.jour);
    if (!parType.has(c.logement_id)) parType.set(c.logement_id, new Set());
    parType.get(c.logement_id).add(c.numero);
  }
  return parJour;
}

// Qui dort sur place sans avoir de place attribuee : l'hotel compterait
// une chambre de moins.
function dormeursSansPlace(faits) {
  const places = new Set((faits.couchages || []).map((c) => `${c.participant_id}|${c.jour}`));
  return (faits.presences || []).filter(
    (p) => p.hebergement !== "exterieur" && !places.has(`${p.participant_id}|${p.jour}`)
  );
}

function couvertsParRepas(faits, gens) {
  const compte = new Map();
  for (const presence of faits.presences || []) {
    const personne = gens.get(presence.participant_id);
    if (!personne) continue;
    for (const [repas] of REPAS_HORS) {
      if (!presence[repas]) continue;
      const cle = `${presence.jour}|${repas}`;
      if (!compte.has(cle)) {
        compte.set(cle, { jour: presence.jour, repas, total: 0 });
        for (const [t] of TRANCHES_HOTEL) compte.get(cle)[t] = 0;
        for (const [p] of PREFERENCES_HOTEL) compte.get(cle)[p] = 0;
      }
      const ligne = compte.get(cle);
      ligne.total += 1;
      if (ligne[personne.categorie_age] !== undefined) ligne[personne.categorie_age] += 1;
      for (const [p] of PREFERENCES_HOTEL) if (personne[p]) ligne[p] += 1;
    }
  }
  const RANG = { petit_dejeuner: 0, dejeuner: 1, diner: 2 };
  return [...compte.values()].sort(
    (a, b) => a.jour.localeCompare(b.jour) || RANG[a.repas] - RANG[b.repas]
  );
}

// Un tableau de nombres : les zeros s'effacent, seuls les chiffres qui
// comptent restent a l'oeil.
function tableauHotel(colonnes, lignes) {
  const cadre = document.createElement("div");
  cadre.className = "tableau-large";
  const table = document.createElement("table");

  const tete = document.createElement("thead");
  const rangee = document.createElement("tr");
  for (const colonne of colonnes) {
    const th = document.createElement("th");
    th.textContent = colonne.libelle;
    rangee.appendChild(th);
  }
  tete.appendChild(rangee);
  table.appendChild(tete);

  const corps = document.createElement("tbody");
  const sommes = colonnes.map(() => 0);
  for (const ligne of lignes) {
    const tr = document.createElement("tr");
    colonnes.forEach((colonne, rang) => {
      if (rang === 0) {
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = colonne.valeur(ligne);
        tr.appendChild(th);
        return;
      }
      const valeur = colonne.valeur(ligne);
      sommes[rang] += valeur;
      const td = document.createElement("td");
      td.textContent = valeur ? String(valeur) : "—";
      if (!valeur) td.className = "rien";
      if (colonne.total) td.classList.add("total-personne");
      tr.appendChild(td);
    });
    corps.appendChild(tr);
  }
  table.appendChild(corps);

  const pied = document.createElement("tfoot");
  const totaux = document.createElement("tr");
  colonnes.forEach((colonne, rang) => {
    if (rang === 0) {
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = "TOTAL";
      totaux.appendChild(th);
      return;
    }
    const td = document.createElement("td");
    td.textContent = String(sommes[rang]);
    totaux.appendChild(td);
  });
  pied.appendChild(totaux);
  table.appendChild(pied);

  cadre.appendChild(table);
  return cadre;
}

// « 51 personnes du 24/10/2026 au 28/10/2026. Première prestation :
// déjeuner du 24. Dernière : déjeuner du 28. » Les trois lignes qu'un
// contrat porte en tete, et qu'on recopie sinon a la main.
function enteteDuSejour(faits, couverts) {
  const gens = new Set();
  let debut = null;
  let fin = null;
  for (const presence of faits.presences || []) {
    gens.add(presence.participant_id);
    if (!debut || presence.jour < debut) debut = presence.jour;
    if (!fin || presence.jour > fin) fin = presence.jour;
  }
  if (!gens.size) return "";

  const jour = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR");
  const dire = (l) => `${NOMS_REPAS[l.repas].toLowerCase()} du ${quantieme(l.jour)}`;
  const bornes = couverts.length
    ? ` Première prestation : ${dire(couverts[0])}. ` +
      `Dernière : ${dire(couverts[couverts.length - 1])}.`
    : "";
  return `${gens.size} personnes, du ${jour(debut)} au ${jour(fin)}.${bornes}`;
}

function dessinerDetail(prestations) {
  compteurHotelDetail.textContent = prestations.length
    ? `${prestations.length} ligne(s) — ${euros(
        Math.round(prestations.reduce((t, l) => t + l.montant, 0) * 100) / 100
      )}`
    : "";

  if (!prestations.length) {
    rienDire(zoneHotelDetail, "Rien à facturer : ni nuit, ni repas déclarés.");
    return;
  }

  const cadre = document.createElement("div");
  cadre.className = "tableau-large";
  const table = document.createElement("table");

  const tete = document.createElement("thead");
  const rangee = document.createElement("tr");
  for (const titre of ["Prestation", "Quantité", "Prix unitaire", "Remise", "Montant"]) {
    const th = document.createElement("th");
    th.textContent = titre;
    rangee.appendChild(th);
  }
  tete.appendChild(rangee);
  table.appendChild(tete);

  const corps = document.createElement("tbody");
  for (const ligne of prestations) {
    const tr = document.createElement("tr");
    const nom = document.createElement("th");
    nom.scope = "row";
    nom.textContent = ligne.libelle;
    tr.appendChild(nom);
    tr.appendChild(cellule(String(ligne.quantite)));
    tr.appendChild(celluleEuros(ligne.unitaire));
    tr.appendChild(cellule(ligne.remise ? `−${ligne.remise}\u00a0%` : "—",
                           ligne.remise ? "" : "rien"));
    tr.appendChild(celluleEuros(ligne.montant, "total-personne"));
    corps.appendChild(tr);
  }
  table.appendChild(corps);

  const pied = document.createElement("tfoot");
  const totaux = document.createElement("tr");
  const titre = document.createElement("th");
  titre.scope = "row";
  titre.textContent = "TOTAL";
  totaux.appendChild(titre);
  totaux.appendChild(cellule(""));
  totaux.appendChild(cellule(""));
  totaux.appendChild(cellule(""));
  totaux.appendChild(
    celluleEuros(
      Math.round(prestations.reduce((t, l) => t + l.montant, 0) * 100) / 100,
      "total-personne"
    )
  );
  pied.appendChild(totaux);
  table.appendChild(pied);

  cadre.appendChild(table);
  zoneHotelDetail.textContent = "";
  zoneHotelDetail.appendChild(cadre);
}

function dessinerHotel(faits) {
  const gens = new Map((etat.participants || []).map((p) => [p.id, p]));
  const logements = (tarifs.logements || []).slice();

  // --- les couchages
  const parNuit = couchagesParNuit(faits);
  const nuits = [...parNuit.keys()].sort();
  const utilises = logements.filter((l) =>
    nuits.some((j) => (parNuit.get(j).get(l.id) || new Set()).size)
  );

  const sansPlace = dormeursSansPlace(faits);
  alerteHotel.textContent = "";
  if (sansPlace.length) {
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent =
      `${sansPlace.length} nuit(s) déclarée(s) sans place attribuée : ces ` +
      "personnes ne sont comptées dans aucune chambre. Finis le plan de " +
      "couchage avant d'envoyer ces chiffres.";
    alerteHotel.appendChild(p);
  }

  compteurHotelNuits.textContent = nuits.length ? `${nuits.length} nuit(s)` : "";
  if (!nuits.length) {
    rienDire(
      zoneHotelCouchages,
      "Aucune place attribuée : le plan de couchage dira quelles chambres réserver."
    );
  } else {
    zoneHotelCouchages.textContent = "";
    zoneHotelCouchages.appendChild(
      tableauHotel(
        [
          { libelle: "Nuit du", valeur: (j) => libelleNuit(j).replace("Nuit du ", "") },
          ...utilises.map((l) => ({
            libelle: nommerTarif(l),
            valeur: (j) => (parNuit.get(j).get(l.id) || new Set()).size,
          })),
          {
            libelle: "Couchages",
            valeur: (j) =>
              [...parNuit.get(j).values()].reduce((t, u) => t + u.size, 0),
            total: true,
          },
          {
            libelle: "Dormeurs",
            valeur: (j) =>
              (faits.couchages || []).filter((c) => c.jour === j).length,
          },
        ],
        nuits
      )
    );
  }

  // --- le detail du sejour, et l'en-tete
  const calcul = FACTURE.calculer(faits, tarifs);
  dessinerDetail(calcul.prestations || []);

  // --- les couverts
  const couverts = couvertsParRepas(faits, gens);
  compteurHotelRepas.textContent = couverts.length
    ? `${couverts.reduce((t, l) => t + l.total, 0)} couvert(s)`
    : "";
  enteteHotel.textContent = enteteDuSejour(faits, couverts);

  if (!couverts.length) {
    rienDire(zoneHotelCouverts, "Aucun repas déclaré.");
  } else {
    zoneHotelCouverts.textContent = "";
    zoneHotelCouverts.appendChild(
      tableauHotel(
        [
          {
            libelle: "Repas",
            valeur: (l) => libelleRepas(l),
          },
          ...TRANCHES_HOTEL.map(([cle, libelle]) => ({
            libelle,
            valeur: (l) => l[cle],
          })),
          { libelle: "Couverts", valeur: (l) => l.total, total: true },
          ...PREFERENCES_HOTEL.map(([cle, libelle]) => ({
            libelle,
            valeur: (l) => l[cle],
          })),
        ],
        couverts
      )
    );
  }
}

async function rechargerHotel() {
  messageHotel.className = "";
  messageHotel.textContent = "Calcul…";
  try {
    dessinerHotel(await rpc("admin_faits", { p_code: etat.code }));
    messageHotel.textContent = "";
  } catch (erreur) {
    messageHotel.className = "erreur";
    messageHotel.textContent = erreur.message;
  }
}


// ---------------------------------------------------- plan de couchage
//
// Le plateau lui-meme vit dans `plan.js`, partage avec la page familiale :
// c'est le meme objet, et deux copies auraient fini par se contredire sur
// le couchage de quelqu'un. Ici on ne fournit que les deux portes --
// comment lire, comment ecrire -- et le bouton de report, qui n'appartient
// qu'a l'organisateur.

const plateau = PLAN.monter({
  plan: document.getElementById("plan"),
  nuits: document.getElementById("choix-nuit"),
  compteur: document.getElementById("compteur-couchages"),
  message: document.getElementById("message-couchages"),

  charger: (jour) => rpc("admin_couchages", { p_code: etat.code, p_jour: jour }),

  // `unite` nul = le tas : la personne n'a plus de place attribuee.
  ecrire: (personneId, unite) =>
    rpc("admin_couchage_placer", {
      p_code: etat.code,
      p_participant: personneId,
      p_jour: plateau.jour(),
      p_logement: unite ? unite.logement_id : null,
      p_numero: unite ? unite.numero : null,
    }),
});

const messageCouchages = document.getElementById("message-couchages");

// Le pointille dit que quelqu'un dort ailleurs que ce qu'il avait
// demande. Une fois l'arbitrage rendu, la declaration doit suivre : c'est
// elle qui facture, et un gite ne se facture pas comme une chambre.
document.getElementById("couchages-aligner").addEventListener("click", async () => {
  const jour = plateau.jour();
  if (
    !confirm(
      "Corriger les déclarations sur les places de cette nuit ?\n\nLes " +
        "personnes en pointillé verront leur choix remplacé par le couchage " +
        "où elles sont posées — c'est lui qui sera facturé. Les autres nuits " +
        "ne bougent pas. Une copie de sauvegarde est prise avant."
    )
  ) {
    return;
  }
  messageCouchages.className = "";
  messageCouchages.textContent = "Correction…";
  try {
    const r = await rpc("admin_presences_aligner", { p_code: etat.code, p_jour: jour });
    await plateau.recharger(jour);
    // La demande a change : le panneau qui compare l'offre et la demande
    // dirait le contraire de ce que le plan vient de montrer.
    await rechargerLogements();
    messageCouchages.className = "ok";
    messageCouchages.textContent = r.alignees
      ? `${r.alignees} déclaration(s) corrigée(s).`
      : "Rien à corriger : chacun dort dans ce qu'il avait demandé.";
  } catch (erreur) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = erreur.message;
  }
});


// Recommencer. Sans ce bouton, une repartition qu'on n'aime pas se
// deferait en soixante glissers -- autant dire qu'on la garderait.
document.getElementById("couchages-vider").addEventListener("click", async () => {
  const jour = plateau.jour();
  if (
    !confirm(
      "Vider le plan de cette nuit ?\n\nToutes les places attribuées sont " +
        "retirées et chacun revient « À placer ». Les autres nuits ne bougent " +
        "pas. Une copie de sauvegarde est prise avant."
    )
  ) {
    return;
  }
  messageCouchages.className = "";
  messageCouchages.textContent = "Vidage…";
  try {
    const r = await rpc("admin_couchages_vider", { p_code: etat.code, p_jour: jour });
    await plateau.recharger(jour);
    messageCouchages.className = "ok";
    messageCouchages.textContent = `${r.retirees} place(s) retirée(s) : tout est à replacer.`;
  } catch (erreur) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = erreur.message;
  }
});


// La repartition automatique. Le calcul vit dans `repartir.js` -- il se
// lit et s'essaie sans navigateur, ce qu'un algorithme merite ; ici on ne
// fait que l'amener a la page : relire le plan, lui soumettre, envoyer.
//
// On relit JUSTE AVANT de calculer plutot que de se fier a ce qui est
// affiche : la page a pu rester ouverte pendant qu'on posait des gens
// depuis un autre onglet, et repartir sur une image perimee rangerait
// deux personnes dans le meme lit.
document.getElementById("couchages-repartir").addEventListener("click", async () => {
  const jour = plateau.jour();
  messageCouchages.className = "";
  messageCouchages.textContent = "Répartition…";
  try {
    const plan = await rpc("admin_couchages", { p_code: etat.code, p_jour: jour });
    const r = REPARTIR.repartir(plan);

    if (!r.places.length) {
      // Ne rien avoir a poser n'est pas une erreur : c'est une reponse, et
      // elle differe selon qu'il reste du monde ou non.
      messageCouchages.textContent = r.restent
        ? `Personne n'a pu être placé : ${r.restent} en attente, faute de couchage libre du type demandé.`
        : "Tout le monde est déjà placé.";
      return;
    }

    const pose = await rpc("admin_couchages_poser", {
      p_code: etat.code,
      p_jour: jour,
      p_places: r.places,
    });
    await plateau.recharger(jour);
    messageCouchages.className = "ok";
    messageCouchages.textContent =
      `${pose.poses} personne(s) placée(s)` +
      (r.restent ? `, ${r.restent} encore à placer.` : ".");
  } catch (erreur) {
    messageCouchages.className = "erreur";
    messageCouchages.textContent = erreur.message;
  }
});


document.getElementById("couchages-reporter").addEventListener("click", async () => {
  const jour = plateau.jour();
  messageCouchages.className = "";
  messageCouchages.textContent = "Report…";
  try {
    const r = await rpc("admin_couchages_reporter", { p_code: etat.code, p_jour: jour });
    await plateau.recharger(jour);
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

async function rechargerLieux() {
  const d = await rpc("admin_lieux", { p_code: etat.code });
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
  // Les envies se comptent comme le reste : une ligne par personne et par
  // idee. Les « non » n'y sont pas -- ils ne s'ecrivent pas -- donc « 3 ->
  // 5 » se lit « trois idees retenues, puis cinq ».
  {
    clef: "envies",
    nom: "Activités",
    cle: ["participant_id", "activite_id"],
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

  // Une table apparue APRES la copie n'y figure pas, et le silence n'est
  // pas « il n'y avait rien » -- c'est le raisonnement tenu juste au-dessus
  // pour l'inventaire. Sans ce filtre, une copie d'avant les activites
  // annoncerait « quarante ajouts » pour des lignes qu'une restauration
  // laisserait en place.
  const tables = COMPARABLES.filter((def) => avant[def.clef] !== undefined).map((def) => {
    const r = comparerTable(avant[def.clef], apres[def.clef], def);
    for (const g of r.personnes) g.prenom = noms.get(g.pid) || "(inconnu)";
    // Le meme ordre que partout ailleurs. Qui n'est plus dans la liste --
    // une personne retiree depuis la sauvegarde -- passe en queue.
    const rang = new Map((etat.participants || []).map((p, i) => [p.id, i]));
    r.personnes.sort(
      (x, y) =>
        (rang.has(x.pid) ? rang.get(x.pid) : 1e9) -
          (rang.has(y.pid) ? rang.get(y.pid) : 1e9) ||
        x.prenom.localeCompare(y.prenom, "fr")
    );
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
  manuelle: "pris à la demande",
  avant_restauration: "pris avant un retour en arrière",
  compactage: "repli de l'historique",
};

// Les noms de tables ne sortent pas de la base : « refus_lieu » ne veut
// rien dire pour qui lit la page.
const NOMS_TABLES = {
  "public.presences": "présences",
  "public.voeux": "réponses aux week-ends",
  "public.refus_lieu": "refus de lieux",
  "private.participants": "participants",
  "private.options_date": "week-ends proposés",
  "private.logements": "logements",
  "private.couchages": "plan de couchage",
  "private.activites": "activités",
  "private.envies": "avis sur les activités",
  "private.tarifs": "tarifs",
  "private.tarifs_annexes": "suppléments et réductions",
  "private.tarifs_repas_jour": "repas qui font exception",
  "private.reglages": "réglages du séjour",
};

const champCompactage = document.getElementById("compactage-jours");
const champDepuis = document.getElementById("annuler-depuis");
const compteurRepli = document.getElementById("compteur-repli");

// Ce qu'on ne montre pas dans un changement : l'identifiant ne dit rien, et
// l'horodatage bouge a chaque enregistrement meme quand la valeur ne bouge
// pas -- l'afficher ferait croire a un changement partout.
const CHAMPS_MUETS = new Set(["id", "maj_le", "cree_le", "prise_le"]);

function afficherInstant(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Un resume quand la fonction n'a pas pose d'etiquette : « présences,
// plan de couchage » vaut mieux que rien, et dit deja de quoi il s'agit.
function resumerGeste(geste) {
  if (geste.quoi) return geste.quoi;
  const noms = Object.keys(geste.tables || {}).map((t) => NOMS_TABLES[t] || t);
  return noms.length ? noms.join(", ") : "aucune ligne touchée";
}

// « diner : non → oui ». Une ligne par champ qui a bouge, et rien pour les
// autres : un enregistrement touche quinze colonnes pour en changer une.
function champsChanges(avant, apres) {
  const clefs = new Set([
    ...Object.keys(avant || {}),
    ...Object.keys(apres || {}),
  ]);
  const changes = [];
  for (const c of [...clefs].sort()) {
    if (CHAMPS_MUETS.has(c)) continue;
    const a = avant ? avant[c] : undefined;
    const b = apres ? apres[c] : undefined;
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    changes.push({ champ: c, avant: a, apres: b });
  }
  return changes;
}

function direValeur(v) {
  if (v === null || v === undefined) return "—";
  if (v === true) return "oui";
  if (v === false) return "non";
  return String(v);
}

function ligneChangement(detail) {
  const bloc = document.createElement("p");
  bloc.className = "changement";

  const quoi = NOMS_TABLES[detail.table] || detail.table;
  bloc.append(span(quoi, "etiquette"));
  if (detail.prenom) bloc.append(" ", fort(detail.prenom));

  const changes = champsChanges(detail.avant, detail.apres);
  if (!detail.avant) {
    bloc.append(" ", span("ajouté", "champ"));
  } else if (!detail.apres) {
    bloc.append(" ", span("supprimé", "champ"));
  }

  for (const c of changes) {
    // Une ligne ajoutee ou supprimee : le detail de ses quinze colonnes
    // n'apprend rien, c'est la ligne entiere qui bouge.
    if (!detail.avant || !detail.apres) break;
    bloc.append(
      " ",
      span(`${NOMS_CHAMPS[c.champ] || c.champ} :`, "champ"),
      ` ${direValeur(c.avant)}`,
      span("→", "fleche"),
      `${direValeur(c.apres)}`
    );
  }
  return bloc;
}

async function montrerGeste(geste, pli) {
  if (pli.dataset.charge === "1") return;
  pli.dataset.charge = "1";
  const corps = document.createElement("div");
  corps.textContent = "Chargement…";
  pli.appendChild(corps);
  try {
    const lignes = await rpc("admin_geste_lire", { p_code: etat.code, p_id: geste.id });
    corps.textContent = "";
    if (!lignes.length) {
      const rien = document.createElement("p");
      rien.className = "note";
      rien.textContent = "Ce geste n'a touché aucune ligne.";
      corps.appendChild(rien);
      return;
    }
    for (const detail of lignes) corps.appendChild(ligneChangement(detail));
  } catch (erreur) {
    corps.textContent = erreur.message;
    corps.className = "erreur";
    pli.dataset.charge = "";
  }
}

function dessinerGeste(geste) {
  const pli = document.createElement("details");
  pli.className = "geste" + (geste.annule ? " annule" : "");
  pli.dataset.geste = geste.id;

  const resume = document.createElement("summary");
  resume.append(
    span(afficherInstant(geste.fait_le), "quand"),
    span(geste.qui, "etiquette"),
    span(resumerGeste(geste), "quoi"),
    span(`${geste.lignes} ligne(s)`, "lien")
  );
  if (geste.annule) resume.append(span("déjà annulé", "etiquette alerte"));
  if (geste.annule_id) resume.append(span("annulation", "etiquette"));
  pli.appendChild(resume);

  pli.addEventListener("toggle", () => {
    if (pli.open) montrerGeste(geste, pli);
  });

  if (!geste.annule && geste.lignes > 0) {
    const actions = document.createElement("div");
    actions.className = "actions";
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "discret";
    bouton.textContent = "Annuler ce geste";
    bouton.addEventListener("click", () => annulerGeste(geste));
    actions.appendChild(bouton);
    pli.appendChild(actions);
  }
  return pli;
}

function dessinerJalon(jalon) {
  const c = jalon.compteurs;
  const bloc = document.createElement("div");
  bloc.className = "jalon";

  const gauche = document.createElement("div");
  gauche.className = "jalon-quoi";
  gauche.append(
    fort(afficherInstant(jalon.fait_le)),
    span(MOTIFS[jalon.motif] || jalon.motif, "lien")
  );
  const etiquettes = span("", "etiquettes");
  etiquettes.append(
    span(`${c.participants} personnes`, "etiquette"),
    span(`${c.presences} jours`, "etiquette"),
    span(`${c.voeux} réponses`, "etiquette"),
    span(`${c.refus_lieu} refus`, "etiquette")
  );
  gauche.append(etiquettes);

  const comparer = document.createElement("button");
  comparer.type = "button";
  comparer.className = "discret";
  comparer.textContent = "Comparer";
  comparer.addEventListener("click", () => montrerComparaison(jalon));

  const restaurer_ = document.createElement("button");
  restaurer_.type = "button";
  restaurer_.className = "discret";
  restaurer_.textContent = "Restaurer";
  restaurer_.addEventListener("click", () => restaurer(jalon));

  // Le retrait est a part : c'est le seul des trois qui ne se defait pas.
  const retirer = document.createElement("button");
  retirer.type = "button";
  retirer.className = "retirer";
  retirer.textContent = "✕";
  retirer.title = `Supprimer le jalon du ${afficherInstant(jalon.fait_le)}`;
  retirer.setAttribute("aria-label", retirer.title);
  retirer.addEventListener("click", () => retirerJalon(jalon));

  bloc.append(gauche, comparer, restaurer_, retirer);
  return bloc;
}

// Supprimer un jalon ne se defait pas : il n'y a pas d'historique de
// l'historique. La question le dit, et dit aussi ce qu'on ne perd pas --
// les gestes restent, eux.
async function retirerJalon(jalon) {
  if (!confirm(`Supprimer le jalon du ${afficherInstant(jalon.fait_le)} ?\n\n` +
               "Cet état complet disparaît, et ce geste-là ne s'annule pas. " +
               "Les gestes de l'historique, eux, restent.")) {
    return;
  }

  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Suppression…";
  try {
    await rpc("admin_jalon_retirer", { p_code: etat.code, p_id: jalon.id });
    await rechargerSauvegardes();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent = "Jalon supprimé.";
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
}

async function rechargerSauvegardes() {
  const d = await rpc("admin_historique", { p_code: etat.code, p_limite: 200 });
  const gestes = d.gestes || [];
  const jalons = d.jalons || [];

  compteurSauvegardes.textContent = gestes.length
    ? `${gestes.length} geste(s), ${jalons.length} jalon(s)`
    : `aucun geste, ${jalons.length} jalon(s)`;

  champCompactage.value = String(d.compactage_jours ?? 60);
  compteurRepli.textContent = d.compactage_jours
    ? `repli automatique tous les ${d.compactage_jours} jours`
    : "repli automatique désactivé";

  zoneSauvegardes.textContent = "";
  zoneComparaison.textContent = "";

  if (!gestes.length && !jalons.length) {
    const vide = document.createElement("p");
    vide.className = "note";
    vide.textContent =
      "Rien pour l'instant. La première ligne apparaîtra à la première " +
      "modification, quelle qu'elle soit.";
    zoneSauvegardes.appendChild(vide);
    return;
  }

  // LES DEUX AU MEME FIL : un jalon est un point de l'histoire comme un
  // autre, et les separer obligerait a comparer deux listes de dates.
  const tout = [
    ...gestes.map((g) => ({ quand: g.fait_le, noeud: () => dessinerGeste(g) })),
    ...jalons.map((j) => ({ quand: j.fait_le, noeud: () => dessinerJalon(j) })),
  ].sort((a, b) => (a.quand < b.quand ? 1 : a.quand > b.quand ? -1 : 0));

  for (const ligne of tout) zoneSauvegardes.appendChild(ligne.noeud());
}

// Une ligne a bouge depuis : la base refuse plutot que d'ecraser le
// travail de quelqu'un sans le dire. On repose la question, une fois.
async function avecForce(appel, nom, question) {
  try {
    return await appel(false);
  } catch (erreur) {
    if (!/LIGNES_MODIFIEES/.test(erreur.message)) throw erreur;
    if (!confirm(question)) return null;
    return appel(true);
  }
}

async function annulerGeste(geste) {
  const quoi = resumerGeste(geste);
  if (!confirm(`Annuler « ${quoi} » du ${afficherInstant(geste.fait_le)} ?\n\n` +
               `${geste.lignes} ligne(s) reprennent leur état d'avant. Ce qui a été ` +
               `fait depuis reste en place, et cette annulation s'annule elle aussi.`)) {
    return;
  }

  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Annulation…";
  try {
    const r = await avecForce(
      (forcer) =>
        rpc("admin_geste_annuler", { p_code: etat.code, p_id: geste.id, p_forcer: forcer }),
      "geste",
      "Des lignes de ce geste ont changé depuis : les remettre en arrière " +
        "écraserait ce qui a été fait après.\n\nForcer quand même ?"
    );
    if (r === null) {
      messageSauvegardes.textContent = "";
      return;
    }
    await recharger();
    messageSauvegardes.className = "ok";
    // Trois sortes, et on ne nomme que celles qui ont servi : « 1 remise en
    // état » se lit, « 1 remise, 0 reposée, 0 effacée » se dechiffre.
    const faits = [
      [r.remises, "remise(s) en état"],
      [r.reposees, "reposée(s)"],
      [r.effacees, "effacée(s)"],
    ]
      .filter(([combien]) => combien)
      .map(([combien, mot]) => `${combien} ${mot}`);
    messageSauvegardes.textContent =
      `« ${quoi} » annulé : ${faits.join(", ") || "rien à reprendre"}.`;
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
}

document.getElementById("annuler-depuis-bouton").addEventListener("click", async () => {
  if (!champDepuis.value) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = "Choisis d'abord une date.";
    return;
  }
  const depuis = new Date(champDepuis.value);
  if (!confirm(`Annuler tout ce qui a été fait après le ${afficherInstant(depuis)} ?\n\n` +
               "Les gestes sont défaits du plus récent au plus ancien, en une " +
               "seule fois — et cette annulation s'annule elle aussi.")) {
    return;
  }

  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Annulation…";
  try {
    const r = await avecForce(
      (forcer) =>
        rpc("admin_annuler_depuis", {
          p_code: etat.code,
          p_depuis: depuis.toISOString(),
          p_forcer: forcer,
        }),
      "depuis",
      "Des lignes ont changé depuis : les remettre en arrière écraserait ce " +
        "qui a été fait après.\n\nForcer quand même ?"
    );
    if (r === null) {
      messageSauvegardes.textContent = "";
      return;
    }
    await recharger();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent = `${r.gestes} geste(s) annulé(s).`;
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
});

document.getElementById("compacter-maintenant").addEventListener("click", async () => {
  if (!confirm("Replier l'historique maintenant ?\n\nTous les gestes " +
               "disparaissent au profit d'un jalon — un état complet, qu'on " +
               "restaure d'un bloc mais qu'on ne détaille plus.")) {
    return;
  }
  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Repli…";
  try {
    const r = await rpc("admin_compacter", { p_code: etat.code });
    await rechargerSauvegardes();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent =
      `${r.gestes_replies} geste(s) repliés en un jalon.`;
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
  }
});

champCompactage.addEventListener("change", async () => {
  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Enregistrement…";
  try {
    await rpc("admin_compactage_regler", {
      p_code: etat.code,
      p_jours: Number(champCompactage.value) || 0,
    });
    await rechargerSauvegardes();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent = Number(champCompactage.value)
      ? `L'historique se repliera tous les ${Number(champCompactage.value)} jours.`
      : "L'historique ne se repliera plus tout seul.";
  } catch (erreur) {
    messageSauvegardes.className = "erreur";
    messageSauvegardes.textContent = erreur.message;
    await rechargerSauvegardes();
  }
});

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
  titre.textContent = `Ce qui a changé depuis le jalon du ${afficherInstant(copie.fait_le)}.`;
  zoneComparaison.appendChild(titre);

  if (d.identique) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = "Rien. La base est exactement dans l'état de ce jalon.";
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
      rpc("admin_jalon_lire", { p_code: etat.code, p_id: copie.id }),
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
    `Revenir au jalon du ${afficherInstant(copie.fait_le)} ?\n\n` +
    `Toute la base est remplacée : ${c.participants} participants, ` +
    `${c.presences} jours de présence, ${c.voeux} réponses de dates et ` +
    `${c.refus_lieu} refus de lieux reprennent leur état d'alors. Ce qui a ` +
    `été saisi depuis disparaît, ET L'HISTORIQUE DÉTAILLÉ AVEC — il décrirait ` +
    `des gestes posés sur un état qui n'existe plus.\n\n` +
    `Un jalon de l'état actuel est pris juste avant, pour que ce geste-ci ` +
    `soit lui aussi annulable.`;
  if (!confirm(question)) return;

  messageSauvegardes.className = "";
  messageSauvegardes.textContent = "Restauration…";
  try {
    const r = await rpc("admin_jalon_restaurer", {
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
    await rpc("admin_jalon_prendre", { p_code: etat.code });
    await rechargerSauvegardes();
    messageSauvegardes.className = "ok";
    messageSauvegardes.textContent = "Jalon pris.";
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
  remplirAges(d);
  // Les quatre verrous arrivent avec le sejour : ils se tournent dans le
  // meme onglet, ils se lisent dans le meme appel.
  etat.ouvertures = d.ouvertures || {};
  dessinerOuvertures();
  resumeSejour.textContent =
    `${d.jours} jour(s), ${d.presences} journée(s) saisie(s)`;
  direHorsSejour(d.presences_hors);
}

// ------------------------------------------------------------ les ages
//
// Deux bornes, et un bouton qui refait les categories.
//
// `categorie_age` reste ce qui FACTURE : c'est elle que lit la vue d'export
// et le moteur de tarifs. La date de naissance ne la remplace pas, elle la
// PROPOSE -- et le recalcul dit ce qu'il change avant de le garder, parce
// qu'une categorie posee a la main a ses raisons.

const champAgeBebe = document.getElementById("age-bebe");
const champAgeEnfant = document.getElementById("age-enfant");
const champAgeJeune = document.getElementById("age-jeune");
const resumeAges = document.getElementById("resume-ages");
const messageAges = document.getElementById("message-ages");
const rapportAges = document.getElementById("rapport-ages");

function remplirAges(d) {
  champAgeBebe.value = d.age_bebe;
  champAgeEnfant.value = d.age_enfant;
  champAgeJeune.value = d.age_jeune;
  resumeAges.textContent = d.sans_naissance
    ? `${d.sans_naissance} personne(s) sans date de naissance`
    : "toutes les dates de naissance sont connues";
}

document.getElementById("ages-enregistrer").addEventListener("click", async () => {
  messageAges.className = "";
  messageAges.textContent = "Enregistrement…";
  try {
    const d = await rpc("admin_sejour_ages", {
      p_code: etat.code,
      p_bebe: Number(champAgeBebe.value),
      p_enfant: Number(champAgeEnfant.value),
      p_jeune: Number(champAgeJeune.value),
    });
    await recharger();
    messageAges.className = "ok";
    messageAges.textContent =
      `Bébé avant ${d.age_bebe} ans, enfant avant ${d.age_enfant}, ` +
      `jeune avant ${d.age_jeune}. Les catégories déjà posées n'ont pas bougé.`;
  } catch (erreur) {
    messageAges.className = "erreur";
    messageAges.textContent = erreur.message;
  }
});

document.getElementById("ages-recalculer").addEventListener("click", async () => {
  messageAges.className = "";
  messageAges.textContent = "Calcul…";
  rapportAges.textContent = "";
  try {
    const d = await rpc("admin_ages_recalculer", { p_code: etat.code });
    await recharger();
    messageAges.className = "ok";
    // La date en tete, et non a la fin : `afficherJour` rend « 24 oct. »,
    // point compris, et la phrase se terminerait par deux points.
    messageAges.textContent = d.changes.length
      ? `Au ${afficherJour(d.jour)} : ${d.changes.length} catégorie(s) corrigée(s).`
      : `Au ${afficherJour(d.jour)} : rien à corriger, tout concorde.`;

    // Le detail, personne par personne. Sans lui, « 7 corrigees » ne dit pas
    // si l'on vient d'ecraser un reglage voulu.
    for (const c of d.changes) {
      rapportAges.appendChild(
        ligneDiff(AGES[c.apres], `${c.prenom} — ${c.age} ans, était ${AGES[c.avant]}`)
      );
    }
    if (d.sans_date) {
      const reste = document.createElement("p");
      reste.className = "note";
      reste.textContent =
        `${d.sans_date} personne(s) n'ont pas de date de naissance : leur ` +
        `catégorie n'a pas été touchée.`;
      rapportAges.appendChild(reste);
    }
  } catch (erreur) {
    messageAges.className = "erreur";
    messageAges.textContent = erreur.message;
  }
});

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

// Les quatre verrous se tournent dans le panneau « Ce qui est ouvert a
// la famille », plus haut dans cet onglet.

// Derniere ligne du fichier : tout ce qui precede s'est cable sans
// broncher. Ce qui cassera desormais est un vrai defaut, et la
// banniere du cache n'a plus lieu d'etre.
cablageTermine = true;
