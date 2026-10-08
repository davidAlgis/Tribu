"use strict";

// Ce que chacun paie : une ligne par personne, l'hebergement d'un cote,
// les repas de l'autre.
//
// CE CALCUL EXISTE DEJA, EN PYTHON. `engine/rules.py` deduit les regimes,
// `engine/pricing.py` les chiffre, et l'export Excel en sort. Ce fichier
// en est un SECOND exemplaire, et il faut dire pourquoi : la page ne peut
// pas appeler le Python, qui tourne sur la machine de l'organisateur avec
// la cle secrete. Or regarder ce que chacun doit ne devrait pas demander
// de lancer un script.
//
// DEUX EXEMPLAIRES D'UNE REGLE D'ARGENT, C'EST UN RISQUE. Il est tenu par
// un test : le moteur Python et ce fichier calculent le MEME jeu de
// donnees, et leurs totaux doivent coincider au centime. Le jour ou l'un
// des deux derive, la suite le dit.
//
// Ce qui n'est PAS ici : la base ne derive toujours rien. Elle rend les
// faits -- qui dort ou, qui mange quoi -- et la grille des prix ; tout le
// reste se calcule a la lecture.

window.FACTURE = (function () {
  const CHAMBRE = "chambre";
  const GITE = "gite";
  const EXTERIEUR = "exterieur";

  const PENSION_COMPLETE = "pension_complete";
  const DEMI_PENSION_SOIR = "demi_pension_soir";
  const DEMI_PENSION_MIDI = "demi_pension_midi";
  const NUIT_PETIT_DEJEUNER = "nuit_petit_dejeuner";
  const NUIT_SEULE = "nuit_seule";
  // Une nuit dont rien n'est compris. La cle garde son vieux nom -- les
  // tests et l'import la comparent -- mais ce n'est plus l'affaire des
  // seuls gites : une chambre d'hotel sans pension la porte aussi.
  const SANS_PENSION = "gite_nuit";

  // Comment un type se facture. Les memes mots que la base.
  const AUCUNE = "aucune";
  const FIXE = "fixe";
  const SELON_OCCUPATION = "selon_occupation";
  const PAR_OCCUPANT = "par_occupant";

  const REPAS = ["petit_dejeuner", "dejeuner", "diner"];

  // Ce que l'hotel ecrit sur son contrat. Les memes mots que lui, pour
  // qu'une ligne se retrouve d'un document a l'autre sans traduction.
  const NOMS_REGIME = {
    [PENSION_COMPLETE]: "Pension complète",
    [DEMI_PENSION_SOIR]: "Demi-pension soir",
    [DEMI_PENSION_MIDI]: "Demi-pension déjeuner",
    [NUIT_PETIT_DEJEUNER]: "Nuit + petit-déjeuner",
    [NUIT_SEULE]: "Nuit seule",
    [SANS_PENSION]: "Nuit sans pension",
  };

  // La ligne de la part du logement. Ce n'est pas un regime -- une chambre
  // peut la porter tout en comprenant des repas -- c'est LE LOGEMENT qu'on
  // paye.
  const NOM_LOGEMENT = "Le logement";
  const NOMS_REPAS = {
    petit_dejeuner: "Petit-déjeuner",
    dejeuner: "Déjeuner",
    diner: "Dîner",
  };
  const NOMS_TRANCHE = {
    bebe: "bébés",
    enfant: "enfants",
    jeune: "jeunes",
    adulte: "adultes",
  };

  // Les repas qu'un regime comprend, en (decalage de jour, repas). Le
  // meme tableau que `_repas_absorbes` dans `engine/rules.py`.
  const ABSORBES = {
    [PENSION_COMPLETE]: [[0, "diner"], [1, "petit_dejeuner"], [1, "dejeuner"]],
    [DEMI_PENSION_SOIR]: [[0, "diner"], [1, "petit_dejeuner"]],
    [DEMI_PENSION_MIDI]: [[1, "petit_dejeuner"], [1, "dejeuner"]],
    [NUIT_PETIT_DEJEUNER]: [[1, "petit_dejeuner"]],
  };

  function arrondir(valeur) {
    return Math.round(valeur * 100) / 100;
  }

  // Midi plutot que minuit : un changement d'heure ne fera pas reculer la
  // date d'un jour.
  function lendemain(iso) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // Lundi = 0, comme `date.weekday()` en Python et comme la base.
  // `getDay()` compte a partir du dimanche : sans cette rotation, le
  // week-end tomberait deux jours trop tot.
  function jourDeSemaine(iso) {
    return (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
  }

  // ------------------------------------------------------- les regimes

  // Ce que valait la regle avant que le reglage existe. Elle sert encore
  // de repli : une declaration generique -- « en chambre », sans taille --
  // ne designe aucun type, et il faut bien savoir ce que sa nuit comprend.
  function comprisDe(logements, logementId, hebergement) {
    const ligne = logements && logements.get ? logements.get(logementId) : null;
    if (ligne && Array.isArray(ligne.repas_compris)) return new Set(ligne.repas_compris);
    return hebergement === GITE ? new Set() : new Set(REPAS);
  }

  // Le meme escalier que `_regime` dans `engine/rules.py`. Il ne voit que
  // ce que la nuit PEUT comprendre : un repas pris hors de cette liste ne
  // l'abaisse pas d'un cran, il se facture a part. Avec les trois repas,
  // c'est mot pour mot la regle d'avant ; avec une liste vide, aucune
  // formule n'existe.
  function regimeDe(compris, dinerJ, pdjJ1, dejJ1) {
    if (!compris.size) return SANS_PENSION;

    const diner = dinerJ && compris.has("diner");
    const petitDejeuner = pdjJ1 && compris.has("petit_dejeuner");
    const dejeuner = dejJ1 && compris.has("dejeuner");

    // Sans petit-dejeuner, l'hotel ne reconnait aucune formule.
    if (compris.has("petit_dejeuner") && !petitDejeuner) return NUIT_SEULE;
    if (diner && dejeuner) return PENSION_COMPLETE;
    if (diner) return DEMI_PENSION_SOIR;
    if (dejeuner) return DEMI_PENSION_MIDI;
    return NUIT_PETIT_DEJEUNER;
  }

  function prestations(presences, logements) {
    const parPersonne = new Map();
    for (const p of presences) {
      const qui = p.participant_id || p.personne_id;
      if (!parPersonne.has(qui)) parPersonne.set(qui, new Map());
      parPersonne.get(qui).set(p.jour, p);
    }

    const nuitees = [];
    const horsPension = [];

    for (const [qui, jours] of parPersonne) {
      const absorbes = new Set();
      const dates = [...jours.keys()].sort();

      for (const jour of dates) {
        const presence = jours.get(jour);
        if (presence.hebergement === EXTERIEUR) continue;

        const suivant = jours.get(lendemain(jour));
        const regime = regimeDe(
          comprisDe(logements, presence.logement_id, presence.hebergement),
          !!presence.diner,
          !!(suivant && suivant.petit_dejeuner),
          !!(suivant && suivant.dejeuner)
        );

        nuitees.push({
          personne_id: qui,
          jour,
          hebergement: presence.hebergement,
          regime,
          vue_mer: !!presence.vue_mer && presence.hebergement === CHAMBRE,
          logement_id: presence.logement_id || null,
        });

        for (const [decalage, repas] of ABSORBES[regime] || []) {
          absorbes.add(`${decalage ? lendemain(jour) : jour}|${repas}`);
        }
      }

      // Tout repas coche qu'aucun regime n'a absorbe se paye a part.
      for (const jour of dates) {
        const presence = jours.get(jour);
        for (const repas of REPAS) {
          if (presence[repas] && !absorbes.has(`${jour}|${repas}`)) {
            horsPension.push({ personne_id: qui, jour, repas });
          }
        }
      }
    }

    return { nuitees, horsPension };
  }

  // --------------------------------------------------------- les prix

  function grilleDepuis(brut, couchages) {
    const grille = {
      prix: new Map(),
      annexes: new Map(),
      repasJour: new Map(),
      logements: new Map(),
      couchages: new Map(),
      joursWeekend: new Set([4, 5]),
    };
    for (const l of brut.logements || []) grille.logements.set(l.id, l);
    for (const t of brut.tarifs || []) {
      grille.prix.set(`${t.logement_id}|${t.tranche}`, {
        semaine: Number(t.semaine) || 0,
        weekend: Number(t.weekend) || 0,
        remise: Number(t.remise) || 0,
      });
    }
    for (const a of brut.annexes || []) {
      grille.annexes.set(`${a.cle}|${a.tranche || ""}`, Number(a.montant) || 0);
    }
    for (const r of brut.repas_jour || []) {
      grille.repasJour.set(`${r.jour}|${r.repas}|${r.tranche}`, Number(r.montant) || 0);
    }
    if (brut.jours_weekend) grille.joursWeekend = new Set(brut.jours_weekend.map(Number));
    for (const c of couchages || []) {
      grille.couchages.set(`${c.participant_id || c.personne_id}|${c.jour}`, c);
    }
    return grille;
  }

  // Le repli par categorie n'est pas une commodite : un type declare sans
  // taille -- « en chambre », generique -- ne designe aucune ligne
  // d'inventaire, et il faut bien le facturer quand meme.
  function partPersonne(grille, logementId, hebergement) {
    const ligne = grille.logements.get(logementId);
    if (ligne && ligne.part_personne) return ligne.part_personne;
    return hebergement === GITE ? AUCUNE : PAR_OCCUPANT;
  }

  function partLogement(grille, logementId, hebergement) {
    const ligne = grille.logements.get(logementId);
    if (ligne && ligne.part_logement) return ligne.part_logement;
    return hebergement === GITE ? FIXE : AUCUNE;
  }

  // La base ecrit « gite » sans accent -- c'est une clef, pas un mot. Ces
  // libelles-la partent sur un document qu'on envoie a l'hotel : ils
  // s'ecrivent en francais.
  const NOMS_COUCHAGE = { chambre: "chambre", gite: "gîte" };

  function nommer(grille, logementId) {
    const l = grille.logements.get(logementId);
    if (!l) return String(logementId);
    const quoi = NOMS_COUCHAGE[l.categorie] || l.categorie;
    return `${quoi}${l.vue_mer ? " vue mer" : ""} de ${l.capacite}`;
  }

  // Un prix de week-end a zero veut dire « comme la semaine » : beaucoup
  // d'hotels n'ont qu'un seul prix, et la colonne reste vide.
  function montantDe(grille, logementId, tranche, jour) {
    const ligne = grille.prix.get(`${logementId}|${tranche}`);
    if (!ligne) return null;
    const weekend = grille.joursWeekend.has(jourDeSemaine(jour));
    return {
      montant: weekend && ligne.weekend > 0 ? ligne.weekend : ligne.semaine,
      remise: ligne.remise,
    };
  }

  function enWeekend(grille, jour) {
    return grille.joursWeekend.has(jourDeSemaine(jour));
  }

  // « 24 oct. » : de quoi nommer un jour dans un libelle sans l'allonger.
  function afficherJourCourt(iso) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    });
  }

  function remiser(prix, remise) {
    return arrondir(prix * (1 - remise / 100));
  }

  // Le reste de l'arrondi va a la premiere part : sans cela, la somme des
  // parts ne fait pas le prix du gite.
  function parts(total, combien) {
    const entier = arrondir(total);
    const part = arrondir(entier / combien);
    const tout = new Array(combien).fill(part);
    tout[0] = arrondir(entier - part * (combien - 1));
    return tout;
  }

  // Ce que l'organisateur retire de la note d'une personne. Le meme calcul
  // que `_reduction` dans `engine/pricing.py`.
  //
  // Un montant en euros ne depasse jamais la note : une reduction ne rend
  // pas d'argent.
  //
  // LE POURCENTAGE SE CALCULE EN CENTIMES ENTIERS. 12,5 % de 180,20 font
  // 22,525 : en virgule flottante, JavaScript arrondit au-dessus et Python
  // au pair -- un centime d'ecart, que le test de comparaison a attrape.
  // En entiers, le demi-centime monte des deux cotes, sans ambiguite.
  function reductionDe(personne, total) {
    const valeur = Number(personne && personne.reduction_valeur) || 0;
    if (!personne || valeur <= 0 || total <= 0) return 0;
    if (personne.reduction_type === "pourcentage") {
      const centimes = Math.round(total * 100);
      const centiemes = Math.round(Math.min(valeur, 100) * 100);
      return Math.floor((centimes * centiemes + 5000) / 10000) / 100;
    }
    if (personne.reduction_type === "euros") return arrondir(Math.min(valeur, total));
    return 0;
  }

  function calculer(faits, brut) {
    const personnes = new Map((faits.personnes || []).map((p) => [p.id, p]));
    const grille = grilleDepuis(brut || {}, faits.couchages);
    // L'inventaire dit ce que la nuit de chaque type comprend : il se
    // construit donc AVANT les prestations, et non apres.
    const { nuitees, horsPension } = prestations(faits.presences || [], grille.logements);

    const compte = new Map();
    const pour = (id) => {
      if (!compte.has(id)) {
        compte.set(id, {
          personne_id: id,
          nuits: 0,
          hebergement: 0,
          repas: 0,
          taxe: 0,
          // Le DETAIL, case par case : ce que la page montre en colonnes.
          // Les sommes ci-dessus s'en deduisent, mais on les tient au fil
          // de l'eau -- refaire la somme d'un objet a l'affichage, c'est
          // une deuxieme occasion de se tromper.
          parNuit: {},
          parRepas: {},
        });
      }
      return compte.get(id);
    };
    // Les colonnes : une nuit ou quelqu'un dort, un repas que quelqu'un
    // prend hors pension. Une colonne vide partout n'apprend rien et
    // coute une colonne.
    const nuitsVues = new Set();
    const repasVus = new Set();
    const manquants = new Set();
    const sansPlace = [];

    // LE MEME ARGENT, REGROUPE PAR PRESTATION. C'est ce qu'un hotel met
    // sur son contrat : une ligne par produit, sa quantite, son prix
    // unitaire, sa remise. La facture par personne et ce detail-ci
    // comptent exactement la meme chose de deux facons -- un test exige
    // qu'ils tombent sur le meme total.
    const parPrestation = new Map();
    const prester = (cle, modele) => {
      if (!parPrestation.has(cle)) {
        parPrestation.set(cle, {
          ...modele,
          quantite: 0,
          montant: 0,
          jours: new Set(),
        });
      }
      return parPrestation.get(cle);
    };

    // --- les chambres : par personne, selon l'age
    for (const nuitee of nuitees) {
      pour(nuitee.personne_id).nuits += 1;
      // La place REELLE d'abord -- c'est la qu'on a dormi -- et le type
      // declare a defaut, pour qui n'a pas encore de place sur le plan.
      const place = grille.couchages.get(`${nuitee.personne_id}|${nuitee.jour}`);
      const logementId = place ? place.logement_id : nuitee.logement_id;
      if (partPersonne(grille, logementId, nuitee.hebergement) === AUCUNE) continue;
      const personne = personnes.get(nuitee.personne_id) || {};

      let prix = 0;
      let remise = 0;
      if (!logementId) {
        manquants.add("chambre sans type déclaré ni place attribuée");
      } else {
        const trouve = montantDe(grille, logementId, personne.categorie_age, nuitee.jour);
        if (!trouve || trouve.montant <= 0) {
          manquants.add(`${nommer(grille, logementId)} — ${personne.categorie_age}`);
        }
        if (trouve) {
          prix = trouve.montant;
          remise = trouve.remise;
        }
      }

      if (nuitee.regime !== PENSION_COMPLETE) {
        prix = Math.max(0, prix - (grille.annexes.get(`${nuitee.regime}|`) || 0));
      }
      if (nuitee.vue_mer) prix += grille.annexes.get("vue_mer|") || 0;

      const du = remiser(prix, remise);
      const ligne = pour(nuitee.personne_id);
      ligne.hebergement = arrondir(ligne.hebergement + du);
      ligne.parNuit[nuitee.jour] = arrondir((ligne.parNuit[nuitee.jour] || 0) + du);
      nuitsVues.add(nuitee.jour);

      // Une ligne de contrat par regime, par couchage, par periode et par
      // tranche : « Pension complète — chambre de 2 — week-end — adultes ».
      // Le prix unitaire est le prix BRUT, et la remise se dit a cote --
      // c'est ainsi que l'hotel l'ecrit, et cela permet de verifier la
      // ligne sans refaire le calcul.
      const periode = enWeekend(grille, nuitee.jour) ? "week-end" : "semaine";
      const p = prester(
        `1nuit|${nuitee.regime}|${logementId}|${periode}|${personne.categorie_age}|${nuitee.vue_mer}`,
        {
          ordre: 1,
          libelle:
            `${NOMS_REGIME[nuitee.regime]} — ` +
            `${logementId ? nommer(grille, logementId) : "chambre"} — ` +
            `${periode} — ${NOMS_TRANCHE[personne.categorie_age] || "?"}` +
            (nuitee.vue_mer ? " — vue mer" : ""),
          unitaire: arrondir(prix),
          remise,
        }
      );
      p.quantite += 1;
      p.montant = arrondir(p.montant + du);
      p.jours.add(nuitee.jour);
    }

    // --- la part du logement : le logement entier, partage entre ceux qui
    // y dorment. LES DEUX BOUCLES NE S'EXCLUENT PLUS : un type qui a les
    // deux parts passe dans les deux, et sa nuit coute la somme.
    const parUnite = new Map();
    for (const nuitee of nuitees) {
      const placeVue = grille.couchages.get(`${nuitee.personne_id}|${nuitee.jour}`);
      const typeVu = placeVue ? placeVue.logement_id : nuitee.logement_id;
      if (partLogement(grille, typeVu, nuitee.hebergement) === AUCUNE) continue;
      const place = placeVue;
      if (!place) {
        // Sans place, on ne sait ni quel gite ni avec combien : il n'y a
        // pas de part a calculer, et la deviner reviendrait a facturer
        // quelqu'un au hasard.
        sansPlace.push({ personne_id: nuitee.personne_id, jour: nuitee.jour });
        continue;
      }
      const cle = `${nuitee.jour}|${place.logement_id}|${place.numero}`;
      if (!parUnite.has(cle)) parUnite.set(cle, []);
      parUnite.get(cle).push(nuitee);
    }

    for (const [cle, occupants] of [...parUnite.entries()].sort()) {
      const [jour, logementId] = cle.split("|");
      const combien = occupants.length;

      // `selon_occupation` : le prix depend du nombre de dormeurs de la
      // nuit -- la chambre a deux ne coute pas la chambre a trois. Une
      // ligne par occupation, et le prix plat en repli : un hotel qui
      // n'aurait rempli que « entier » ne facture pas zero pour autant.
      const mode = partLogement(grille, logementId, occupants[0].hebergement);
      const tranche = mode === SELON_OCCUPATION ? `entier_${combien}` : "entier";
      let trouve = montantDe(grille, logementId, tranche, jour);
      if ((!trouve || trouve.montant <= 0) && tranche !== "entier") {
        trouve = montantDe(grille, logementId, "entier", jour);
      }
      if (!trouve || trouve.montant <= 0) {
        manquants.add(
          `${nommer(grille, logementId)} — le logement entier` +
            (mode === SELON_OCCUPATION ? `, à ${combien}` : "")
        );
      }
      const total = trouve ? remiser(trouve.montant, trouve.remise) : 0;

      // Le logement se loue entier : la ligne du contrat compte des NUITS
      // DE LOGEMENT, pas des personnes. Les parts qu'on repartit ensuite
      // sont une affaire interne a la famille.
      const periode = enWeekend(grille, jour) ? "week-end" : "semaine";
      const g = prester(`2gite|${logementId}|${periode}|${tranche}`, {
        ordre: 2,
        libelle:
          `Nuitée ${nommer(grille, logementId)} — ${periode}` +
          (mode === SELON_OCCUPATION ? ` — à ${combien}` : ""),
        unitaire: trouve ? arrondir(trouve.montant) : 0,
        remise: trouve ? trouve.remise : 0,
      });
      g.quantite += 1;
      g.montant = arrondir(g.montant + total);
      g.jours.add(jour);

      occupants.sort((a, b) => (a.personne_id < b.personne_id ? -1 : 1));
      const morceaux = parts(total, combien);
      occupants.forEach((nuitee, rang) => {
        const ligne = pour(nuitee.personne_id);
        ligne.hebergement = arrondir(ligne.hebergement + morceaux[rang]);
        ligne.parNuit[nuitee.jour] = arrondir(
          (ligne.parNuit[nuitee.jour] || 0) + morceaux[rang]
        );
        nuitsVues.add(nuitee.jour);
      });
    }

    // --- la taxe de sejour : par adulte et par nuit, sans remise
    const taxe = grille.annexes.get("taxe_sejour|") || 0;
    if (taxe) {
      for (const nuitee of nuitees) {
        const personne = personnes.get(nuitee.personne_id) || {};
        if (personne.categorie_age !== "adulte") continue;
        pour(nuitee.personne_id).taxe = arrondir(pour(nuitee.personne_id).taxe + taxe);
        const t = prester("3taxe", {
          ordre: 3,
          libelle: "Taxe de séjour — adultes",
          unitaire: taxe,
          remise: 0,
        });
        t.quantite += 1;
        t.montant = arrondir(t.montant + taxe);
        t.jours.add(nuitee.jour);
      }
    }

    // --- les repas hors pension, au prix du jour s'il y en a un
    for (const repas of horsPension) {
      const personne = personnes.get(repas.personne_id) || {};
      const exception = grille.repasJour.get(
        `${repas.jour}|${repas.repas}|${personne.categorie_age}`
      );
      const prix =
        exception === undefined
          ? grille.annexes.get(`${repas.repas}|${personne.categorie_age}`)
          : exception;
      if (!prix) {
        manquants.add(`${repas.repas} hors pension — ${personne.categorie_age}`);
      }
      const ligne = pour(repas.personne_id);
      const cle = `${repas.jour}|${repas.repas}`;
      ligne.repas = arrondir(ligne.repas + (prix || 0));
      ligne.parRepas[cle] = arrondir((ligne.parRepas[cle] || 0) + (prix || 0));
      repasVus.add(cle);

      // Un couvert est un couvert : on groupe par repas, par tranche et
      // PAR PRIX -- le diner de gala du samedi fait ainsi sa propre ligne,
      // comme sur le contrat de l'hotel.
      const r = prester(
        `4repas|${repas.repas}|${personne.categorie_age}|${prix || 0}`,
        {
          ordre: 4,
          libelle:
            `${NOMS_REPAS[repas.repas]} — ` +
            `${NOMS_TRANCHE[personne.categorie_age] || "?"}`,
          unitaire: arrondir(prix || 0),
          remise: 0,
        }
      );
      r.quantite += 1;
      r.montant = arrondir(r.montant + (prix || 0));
      r.jours.add(repas.jour);
    }

    // LA REDUCTION VIENT EN DERNIER, sur la note entiere : c'est ce que
    // l'organisateur accorde a une personne, pas ce que l'hotel remise sur
    // une prestation. Le detail par prestation -- celui qu'on pose a cote
    // du contrat -- ne la voit donc pas : il totalise `brut`, pas `total`.
    const lignes = [...compte.values()].map((l) => {
      const brut = arrondir(l.hebergement + l.repas + l.taxe);
      const reduction = reductionDe(personnes.get(l.personne_id), brut);
      return { ...l, brut, reduction, total: arrondir(brut - reduction) };
    });
    // L'ORDRE VIENT DE LA BASE : couples de la premiere generation, leurs
    // enfants dessous, du plus age au plus jeune. Retrier ici par prenom
    // defferait ce rangement -- et la facture se lit a cote de la liste
    // des participants, qui suit le meme.
    const rang = new Map((faits.personnes || []).map((p, i) => [p.id, i]));
    lignes.sort(
      (a, b) =>
        (rang.has(a.personne_id) ? rang.get(a.personne_id) : 1e9) -
        (rang.has(b.personne_id) ? rang.get(b.personne_id) : 1e9)
    );

    // Chronologique, et pour un meme jour dans l'ordre ou l'on mange.
    const RANG = { petit_dejeuner: 0, dejeuner: 1, diner: 2 };
    const repasColonnes = [...repasVus]
      .map((cle) => {
        const [jour, repas] = cle.split("|");
        return { cle, jour, repas };
      })
      .sort((a, b) => a.jour.localeCompare(b.jour) || RANG[a.repas] - RANG[b.repas]);

    // Deux lignes de meme nature et de prix differents ne se distinguent
    // que par leurs jours : on les nomme alors. Sinon le libelle reste
    // court -- « Dîner — adultes » se lit mieux que la meme chose suivie
    // de cinq dates.
    const parNature = new Map();
    for (const p of parPrestation.values()) {
      parNature.set(p.libelle, (parNature.get(p.libelle) || 0) + 1);
    }
    const detail = [...parPrestation.values()]
      .map((p) => ({
        libelle:
          parNature.get(p.libelle) > 1
            ? `${p.libelle} — ${[...p.jours].sort().map(afficherJourCourt).join(", ")}`
            : p.libelle,
        quantite: p.quantite,
        unitaire: p.unitaire,
        remise: p.remise,
        montant: p.montant,
        ordre: p.ordre,
      }))
      .sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, "fr"));

    return {
      lignes,
      prestations: detail,
      nuits: [...nuitsVues].sort(),
      repasColonnes,
      total: arrondir(lignes.reduce((somme, l) => somme + l.total, 0)),
      brut: arrondir(lignes.reduce((somme, l) => somme + l.brut, 0)),
      reductions: arrondir(lignes.reduce((somme, l) => somme + l.reduction, 0)),
      manquants: [...manquants].sort(),
      sansPlace,
    };
  }


  // ---------------------------------------------------------- synthese
  //
  // La FORME de la depense, quand les tableaux en donnent le montant.
  // Quatre series, et pour chacune : moyenne, ecart-type, minimum,
  // maximum.
  //
  // L'ECART-TYPE EST CELUI DE LA POPULATION, et non d'un echantillon : on
  // a tout le monde sous la main, on n'estime rien. Diviser par n-1
  // gonflerait un chiffre dont la seule utilite est de dire si la depense
  // est egale ou dispersee.
  //
  // CHAQUE SERIE PORTE SON EFFECTIF, parce qu'elles ne le partagent pas.
  // Un prix par nuit n'existe pas pour qui n'a declare aucune nuit ; le
  // compter zero tirerait la moyenne vers le bas en repondant a une autre
  // question. Les trois premieres, en revanche, comptent tout le monde :
  // quelqu'un qui ne prend aucun repas hors pension paie bel et bien zero
  // de repas, et c'est le prix moyen d'un participant qu'on cherche.
  function serie(valeurs) {
    if (!valeurs.length) {
      return { personnes: 0, moyenne: null, ecartType: null, min: null, max: null };
    }
    const moyenne = valeurs.reduce((t, v) => t + v, 0) / valeurs.length;
    const variance =
      valeurs.reduce((t, v) => t + (v - moyenne) * (v - moyenne), 0) / valeurs.length;
    return {
      personnes: valeurs.length,
      moyenne: arrondir(moyenne),
      ecartType: arrondir(Math.sqrt(variance)),
      min: arrondir(Math.min.apply(null, valeurs)),
      max: arrondir(Math.max.apply(null, valeurs)),
    };
  }

  // Combien de repas ont ete FACTURES a quelqu'un. Un repas compris dans
  // une pension n'en est pas un : il est deja paye avec la nuit, et le
  // compter ferait baisser le prix moyen d'un repas sans que personne
  // n'ait rien paye de moins.
  function repasFactures(ligne) {
    return Object.keys(ligne.parRepas || {}).length;
  }

  function synthese(lignes) {
    const tous = lignes || [];
    const dormeurs = tous.filter((l) => l.nuits > 0);
    return [
      {
        cle: "repas",
        libelle: "Repas par personne",
        ...serie(tous.map((l) => l.repas)),
      },
      {
        cle: "hebergement",
        libelle: "Hébergement par personne",
        ...serie(tous.map((l) => arrondir(l.hebergement + l.taxe))),
      },
      {
        cle: "total",
        libelle: "Total par personne",
        ...serie(tous.map((l) => l.total)),
      },
      {
        cle: "nuitee",
        libelle: "Total par personne et par nuit",
        ...serie(dormeurs.map((l) => l.total / l.nuits)),
      },
    ];
  }

  return { calculer, prestations, synthese, repasFactures };
})();
