"use strict";

// Ce qu'on envoie a l'hotel, dessine une seule fois pour deux pages :
// l'onglet Hotel de l'organisateur, et la page des comptes.
//
// Des nombres de chambres et des nombres de couverts. AUCUN NOM -- l'hotel
// n'a pas besoin de savoir qui, et ce qui ne sort pas ne se perd pas.
//
// LES COUVERTS VIENNENT TOUT COMPTES DE LA BASE (`faits.couverts`). Ils
// demandent les preferences alimentaires de chacun, que la page des
// comptes -- ouverte avec le seul code famille -- n'a pas a recevoir une
// par une : la base les additionne, et les deux pages lisent la meme
// addition.
//
// CE MODULE NE CALCULE PAS L'ARGENT. Le detail du sejour vient de
// `facture.js`, comme la facture ; ici on met en page.

window.HOTEL = (function () {
  const { cellule, celluleEuros, quantieme, libelleNuit, libelleRepas, rienDire } =
    window.TABLEAUX;

  const TRANCHES = [
    ["bebe", "Bébés"],
    ["enfant", "Enfants"],
    ["jeune", "Jeunes"],
    ["adulte", "Adultes"],
  ];

  const PREFERENCES = [
    ["vegetarien", "Végétariens"],
    ["vegan", "Vegans"],
    ["sans_gluten", "Sans gluten"],
    ["non_buveur", "Sans alcool"],
  ];

  const NOMS_REPAS = {
    petit_dejeuner: "Petit-déj.",
    dejeuner: "Déjeuner",
    diner: "Dîner",
  };

  // La base ecrit « gite » sans accent -- c'est une clef, pas un mot.
  const NOMS_COUCHAGE = { chambre: "chambre", gite: "gîte" };

  function nommerType(logement) {
    return `${NOMS_COUCHAGE[logement.categorie] || logement.categorie} de ${logement.capacite}`;
  }

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

  // Un tableau de nombres : les zeros s'effacent, seuls les chiffres qui
  // comptent restent a l'oeil.
  function tableau(colonnes, lignes) {
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
  function entete(faits, couverts) {
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

  // Le meme argent que la facture, regroupe par prestation : la forme d'un
  // contrat d'hotel.
  function tableauDetail(prestations) {
    const somme = Math.round(prestations.reduce((t, l) => t + l.montant, 0) * 100) / 100;
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
      tr.appendChild(cellule(ligne.remise ? `−${ligne.remise} %` : "—",
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
    totaux.appendChild(celluleEuros(somme, "total-personne"));
    pied.appendChild(totaux);
    table.appendChild(pied);

    cadre.appendChild(table);
    return cadre;
  }

  // Tout l'onglet, dans les zones que la page lui donne :
  //   alerte, entete, detail, couchages, couverts.
  function dessiner(zones, faits, grille) {
    const logements = (grille.logements || []).slice();

    // --- les couchages
    const parNuit = couchagesParNuit(faits);
    const nuits = [...parNuit.keys()].sort();
    const utilises = logements.filter((l) =>
      nuits.some((j) => (parNuit.get(j).get(l.id) || new Set()).size)
    );

    const sansPlace = dormeursSansPlace(faits);
    zones.alerte.textContent = "";
    if (sansPlace.length) {
      const p = document.createElement("p");
      p.className = "erreur";
      p.textContent =
        `${sansPlace.length} nuit(s) déclarée(s) sans place attribuée : ces ` +
        "personnes ne sont comptées dans aucune chambre. Le plan de " +
        "couchage n'est pas fini : ces chiffres ne sont pas encore à envoyer.";
      zones.alerte.appendChild(p);
    }

    if (!nuits.length) {
      rienDire(
        zones.couchages,
        "Aucune place attribuée : le plan de couchage dira quelles chambres réserver."
      );
    } else {
      zones.couchages.textContent = "";
      zones.couchages.appendChild(
        tableau(
          [
            { libelle: "Nuit du", valeur: (j) => libelleNuit(j).replace("Nuit du ", "") },
            ...utilises.map((l) => ({
              libelle: nommerType(l),
              valeur: (j) => (parNuit.get(j).get(l.id) || new Set()).size,
            })),
            {
              libelle: "Couchages",
              valeur: (j) => [...parNuit.get(j).values()].reduce((t, u) => t + u.size, 0),
              total: true,
            },
            {
              libelle: "Dormeurs",
              valeur: (j) => (faits.couchages || []).filter((c) => c.jour === j).length,
            },
          ],
          nuits
        )
      );
    }

    // --- le detail du sejour
    const prestations = window.FACTURE.calculer(faits, grille).prestations || [];
    if (!prestations.length) {
      rienDire(zones.detail, "Rien à facturer : ni nuit, ni repas déclarés.");
    } else {
      zones.detail.textContent = "";
      zones.detail.appendChild(tableauDetail(prestations));
    }

    // --- les couverts, deja additionnes par la base
    const couverts = faits.couverts || [];
    zones.entete.textContent = entete(faits, couverts);

    if (!couverts.length) {
      rienDire(zones.couverts, "Aucun repas déclaré.");
    } else {
      zones.couverts.textContent = "";
      zones.couverts.appendChild(
        tableau(
          [
            { libelle: "Repas", valeur: (l) => libelleRepas(l) },
            ...TRANCHES.map(([cle, libelle]) => ({ libelle, valeur: (l) => l[cle] })),
            { libelle: "Couverts", valeur: (l) => l.total, total: true },
            ...PREFERENCES.map(([cle, libelle]) => ({ libelle, valeur: (l) => l[cle] })),
          ],
          couverts
        )
      );
    }
  }

  return { dessiner };
})();
