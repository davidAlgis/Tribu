"use strict";

// Le formulaire n'envoie que des FAITS : ou je dors, quels repas je prends.
// Aucun regime, aucun tarif, aucun total n'est calcule ici. C'est le role
// du Python. Le jour ou une regle de l'hotel change, ce fichier ne bouge pas.

const { SUPABASE_URL, SUPABASE_ANON_KEY, DATE_DEBUT, DATE_FIN } = window.CONFIG;

const REPAS = ["petit_dejeuner", "dejeuner", "diner"];

// Surtout pas toISOString() ici : il convertit minuit local en UTC, ce qui
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
    weekday: "long", day: "numeric", month: "long",
  });
}

const jours = listerJours(DATE_DEBUT, DATE_FIN);
const corps = document.getElementById("jours");

for (const jour of jours) {
  const ligne = document.createElement("tr");
  ligne.dataset.jour = jour;

  const cellule = document.createElement("td");
  cellule.textContent = afficherJour(jour);
  ligne.appendChild(cellule);

  const cChoix = document.createElement("td");
  const choix = document.createElement("select");
  choix.dataset.champ = "hebergement";
  for (const [valeur, libelle] of [
    ["exterieur", "ailleurs"],
    ["chambre", "en chambre"],
    ["gite", "en gîte"],
  ]) {
    choix.add(new Option(libelle, valeur));
  }
  cChoix.appendChild(choix);
  ligne.appendChild(cChoix);

  for (const champ of ["vue_mer", ...REPAS]) {
    const cCase = document.createElement("td");
    const caseACocher = document.createElement("input");
    caseACocher.type = "checkbox";
    caseACocher.dataset.champ = champ;
    caseACocher.setAttribute("aria-label", `${champ} du ${jour}`);
    cCase.appendChild(caseACocher);
    ligne.appendChild(cCase);
  }

  // Le supplement vue mer n'a de sens qu'en chambre.
  const vueMer = ligne.querySelector('[data-champ="vue_mer"]');
  const majVueMer = () => {
    vueMer.disabled = choix.value !== "chambre";
    if (vueMer.disabled) vueMer.checked = false;
  };
  choix.addEventListener("change", majVueMer);
  majVueMer();

  corps.appendChild(ligne);
}

function lireLignes(personneId) {
  const presences = [];
  for (const ligne of corps.querySelectorAll("tr")) {
    const valeur = (champ) => ligne.querySelector(`[data-champ="${champ}"]`);
    const hebergement = valeur("hebergement").value;
    const repas = Object.fromEntries(REPAS.map((r) => [r, valeur(r).checked]));

    // Une journee ou l'on ne dort pas sur place et ou l'on ne mange pas
    // n'est pas une information : on ne l'envoie pas.
    if (hebergement === "exterieur" && !Object.values(repas).some(Boolean)) continue;

    presences.push({
      id: crypto.randomUUID(),
      personne_id: personneId,
      jour: ligne.dataset.jour,
      hebergement,
      vue_mer: valeur("vue_mer").checked,
      ...repas,
    });
  }
  return presences;
}

async function inserer(table, lignes) {
  const reponse = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      // La cle anon n'a pas le droit de lire : on demande a Postgres
      // de ne rien renvoyer, sinon l'insertion serait refusee par le RLS.
      Prefer: "return=minimal",
    },
    body: JSON.stringify(lignes),
  });
  if (!reponse.ok) throw new Error(`${table} : ${reponse.status} ${await reponse.text()}`);
}

const message = document.getElementById("message");
const bouton = document.getElementById("envoyer");

document.getElementById("formulaire").addEventListener("submit", async (evenement) => {
  evenement.preventDefault();

  const personne = {
    id: crypto.randomUUID(),
    nom: document.getElementById("nom").value.trim(),
    famille: document.getElementById("famille").value.trim(),
    categorie_age: document.getElementById("categorie_age").value,
  };

  const presences = lireLignes(personne.id);
  if (presences.length === 0) {
    message.className = "erreur";
    message.textContent = "Rien à envoyer : indique au moins une nuit ou un repas.";
    return;
  }

  bouton.disabled = true;
  message.className = "";
  message.textContent = "Envoi…";

  try {
    await inserer("personnes", [personne]);
    await inserer("presences", presences);
    message.className = "ok";
    message.textContent = `Merci ${personne.nom} ! ${presences.length} jour(s) enregistré(s).`;
  } catch (erreur) {
    message.className = "erreur";
    message.textContent = `Échec de l'envoi : ${erreur.message}`;
    bouton.disabled = false;
  }
});
