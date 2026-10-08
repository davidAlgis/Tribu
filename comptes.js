"use strict";

// Les comptes de tout le monde : ce que les onglets Facture et Hotel
// montrent a l'organisateur, pour qui a recu l'adresse de cette page et
// connait le code famille.
//
// CE FICHIER NE CALCULE NI NE DESSINE RIEN. Les montants viennent de
// `facture.js`, les tableaux de `tableaux.js` et `hotel.js` -- les memes
// que l'organisateur -- et les fichiers de `classeur.js`. Il ne reste ici
// que le branchement : le code, l'appel, les onglets, et la lecture des
// tableaux affiches pour les exporter.
//
// RIEN NE S'ECRIT EN BASE. La page lit, et telecharge.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
  REGLAGES_ABSENTS: "Les dates du séjour ne sont pas encore posées.",
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

// Le code est partage avec les autres pages : entre une fois, entre
// partout -- ici aussi.
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
    const donnees = await rpc("comptes_charger", { p_code: code });
    ecrireMemoire(code);
    messageCode.textContent = "";
    montrer("etape-comptes");
    dessiner(FACTURE.calculer(donnees.faits, donnees.grille), donnees.faits);
    HOTEL.dessiner(zonesHotel, donnees.faits, donnees.grille);
    majExports();
  } catch (erreur) {
    messageCode.className = "erreur";
    messageCode.textContent = erreur.message;
    champCode.select();
  }
});

// ------------------------------------------------------------- etape 2

const zoneResume = document.getElementById("facture-resume");
const zoneSynthese = document.getElementById("facture-synthese");
const zoneNuits = document.getElementById("facture-hebergement");
const zoneRepas = document.getElementById("facture-repas");
const alerteFacture = document.getElementById("alerte-facture");

const { rienDire, tableau, colonnes } = TABLEAUX;

function alerter(texte) {
  const p = document.createElement("p");
  p.className = "erreur";
  p.textContent = texte;
  alerteFacture.appendChild(p);
}

function dessiner(calcul, faits) {
  const gens = new Map((faits.personnes || []).map((p) => [p.id, p]));

  // Ce qui rend le total faux se dit AVANT le total. Le lecteur n'a rien
  // pour le corriger : on lui dit seulement de ne pas s'y fier encore.
  alerteFacture.textContent = "";
  if (calcul.manquants.length) {
    alerter(
      "Tous les prix ne sont pas encore posés : ces totaux sont provisoires, " +
        "et plus bas que ce qu'ils seront."
    );
  }
  if (calcul.sansPlace.length) {
    alerter(
      `${calcul.sansPlace.length} nuit(s) en gîte sans place attribuée : tant ` +
        "que le plan de couchage n'est pas fini, elles ne sont comptées à " +
        "personne, et ces totaux sont incomplets."
    );
  }

  if (!calcul.lignes.length) {
    rienDire(zoneResume, "Personne n'a encore déclaré de nuit ni de repas.");
    rienDire(zoneSynthese, "Rien de compté : il n'y a pas de moyenne à faire.");
    rienDire(zoneNuits, "Aucune nuit déclarée.");
    rienDire(zoneRepas, "Aucun repas déclaré.");
    return;
  }

  // --- le recapitulatif, avec ses rapports : on compare des sejours de
  // longueurs differentes, comme l'organisateur.
  zoneResume.textContent = "";
  zoneResume.appendChild(
    tableau(
      colonnes.resume({ ajustements: calcul.lignes.some((l) => l.ajustement) }),
      calcul.lignes,
      gens
    )
  );

  // --- la synthese
  const series = FACTURE.synthese(calcul.lignes);
  zoneSynthese.textContent = "";
  zoneSynthese.appendChild(TABLEAUX.synthese(series, calcul.lignes.length));

  // --- les nuits
  const dormeurs = calcul.lignes.filter((l) => l.nuits > 0);
  if (!dormeurs.length) {
    rienDire(zoneNuits, "Personne n'a déclaré dormir sur place.");
  } else {
    zoneNuits.textContent = "";
    zoneNuits.appendChild(tableau(colonnes.nuits(calcul), dormeurs, gens));
  }

  // --- les repas hors pension
  const mangeurs = calcul.lignes.filter((l) => Object.keys(l.parRepas).length);
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

// ---------------------------------------------------------------- hotel

const zonesHotel = {
  alerte: document.getElementById("alerte-hotel"),
  entete: document.getElementById("hotel-entete"),
  detail: document.getElementById("hotel-detail"),
  couchages: document.getElementById("hotel-couchages"),
  couverts: document.getElementById("hotel-couverts"),
};

// ---------------------------------------------------------------- onglets
//
// Le meme motif que la page de l'organisateur : un seul volet ouvert, les
// fleches passent de l'un a l'autre.

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

// ---------------------------------------------------------------- exports
//
// ON EXPORTE CE QUI EST AFFICHE, case par case : le fichier dit exactement
// ce que la page dit, sous-totaux de famille compris. Un montant redevient
// un nombre -- « 12,50 € » s'additionne dans Excel, pas son texte -- et un
// tiret, qui veut dire « rien », laisse la case vide.

function valeurDe(texte) {
  const propre = texte.replace(/[\u00a0\u202f]/g, " ").trim();
  if (propre === "" || propre === "—") return null;
  const nombre = propre.match(/^([+\-−]?)(\d[\d ]*)(?:,(\d+))?(?: €)?$/);
  if (!nombre) return propre;
  const valeur = Number(nombre[2].replace(/ /g, "") + (nombre[3] ? `.${nombre[3]}` : ""));
  return nombre[1] === "-" || nombre[1] === "−" ? -valeur : valeur;
}

function lignesDe(table) {
  return [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((c, rang) =>
      // La premiere colonne nomme la ligne : on la garde en texte, meme
      // quand c'est un nombre.
      rang === 0 ? c.textContent.trim() : valeurDe(c.textContent)
    )
  );
}

function tableDe(zone) {
  return zone.querySelector("table");
}

// « Ce que chacun paie » -> « ce-que-chacun-paie » : un nom de fichier sans
// accent ni espace passe partout.
function nomDeFichier(texte) {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function telecharger(contenu, nom, type) {
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([contenu], { type }));
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function exporterZone(zone, format) {
  const table = tableDe(zone);
  if (!table) return;
  const feuille = zone.dataset.feuille || "Tableau";
  const lignes = lignesDe(table);
  if (format === "csv") {
    telecharger(CLASSEUR.csv(lignes), `tribu-${nomDeFichier(feuille)}.csv`, "text/csv;charset=utf-8");
  } else {
    telecharger(
      CLASSEUR.xlsx([{ nom: feuille, lignes }]),
      `tribu-${nomDeFichier(feuille)}.xlsx`,
      XLSX_TYPE
    );
  }
}

// Tous les tableaux d'un onglet, une feuille chacun, dans l'ordre de la page.
function exporterVolet(volet, fichier) {
  const feuilles = [...volet.querySelectorAll("[data-feuille]")]
    .filter((zone) => tableDe(zone))
    .map((zone) => ({ nom: zone.dataset.feuille, lignes: lignesDe(tableDe(zone)) }));
  if (!feuilles.length) return;
  telecharger(CLASSEUR.xlsx(feuilles), `tribu-${fichier}.xlsx`, XLSX_TYPE);
}

// Un bouton qui ne peut rien exporter -- rien de declare, donc pas de
// tableau -- le montre au lieu de produire un fichier vide.
function majExports() {
  for (const bouton of document.querySelectorAll("[data-exporter]")) {
    bouton.disabled = !tableDe(document.getElementById(bouton.dataset.exporter));
  }
  for (const bouton of document.querySelectorAll("[data-tout]")) {
    bouton.disabled = ![...document.getElementById(bouton.dataset.tout)
      .querySelectorAll("[data-feuille]")].some((zone) => tableDe(zone));
  }
}

document.addEventListener("click", (e) => {
  const un = e.target.closest("[data-exporter]");
  if (un) {
    exporterZone(document.getElementById(un.dataset.exporter), un.dataset.format);
    return;
  }
  const tout = e.target.closest("[data-tout]");
  if (tout) exporterVolet(document.getElementById(tout.dataset.tout), tout.dataset.fichier);
});

// ---------------------------------------------------------------- etapes

const fil = document.getElementById("fil");

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
  fil.hidden = id === "etape-code";
}

// Le code est deja connu de cet appareil : on saute l'etape, comme
// partout ailleurs.
if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
