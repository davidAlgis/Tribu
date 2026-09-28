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

  const REPAS = ["petit_dejeuner", "dejeuner", "diner"];

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

  // Le meme escalier que `_regime_chambre` : sans petit-dejeuner le
  // lendemain, l'hotel ne reconnait aucune formule.
  function regimeChambre(dinerJ, pdjJ1, dejJ1) {
    if (!pdjJ1) return NUIT_SEULE;
    if (dinerJ && dejJ1) return PENSION_COMPLETE;
    if (dinerJ) return DEMI_PENSION_SOIR;
    if (dejJ1) return DEMI_PENSION_MIDI;
    return NUIT_PETIT_DEJEUNER;
  }

  function prestations(presences) {
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
        const regime =
          presence.hebergement === GITE
            ? "gite_nuit"
            : regimeChambre(
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

  function nommer(grille, logementId) {
    const l = grille.logements.get(logementId);
    if (!l) return String(logementId);
    return `${l.categorie}${l.vue_mer ? " vue mer" : ""} de ${l.capacite}`;
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

  function calculer(faits, brut) {
    const personnes = new Map((faits.personnes || []).map((p) => [p.id, p]));
    const grille = grilleDepuis(brut || {}, faits.couchages);
    const { nuitees, horsPension } = prestations(faits.presences || []);

    const compte = new Map();
    const pour = (id) => {
      if (!compte.has(id)) {
        compte.set(id, { personne_id: id, nuits: 0, hebergement: 0, repas: 0, taxe: 0 });
      }
      return compte.get(id);
    };
    const manquants = new Set();
    const sansPlace = [];

    // --- les chambres : par personne, selon l'age
    for (const nuitee of nuitees) {
      pour(nuitee.personne_id).nuits += 1;
      if (nuitee.hebergement !== CHAMBRE) continue;
      const personne = personnes.get(nuitee.personne_id) || {};
      const place = grille.couchages.get(`${nuitee.personne_id}|${nuitee.jour}`);
      const logementId = place ? place.logement_id : nuitee.logement_id;

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

      pour(nuitee.personne_id).hebergement = arrondir(
        pour(nuitee.personne_id).hebergement + remiser(prix, remise)
      );
    }

    // --- les gites : le gite entier, partage entre ceux qui y dorment
    const parUnite = new Map();
    for (const nuitee of nuitees) {
      if (nuitee.hebergement !== GITE) continue;
      const place = grille.couchages.get(`${nuitee.personne_id}|${nuitee.jour}`);
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
      const trouve = montantDe(grille, logementId, "entier", jour);
      if (!trouve || trouve.montant <= 0) {
        manquants.add(`${nommer(grille, logementId)} — le gîte entier`);
      }
      const total = trouve ? remiser(trouve.montant, trouve.remise) : 0;
      occupants.sort((a, b) => (a.personne_id < b.personne_id ? -1 : 1));
      const morceaux = parts(total, occupants.length);
      occupants.forEach((nuitee, rang) => {
        pour(nuitee.personne_id).hebergement = arrondir(
          pour(nuitee.personne_id).hebergement + morceaux[rang]
        );
      });
    }

    // --- la taxe de sejour : par adulte et par nuit, sans remise
    const taxe = grille.annexes.get("taxe_sejour|") || 0;
    if (taxe) {
      for (const nuitee of nuitees) {
        const personne = personnes.get(nuitee.personne_id) || {};
        if (personne.categorie_age !== "adulte") continue;
        pour(nuitee.personne_id).taxe = arrondir(pour(nuitee.personne_id).taxe + taxe);
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
      pour(repas.personne_id).repas = arrondir(
        pour(repas.personne_id).repas + (prix || 0)
      );
    }

    const lignes = [...compte.values()].map((l) => ({
      ...l,
      total: arrondir(l.hebergement + l.repas + l.taxe),
    }));
    lignes.sort((a, b) => {
      const x = personnes.get(a.personne_id) || {};
      const y = personnes.get(b.personne_id) || {};
      return (
        String(x.famille).localeCompare(String(y.famille)) ||
        String(x.prenom).localeCompare(String(y.prenom))
      );
    });

    return {
      lignes,
      total: arrondir(lignes.reduce((somme, l) => somme + l.total, 0)),
      manquants: [...manquants].sort(),
      sansPlace,
    };
  }

  return { calculer, prestations };
})();
