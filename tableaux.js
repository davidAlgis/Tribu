"use strict";

// Les tableaux d'argent, dessines une seule fois pour deux pages.
//
// L'organisateur les lit sur `admin.html`, la famille sur `facture.html`
// -- les memes colonnes, les memes sous-totaux, la meme facon d'ecrire un
// montant. Deux copies de ce fichier, et c'est deux formats qui divergent
// le jour ou l'un des deux gagne une colonne : celui qui demande l'argent
// et celui qui le paie ne liraient plus la meme chose.
//
// CE MODULE NE CALCULE RIEN. Les montants viennent de `facture.js`, qui
// vit hors du navigateur et se compare au moteur Python a chaque
// execution de la suite. Ici on met en page, et rien d'autre -- a une
// exception pres, les colonnes de RAPPORT, qui divisent ce qui a deja ete
// calcule (voir `quotient` plus bas).

window.TABLEAUX = (function () {
  const NOMS_REPAS = {
    petit_dejeuner: "Petit-déj.",
    dejeuner: "Déjeuner",
    diner: "Dîner",
  };

  function euros(valeur) {
    return `${valeur.toFixed(2).replace(".", ",")} €`;
  }

  // Une cellule de texte. `celluleEuros` en est la variante qui met les
  // zeros en tiret ; celle-ci sert aux quantites et aux mentions.
  function cellule(texte, classe) {
    const td = document.createElement("td");
    td.textContent = texte;
    if (classe) td.className = classe;
    return td;
  }

  // Une case a zero se marque d'un tiret : dans un tableau de seize
  // colonnes, « 0,00 € » repete partout noie les vrais montants.
  function celluleEuros(valeur, classe) {
    const td = document.createElement("td");
    td.textContent = valeur ? euros(valeur) : "—";
    td.className = [valeur ? "" : "rien", classe || ""].filter(Boolean).join(" ");
    return td;
  }

  // Les prenoms viennent de la base, et la base tient ce que le GEDCOM lui
  // a donne : des chaines qu'aucun humain n'a relues. `textContent` pose du
  // texte, et rien d'autre.
  function span(texte, classe) {
    const element = document.createElement("span");
    element.textContent = texte;
    if (classe) element.className = classe;
    return element;
  }

  const quantieme = (iso) => new Date(`${iso}T12:00:00`).getDate();

  // « Nuit du 24-25 » : une nuit porte deux dates, et la nommer d'une
  // seule laisse toujours un doute sur celle qu'on designe.
  function libelleNuit(jour) {
    const suivant = new Date(`${jour}T12:00:00`);
    suivant.setDate(suivant.getDate() + 1);
    return `Nuit du ${quantieme(jour)}-${suivant.getDate()}`;
  }

  function libelleRepas(colonne) {
    return `${NOMS_REPAS[colonne.repas]} ${quantieme(colonne.jour)}`;
  }

  function nomDe(personne) {
    const bloc = document.createElement("th");
    bloc.scope = "row";
    bloc.append(personne.prenom || "?");
    // La branche distingue deux homonymes, et ne vaut d'etre dite que
    // lorsqu'elle differe du prenom.
    if (personne.famille && personne.famille !== personne.prenom) {
      bloc.append(span(` (${personne.famille})`, "precision"));
    }
    return bloc;
  }

  function rienDire(zone, texte) {
    const rien = document.createElement("p");
    rien.className = "note";
    rien.textContent = texte;
    zone.textContent = "";
    zone.appendChild(rien);
  }

  // UNE COLONNE SE SOMME, OU SE DIVISE.
  //
  // « 180 € » s'additionne d'une personne a l'autre ; « 45 € la nuitee »,
  // non -- deux personnes a 45 € la nuit n'en font pas une a 90. Une
  // colonne de rapport declare donc son haut et son bas, la case montre
  // leur quotient, et les lignes de total refont la division sur les deux
  // sommes : la depense de la famille divisee par ses nuitees, et non la
  // somme de ses moyennes.
  //
  // Sans quotient possible -- personne n'a dormi, personne n'a mange -- la
  // case reste vide plutot que de montrer un zero : zero euro la nuitee se
  // lirait comme une nuit gratuite.
  function partDe(colonne, ligne) {
    return colonne.rapport
      ? { haut: colonne.rapport.haut(ligne), bas: colonne.rapport.bas(ligne) }
      : { haut: colonne.valeur(ligne), bas: 0 };
  }

  function quotient(colonne, part) {
    if (!colonne.rapport) return Math.round(part.haut * 100) / 100;
    return part.bas ? Math.round((part.haut / part.bas) * 100) / 100 : null;
  }

  // Un tableau par personne : une colonne par case du sejour, puis les
  // totaux. CHAQUE FAMILLE FERME SUR SA SOMME -- c'est la ligne qu'on
  // cherche au moment de demander l'argent, et une colonne qui repeterait
  // le meme nombre sur chaque ligne de la famille ne dirait rien de plus.
  function tableau(colonnes, lignes, gens) {
    const cadre = document.createElement("div");
    cadre.className = "tableau-large";
    const table = document.createElement("table");

    const tete = document.createElement("thead");
    const rangee = document.createElement("tr");
    for (const titre of ["Nom Prénom", ...colonnes.map((c) => c.libelle)]) {
      const th = document.createElement("th");
      th.textContent = titre;
      rangee.appendChild(th);
    }
    tete.appendChild(rangee);
    table.appendChild(tete);

    const sommes = colonnes.map(() => ({ haut: 0, bas: 0 }));
    const corps = document.createElement("tbody");

    // Une famille d'une seule personne n'a pas de sous-total a montrer :
    // la ligne repeterait celle du dessus.
    const fermerFamille = (nom, cumul, combien) => {
      if (combien < 2) return;
      const tr = document.createElement("tr");
      tr.className = "sous-total";
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = `Total ${nom}`;
      tr.appendChild(th);
      // Toutes les colonnes, y compris le detail : ce que la famille a
      // depense cette nuit-la se lit aussi bien que ce qu'elle doit en tout.
      colonnes.forEach((colonne, rang) => {
        tr.appendChild(celluleEuros(quotient(colonne, cumul[rang])));
      });
      corps.appendChild(tr);
    };

    let familleEnCours = null;
    let cumul = colonnes.map(() => ({ haut: 0, bas: 0 }));
    let combien = 0;

    for (const ligne of lignes) {
      const personne = gens.get(ligne.personne_id) || {};
      if (familleEnCours !== null && personne.famille !== familleEnCours) {
        fermerFamille(familleEnCours, cumul, combien);
        cumul = colonnes.map(() => ({ haut: 0, bas: 0 }));
        combien = 0;
      }
      familleEnCours = personne.famille;
      combien += 1;

      const tr = document.createElement("tr");
      tr.appendChild(nomDe(personne));
      colonnes.forEach((colonne, rang) => {
        const part = partDe(colonne, ligne);
        cumul[rang].haut += part.haut;
        cumul[rang].bas += part.bas;
        sommes[rang].haut += part.haut;
        sommes[rang].bas += part.bas;
        tr.appendChild(
          celluleEuros(quotient(colonne, part), colonne.total ? "total-personne" : "")
        );
      });
      corps.appendChild(tr);
    }
    if (familleEnCours !== null) fermerFamille(familleEnCours, cumul, combien);
    table.appendChild(corps);

    const pied = document.createElement("tfoot");
    const totaux = document.createElement("tr");
    const titre = document.createElement("th");
    titre.scope = "row";
    titre.textContent = "TOTAL";
    totaux.appendChild(titre);
    colonnes.forEach((colonne, rang) => {
      totaux.appendChild(celluleEuros(quotient(colonne, sommes[rang])));
    });
    pied.appendChild(totaux);
    table.appendChild(pied);

    cadre.appendChild(table);
    return cadre;
  }

  // Les trois jeux de colonnes, definis ici et non dans les pages : c'est
  // par eux que « le meme tableau » veut dire quelque chose.
  //
  // LA TAXE EST DANS L'HEBERGEMENT, au recapitulatif. Le total doit etre
  // la somme des deux montants qui le precedent -- une ligne dont les
  // nombres ne s'additionnent pas se relit trois fois. Le detail des
  // nuits, lui, la montre a part.
  //
  // Chaque montant est suivi de CE QU'IL ACHETE : une nuitee, un repas,
  // l'un et l'autre. C'est ce qui permet de comparer deux personnes qui ne
  // sont pas restees aussi longtemps -- sans quoi le plus gros total est
  // toujours celui qui est reste le plus longtemps, ce qu'on savait deja.
  const arrondi = (v) => Math.round(v * 100) / 100;

  const colonnes = {
    resume: () => [
      {
        libelle: "Hébergement (taxe comprise)",
        valeur: (l) => arrondi(l.hebergement + l.taxe),
      },
      {
        libelle: "Par nuitée",
        rapport: { haut: (l) => arrondi(l.hebergement + l.taxe), bas: (l) => l.nuits },
      },
      { libelle: "Repas", valeur: (l) => l.repas },
      {
        libelle: "Par repas",
        rapport: { haut: (l) => l.repas, bas: (l) => window.FACTURE.repasFactures(l) },
      },
      { libelle: "Total", valeur: (l) => l.total, total: true },
      {
        libelle: "Total par nuitée",
        rapport: { haut: (l) => l.total, bas: (l) => l.nuits },
        total: true,
      },
      {
        libelle: "Total par nuitée + repas",
        rapport: {
          haut: (l) => l.total,
          bas: (l) => l.nuits + window.FACTURE.repasFactures(l),
        },
        total: true,
      },
    ],

    nuits: (calcul) => [
      ...calcul.nuits.map((jour) => ({
        libelle: libelleNuit(jour),
        valeur: (l) => l.parNuit[jour] || 0,
      })),
      { libelle: "Taxe", valeur: (l) => l.taxe, total: true },
      { libelle: "Total sans taxe", valeur: (l) => l.hebergement, total: true },
      { libelle: "Total", valeur: (l) => arrondi(l.hebergement + l.taxe), total: true },
    ],

    repas: (calcul) => [
      ...calcul.repasColonnes.map((colonne) => ({
        libelle: libelleRepas(colonne),
        valeur: (l) => l.parRepas[colonne.cle] || 0,
      })),
      { libelle: "Total", valeur: (l) => l.repas, total: true },
    ],
  };

  // Quatre series, quatre colonnes. Le calcul vit dans `facture.js`, comme
  // le reste de la facture : hors de la page, donc eprouvable sans
  // navigateur -- et le meme ecart-type se relit dans un test au lieu de
  // se verifier a l'oeil sur un tableau.
  const COLONNES_SYNTHESE = [
    ["moyenne", "Moyenne"],
    ["ecartType", "Écart-type"],
    ["min", "Min"],
    ["max", "Max"],
  ];

  function synthese(series, effectif) {
    const cadre = document.createElement("div");
    cadre.className = "tableau-large";
    const table = document.createElement("table");

    const tete = document.createElement("thead");
    const rangee = document.createElement("tr");
    for (const titre of ["", ...COLONNES_SYNTHESE.map(([, l]) => l)]) {
      const th = document.createElement("th");
      th.textContent = titre;
      rangee.appendChild(th);
    }
    tete.appendChild(rangee);
    table.appendChild(tete);

    const corps = document.createElement("tbody");
    for (const serie of series) {
      const tr = document.createElement("tr");
      const nom = document.createElement("th");
      nom.scope = "row";
      nom.append(serie.libelle);
      // Sur combien de personnes porte la ligne. Les series n'ont pas
      // toutes la meme population -- le prix par nuit ne concerne que ceux
      // qui dorment sur place -- et une moyenne dont on ignore l'effectif
      // se lit de travers.
      if (serie.personnes !== effectif) {
        nom.append(span(` (${serie.personnes} pers.)`, "precision"));
      }
      tr.appendChild(nom);
      for (const [champ] of COLONNES_SYNTHESE) {
        // Pas `celluleEuros` : elle met les zeros en tiret, regle venue
        // des tableaux de seize colonnes ou « 0,00 € » partout noie les
        // vrais montants. Sur quatre lignes elle mentirait -- « Min — » se
        // lit « pas de minimum », quand le minimum est zero. Le tiret ne
        // reste que pour une serie sans personne, ou il n'y a vraiment
        // rien.
        tr.appendChild(
          serie[champ] === null ? cellule("—", "rien") : cellule(euros(serie[champ]))
        );
      }
      corps.appendChild(tr);
    }
    table.appendChild(corps);
    cadre.appendChild(table);
    return cadre;
  }

  return {
    euros,
    cellule,
    celluleEuros,
    quantieme,
    libelleNuit,
    libelleRepas,
    rienDire,
    tableau,
    colonnes,
    synthese,
  };
})();
