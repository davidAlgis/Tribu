"use strict";

// Le plan de couchage : un rectangle par couchage, un jeton par personne,
// et l'on deplace les seconds entre les premiers.
//
// CE FICHIER EST PARTAGE par la page organisateur et la page familiale.
// C'est l'exception au « chaque page porte ses propres aides » du reste du
// projet : cette convention vaut pour des fonctions de trois lignes, pas
// pour un plateau de jeu. Deux copies auraient fini par se contredire, et
// la contradiction se serait vue sur le couchage de quelqu'un.
//
// Ce que le module NE SAIT PAS, et qu'on lui donne :
//
//   charger(jour)            va chercher le plan d'une nuit
//   ecrire(personne, unite)  pose UNE personne (le module boucle et
//                            recharge lui-meme)
//
// Et ce qu'il lit dans ce que `charger` rend : `dormeurs[].mien` dit qui
// l'on peut deplacer. L'organisateur recoit `true` partout ; la famille,
// seulement pour les siens. La page grise le reste -- mais c'est la base
// qui refuse, une page ne faisant pas foi.
//
// LE GLISSER N'EST PAS CELUI DU NAVIGATEUR. La page n'emet aucun
// `dragstart` ni `drop` : elle suit le pointeur elle-meme. Le
// glisser-deposer natif est un geste que le navigateur diffuse a qui veut
// l'entendre, et des modules complementaires tres repandus s'y branchent
// pour ouvrir un onglet de recherche a chaque depose. Un glisser qui
// n'existe pas ne se laisse pas ecouter -- et il repond au doigt, ce que
// le glisser natif ne fait pas.

window.PLAN = (function () {
  // La vue mer est une VARIANTE DE CHAMBRE, pas une option a cote. La base
  // garde deux champs -- une categorie et un supplement -- parce que c'est
  // ainsi que l'hotel facture.
  const CHAMBRE_VUE_MER = "chambre+vue_mer";

  const TYPES = {
    chambre: { un: "chambre" },
    [CHAMBRE_VUE_MER]: { un: "chambre vue mer" },
    gite: { un: "gîte" },
  };

  const AGES = { adulte: "adulte", enfant: "enfant", bebe: "bébé" };

  const TAS = "tas"; // l'unite qui n'en est pas une : ceux qui restent a placer
  const UNITE_TAS = { cle: TAS, nom: "À placer" };

  // Ce qu'il faut avoir parcouru avant qu'un appui devienne un glisser. En
  // deca, c'est un clic -- et le clic sert a saisir le jeton.
  const SEUIL_GLISSE = 5;

  function span(texte, classe) {
    const element = document.createElement("span");
    element.textContent = texte;
    if (classe) element.className = classe;
    return element;
  }

  function afficherJour(iso) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    });
  }

  // « enfant de Alice » fait buter la lecture. L'elision n'est pas un detail
  // de style : la precision n'existe que pour etre lue d'un coup d'oeil.
  function de(prenom) {
    return /^[aeiouyàâäéèêëîïôöùûüh]/i.test(prenom) ? `d'${prenom}` : `de ${prenom}`;
  }

  // Le plus court qui suffise a trancher entre deux homonymes, dans cet
  // ordre : le conjoint, puis le parent, puis la branche. Les trois viennent
  // de la base avec le dormeur -- le plan n'a pas l'arbre sous les yeux.
  function preciser(p) {
    if (p.conjoint_prenom) return `conjoint ${de(p.conjoint_prenom)}`;
    if (p.parent_prenom) return `${p.invite ? "invité" : "enfant"} ${de(p.parent_prenom)}`;
    if (p.famille && p.famille !== p.prenom) return `branche ${p.famille}`;
    return "";
  }

  function cleUnite(logementId, numero) {
    return `${logementId}#${numero}`;
  }

  function typeDe(x) {
    return x.categorie === "chambre" && x.vue_mer ? CHAMBRE_VUE_MER : x.categorie;
  }

  // « Chambre 3 », « Gîte 1 », « Chambre 7 (vue mer) ». Le rang se compte par
  // CATEGORIE : une chambre vue mer reste une chambre et prend son tour dans
  // la meme suite, sinon la page afficherait deux « Chambre 1 ».
  function nommerUnites(unites) {
    const rangs = {};
    return unites.map((u) => {
      rangs[u.categorie] = (rangs[u.categorie] || 0) + 1;
      const base = TYPES[u.categorie] ? TYPES[u.categorie].un : u.categorie;
      const titre = base.charAt(0).toUpperCase() + base.slice(1);
      return {
        ...u,
        cle: cleUnite(u.logement_id, u.numero),
        nom: `${titre} ${rangs[u.categorie]}${u.vue_mer ? " (vue mer)" : ""}`,
      };
    });
  }

  function monter(options) {
    const { plan: zonePlan, nuits: zoneNuits, compteur, message } = options;

    let etat = { jour: null, nuits: [], unites: [], dormeurs: [] };
    const saisis = new Set();
    const unitesParCle = new Map();
    let glisse = null;
    let vientDeGlisser = false;

    const parId = (id) => etat.dormeurs.find((d) => d.id === id);
    const mobile = (id) => {
      const p = parId(id);
      return !!p && p.mien;
    };

    function dire(texte, classe) {
      message.className = classe || "";
      message.textContent = texte;
    }

    // ------------------------------------------------------- chargement

    async function recharger(jour) {
      const d = await options.charger(jour || null);
      etat = { ...d, unites: nommerUnites(d.unites || []), dormeurs: d.dormeurs || [] };
      saisis.clear();
      dessinerNuits();
      dessiner();
    }

    function dessinerNuits() {
      zoneNuits.textContent = "";
      for (const n of etat.nuits || []) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "nuit";
        b.setAttribute("aria-pressed", n.jour === etat.jour ? "true" : "false");
        b.append(span(afficherJour(n.jour), "jour"), span(`${n.dormeurs}`, "combien"));
        b.title = `${n.dormeurs} personne(s) dorment sur place la nuit du ${afficherJour(n.jour)}`;
        b.addEventListener("click", async () => {
          dire("");
          try {
            await recharger(n.jour);
          } catch (erreur) {
            dire(erreur.message, "erreur");
          }
        });
        zoneNuits.appendChild(b);
      }
    }

    // ------------------------------------------------------------ jetons

    function jeton(personne, dansUneUnite) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = personne.mien ? "jeton mien" : "jeton verrouille";
      b.dataset.personne = personne.id;
      b.append(span(personne.prenom, "nom"));

      // Le detail qui tranche entre deux homonymes. Il ne parait que si le
      // prenom revient dans la famille ; l'infobulle le donne toujours.
      const precision = preciser(personne);
      if (precision && personne.homonyme) {
        b.append(span(`(${precision})`, "precision"));
      }
      if (personne.categorie_age !== "adulte") {
        b.append(span(AGES[personne.categorie_age], "etiquette"));
      }

      // Ce que la personne a demande. Le TYPE quand elle l'a precise --
      // « gîte de 6 » et non « un gîte » -- et la categorie sinon.
      b.dataset.demande = personne.vue_mer ? CHAMBRE_VUE_MER : personne.hebergement;
      if (personne.demande_id) b.dataset.demandeId = personne.demande_id;

      if (saisis.has(personne.id)) b.classList.add("saisi");
      b.setAttribute("aria-pressed", saisis.has(personne.id) ? "true" : "false");

      const nomComplet = precision ? `${personne.prenom} (${precision})` : personne.prenom;
      if (!personne.mien) {
        b.disabled = true;
        b.title = `${nomComplet} — ce n'est pas à toi de le placer`;
        return b;
      }
      b.title = dansUneUnite
        ? `${nomComplet} — cliquer pour le déplacer`
        : `${nomComplet} — à placer`;

      b.addEventListener("click", (e) => {
        if (vientDeGlisser) {
          vientDeGlisser = false;
          return;
        }
        // Ctrl -- Cmd sur un Mac -- ajoute ou retire sans defaire le reste.
        // Sans lui, le clic REMPLACE la selection : c'est le geste courant,
        // et il doit rester le plus court.
        if (e.ctrlKey || e.metaKey) {
          if (saisis.has(personne.id)) saisis.delete(personne.id);
          else saisis.add(personne.id);
        } else if (saisis.size === 1 && saisis.has(personne.id)) {
          saisis.clear();
        } else {
          saisis.clear();
          saisis.add(personne.id);
        }
        dessiner();
      });

      b.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        commencerGlisse(e, b, personne);
      });

      return b;
    }

    // ----------------------------------------------------------- glisser

    function fantomeDe(b, combien) {
      const copie = b.cloneNode(true);
      copie.className = "jeton fantome";
      if (combien > 1) {
        // Un seul jeton en vol pour cinq personnes deplacees serait un
        // mensonge : le compte le dit.
        copie.appendChild(span(`+${combien - 1}`, "etiquette"));
      } else {
        copie.style.width = `${b.offsetWidth}px`;
      }
      document.body.appendChild(copie);
      return copie;
    }

    // Le fantome ne compte pas dans la recherche : `pointer-events: none` le
    // rend transparent -- sans quoi il se designerait lui-meme.
    function boiteSous(e) {
      const sous = document.elementFromPoint(e.clientX, e.clientY);
      const boite = sous && sous.closest ? sous.closest(".unite") : null;
      return boite && unitesParCle.has(boite.dataset.cle) ? boite : null;
    }

    function viser(boite) {
      if (glisse.boite === boite) return;
      if (glisse.boite) glisse.boite.classList.remove("visee");
      glisse.boite = boite;
      if (boite) boite.classList.add("visee");
    }

    function commencerGlisse(e, b, personne) {
      const rect = b.getBoundingClientRect();
      glisse = {
        personne,
        jeton: b,
        depart: { x: e.clientX, y: e.clientY },
        prise: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        pointerId: e.pointerId,
        aBouge: false,
        fantome: null,
        boite: null,
      };
      // Les ecouteurs vivent sur la FENETRE : le jeton, lui, disparait des
      // que le plan se redessine, et un ecouteur pose sur lui partirait avec.
      window.addEventListener("pointermove", pendantGlisse);
      window.addEventListener("pointerup", finirGlisse);
      window.addEventListener("pointercancel", finirGlisse);
    }

    function pendantGlisse(e) {
      if (!glisse || e.pointerId !== glisse.pointerId) return;

      if (!glisse.aBouge) {
        const parcouru = Math.hypot(e.clientX - glisse.depart.x, e.clientY - glisse.depart.y);
        if (parcouru < SEUIL_GLISSE) return;
        glisse.aBouge = true;
        glisse.jeton.classList.add("saisi");
        glisse.fantome = fantomeDe(
          glisse.jeton,
          saisis.has(glisse.personne.id) ? saisis.size : 1
        );
        if (glisse.jeton.setPointerCapture) {
          try {
            glisse.jeton.setPointerCapture(e.pointerId);
          } catch (erreur) {
            // Sans capture le glisser marche encore, il survit seulement
            // moins bien aux sorties de fenetre.
          }
        }
      }

      glisse.fantome.style.left = `${e.clientX - glisse.prise.x}px`;
      glisse.fantome.style.top = `${e.clientY - glisse.prise.y}px`;
      viser(boiteSous(e));
    }

    function finirGlisse(e) {
      if (!glisse || e.pointerId !== glisse.pointerId) return;

      window.removeEventListener("pointermove", pendantGlisse);
      window.removeEventListener("pointerup", finirGlisse);
      window.removeEventListener("pointercancel", finirGlisse);

      const { aBouge, fantome, boite, personne } = glisse;
      if (fantome) fantome.remove();
      if (boite) boite.classList.remove("visee");
      // Le jeton d'un groupe saisi garde sa marque : elle dit la selection,
      // pas le vol qui vient de finir.
      if (!saisis.has(personne.id)) glisse.jeton.classList.remove("saisi");

      if (aBouge && boite && e.type === "pointerup") {
        // Glisser l'un des jetons saisis les emporte tous : on ne deplace
        // pas une selection en la defaisant.
        const emportes = saisis.has(personne.id) ? new Set(saisis) : [personne.id];
        placer(emportes, unitesParCle.get(boite.dataset.cle));
      }

      glisse = null;
      vientDeGlisser = aBouge;
      setTimeout(() => {
        vientDeGlisser = false;
      }, 0);
    }

    // -------------------------------------------------------- rectangles

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
        // Un lit de chambre pour qui a demande un gite : l'ecart se marque
        // sur le jeton, la ou il se lit, et pas dans un message a part.
        //
        // Sur le TYPE quand la personne l'a precise : un gite de 4 n'est
        // pas un gite de 6, et les confondre ramenerait la grossierete que
        // l'inventaire venait justement de lever. Sur la categorie sinon.
        if (unite.cle !== TAS) {
          const parType = j.dataset.demandeId
            ? j.dataset.demandeId !== unite.logement_id
            : j.dataset.demande !== typeDe(unite);
          if (parType) {
            j.classList.add("ecart");
            const t = TYPES[j.dataset.demande];
            const quoi = t ? t.un : j.dataset.demande;
            j.title += ` — a demandé « ${quoi}${
              j.dataset.demandeId ? ", d'une autre taille" : ""
            } »`;
          }
        }
        places.appendChild(j);
      }
      if (!occupants.length) places.append(span("vide", "vide"));
      boite.appendChild(places);

      // La boite entiere est la zone d'arrivee, et non la seule bande des
      // jetons : viser trois pixels de haut dans un rectangle vide serait un
      // jeu d'adresse. C'est `boiteSous` qui la designe.
      boite.dataset.cle = unite.cle;
      unitesParCle.set(unite.cle, unite);

      boite.addEventListener("click", (e) => {
        if (e.target.closest(".jeton")) return; // le jeton gere son propre clic
        if (saisis.size) placer(saisis, unite);
      });

      return boite;
    }

    function dessiner() {
      const { unites, dormeurs, jour } = etat;
      // Les boites de l'ancien dessin n'existent plus : garder leurs clefs
      // ferait viser des rectangles disparus.
      unitesParCle.clear();
      zonePlan.textContent = "";

      const places = dormeurs.filter((d) => d.logement_id).length;
      const resume = dormeurs.length
        ? `nuit du ${afficherJour(jour)} — ${places} placé(s) sur ${dormeurs.length}`
        : `nuit du ${afficherJour(jour)} — personne ne dort sur place`;
      // Le compte des jetons saisis ne parait qu'a partir de deux : a un, la
      // marque sur le jeton suffit.
      compteur.textContent = saisis.size > 1 ? `${resume} · ${saisis.size} saisis` : resume;

      if (!unites.length) {
        const rien = document.createElement("p");
        rien.className = "note";
        rien.textContent =
          "L'inventaire des couchages est vide : il n'y a nulle part où poser quelqu'un.";
        zonePlan.appendChild(rien);
        return;
      }

      const dans = (cle) =>
        dormeurs.filter((d) => cleUnite(d.logement_id, d.numero) === cle);

      // Ceux qui restent a placer d'abord, en pleine largeur : c'est le tas
      // qui doit se vider, et c'est donc lui qu'on regarde.
      zonePlan.appendChild(
        rectangle(UNITE_TAS, dormeurs.filter((d) => !d.logement_id))
      );

      const grille = document.createElement("div");
      grille.className = "plan-grille";
      // LES COUCHAGES VIDES EN DERNIER. On lit un plan pour savoir qui est
      // avec qui : les rectangles qui ont quelque chose a dire passent
      // devant, et les places libres se rangent au bout -- ou on les
      // trouve justement quand on en cherche une.
      //
      // Le rang ne touche pas aux NOMS. « Chambre 3 » a ete nommee au
      // chargement, dans l'ordre de l'inventaire, et garde son numero ou
      // qu'elle s'affiche : sans cela les numeros danseraient a chaque
      // depose, et l'on ne pourrait plus se dire « mets-le en chambre 3 ».
      const garnies = unites.map((u) => ({ u, gens: dans(u.cle) }));
      const ordre = garnies
        .filter((x) => x.gens.length)
        .concat(garnies.filter((x) => !x.gens.length));
      for (const x of ordre) grille.appendChild(rectangle(x.u, x.gens));
      zonePlan.appendChild(grille);
    }

    // ------------------------------------------------------------ ecrire

    // « Alice → Chambre 2 » pour une personne, « 4 personnes → Chambre 2 »
    // pour plusieurs : au-dela de deux noms, la phrase devient une liste que
    // personne ne lit.
    function direDeplacement(gens, unite) {
      const qui = gens.length === 1 ? gens[0].prenom : `${gens.length} personnes`;
      if (unite.cle !== TAS) return `${qui} → ${unite.nom}.`;
      return `${qui} ${gens.length === 1 ? "n'a" : "n'ont"} plus de place attribuée.`;
    }

    async function placer(ids, unite) {
      const demandes = (typeof ids === "string" ? [ids] : [...ids])
        .map(parId)
        .filter(Boolean)
        // La page n'envoie que ce qu'elle a le droit d'envoyer. La base
        // refuse de toute facon -- mais un refus attendu n'a pas a produire
        // un message d'erreur.
        .filter((p) => p.mien);

      // Ceux qui y sont deja n'ont rien a faire : les renvoyer ferait une
      // ecriture pour rien.
      const aDeplacer = demandes.filter((p) =>
        unite.cle === TAS ? p.logement_id : cleUnite(p.logement_id, p.numero) !== unite.cle
      );

      if (!aDeplacer.length) {
        saisis.clear();
        return dessiner();
      }

      dire("Enregistrement…");
      try {
        // Une ecriture apres l'autre, et non toutes ensemble : chacune peut
        // declencher la sauvegarde hebdomadaire, et un echec au milieu
        // laisse un etat que le rechargement suivant sait dire.
        for (const p of aDeplacer) {
          await options.ecrire(p.id, unite.cle === TAS ? null : unite);
        }
        await recharger(etat.jour);
        dire(direDeplacement(aDeplacer, unite), "ok");
      } catch (erreur) {
        dire(erreur.message, "erreur");
        await recharger(etat.jour);
      }
    }

    // ----------------------------------------------------------- clavier

    document.addEventListener("keydown", (e) => {
      if (!saisis.size) return;
      // Dans un champ de saisie, ces touches gardent leur sens ordinaire --
      // effacer une lettre, pas vider une chambre.
      if (e.target && e.target.closest && e.target.closest("input, textarea, select")) {
        return;
      }
      if (e.key === "Escape") {
        saisis.clear();
        dessiner();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // `preventDefault` surtout pour le retour arriere, que certaines
        // configurations font encore reculer d'une page.
        e.preventDefault();
        placer(saisis, UNITE_TAS);
      }
    });

    return { recharger, jour: () => etat.jour };
  }

  // Cette page n'attend RIEN de ce qu'on lache dessus.
  //
  // Nos jetons ne passent plus par le glisser-deposer du navigateur : ils
  // n'en produisent aucun evenement. Ce garde-fou reste pour CE QUI VIENT DE
  // DEHORS -- un fichier, un lien glisse depuis une autre fenetre -- que le
  // navigateur ouvrirait en quittant la page, avec la saisie en cours.
  //
  // Sans condition, sur `window` autant que sur `document`, en phase de
  // CAPTURE : annuler `dragover` seul suffit a Chromium, pas a Firefox, qui
  // suit la specification et demande aussi `dragenter`.
  for (const cible of [window, document]) {
    for (const evenement of ["dragenter", "dragover", "drop"]) {
      cible.addEventListener(
        evenement,
        (e) => {
          // Un champ de saisie garde son comportement : y glisser du texte
          // est un geste legitime.
          if (e.target && e.target.closest && e.target.closest("input, textarea")) {
            return;
          }
          e.preventDefault();
        },
        true
      );
    }
  }

  return { monter, TAS, UNITE_TAS };
})();
