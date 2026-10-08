"use strict";

// Les comptes de tout le monde : ce que l'onglet Facture montre a
// l'organisateur, pour qui a recu l'adresse de cette page et connait le
// code famille.
//
// CE FICHIER NE CALCULE NI NE DESSINE RIEN. Les montants viennent de
// `facture.js`, les tableaux de `tableaux.js` -- les memes que l'onglet
// Facture. Il ne reste ici que le branchement : le code, l'appel, et
// l'ordre des panneaux.
//
// RIEN NE S'ECRIT. La page lit.

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
const compteurFacture = document.getElementById("compteur-facture");
const compteurSynthese = document.getElementById("compteur-synthese");
const compteurNuits = document.getElementById("compteur-nuits");
const compteurRepas = document.getElementById("compteur-repas");

const { euros, rienDire, tableau, colonnes } = TABLEAUX;
const arrondi = (v) => Math.round(v * 100) / 100;

function alerter(texte) {
  const p = document.createElement("p");
  p.className = "erreur";
  p.textContent = texte;
  alerteFacture.appendChild(p);
}

function dessiner(calcul, faits) {
  const gens = new Map((faits.personnes || []).map((p) => [p.id, p]));

  compteurFacture.textContent = calcul.lignes.length
    ? `${calcul.lignes.length} personne(s) — ${euros(calcul.total)} en tout` +
      (calcul.reductions ? `, après ${euros(calcul.reductions)} de réductions` : "")
    : "";

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
    compteurSynthese.textContent = "";
    compteurNuits.textContent = "";
    compteurRepas.textContent = "";
    return;
  }

  // --- le recapitulatif, avec ses rapports : on compare des sejours de
  // longueurs differentes, comme l'organisateur.
  zoneResume.textContent = "";
  zoneResume.appendChild(
    tableau(colonnes.resume({ reductions: calcul.reductions > 0 }), calcul.lignes, gens)
  );

  // --- la synthese
  const series = FACTURE.synthese(calcul.lignes);
  const total = series.find((s) => s.cle === "total") || {};
  compteurSynthese.textContent = total.moyenne
    ? `${euros(total.moyenne)} par personne en moyenne`
    : "";
  zoneSynthese.textContent = "";
  zoneSynthese.appendChild(TABLEAUX.synthese(series, calcul.lignes.length));

  // --- les nuits
  const dormeurs = calcul.lignes.filter((l) => l.nuits > 0);
  compteurNuits.textContent = dormeurs.length
    ? `${calcul.nuits.length} nuit(s) — ${euros(
        arrondi(dormeurs.reduce((t, l) => t + l.hebergement + l.taxe, 0))
      )}`
    : "";
  if (!dormeurs.length) {
    rienDire(zoneNuits, "Personne n'a déclaré dormir sur place.");
  } else {
    zoneNuits.textContent = "";
    zoneNuits.appendChild(tableau(colonnes.nuits(calcul), dormeurs, gens));
  }

  // --- les repas hors pension
  const mangeurs = calcul.lignes.filter((l) => Object.keys(l.parRepas).length);
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
