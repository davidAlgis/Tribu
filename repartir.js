"use strict";

// Une premiere repartition des dormeurs dans les couchages.
//
// CE N'EST QU'UNE PROPOSITION. Elle remplit les places vides et ne touche
// a rien de ce qui est deja pose : l'organisateur qui a place trois
// familles a la main ne les retrouve pas ailleurs. Tout se redeplace
// ensuite d'un glisser, et le plan n'a jamais ete plus vrai que la main
// qui le corrige.
//
// POURQUOI UN FICHIER A PART, ici ou tout tient dans la page qui s'en
// sert : ceci n'est pas une aide de trois lignes, c'est un algorithme. Il
// se lit sans la page, il s'essaie sans navigateur, et une repartition qui
// separe une famille se voit alors AVANT le premier clic, pas apres.
//
// LES TROIS REGLES, DANS CET ORDRE -- l'ordre est ce qui tranche quand
// elles se contredisent :
//
//  1. LE SOUHAIT D'ABORD. Qui a demande une chambre va en chambre, qui a
//     demande la vue mer va avec vue. Jamais ailleurs : personne ne se
//     reveille en gite parce que c'etait plus commode a ranger. Si rien ne
//     correspond, la personne RESTE A PLACER -- et le tas qui ne se vide
//     pas est le vrai message : il dit qu'il manque des lits de ce
//     type-la, ce qu'une repartition « arrangeante » aurait cache.
//
//  2. LES CONJOINTS ENSEMBLE. Ils forment un bloc, et un bloc se pose
//     entier ou pas du tout.
//
//  3. LES MOINS DE HUIT ANS AVEC LEURS PARENTS, quand la place suffit.
//     Sinon ils restent a placer : un enfant de quatre ans seul dans une
//     chambre n'est pas une demi-solution, c'en est une mauvaise.
//
// Le souhait passe avant le foyer, et c'est voulu : deux conjoints qui
// n'ont pas demande la meme chose ne forment pas un bloc, et chacun suit
// ce qu'il a ecrit. La regle 1 prime, l'un d'eux s'est trompe, et c'est
// visible tout de suite.

window.REPARTIR = (function () {
  // Huit ans : l'age en dessous duquel on ne dort pas sans ses parents.
  // Il n'a rien a voir avec les bornes de facturation (`age_bebe`,
  // `age_enfant`), qui disent ce qu'une nuit coute et non avec qui elle se
  // passe. Deux questions differentes, deux nombres differents.
  const AGE_AVEC_PARENTS = 8;

  function cle(u) {
    return `${u.logement_id}#${u.numero}`;
  }

  function comparer(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // Le type precis demande, quand TOUT le bloc demande le meme. Des
  // souhaits differents ne se moyennent pas : il n'y a alors rien a
  // preferer, et la categorie suffira.
  function memeDemande(gens) {
    const tous = new Set(gens.map((p) => p.demande_id || ""));
    return tous.size === 1 ? [...tous][0] || null : null;
  }

  // L'unite ou dorment DEJA des membres du bloc -- la plus peuplee d'entre
  // elles si l'organisateur en avait commence deux. Les autres l'y
  // rejoignent, ou restent a placer : on ne separe pas une famille pour la
  // seule raison qu'un lit etait libre ailleurs.
  function uniteDeja(gens, unites) {
    const compte = new Map();
    for (const p of gens) {
      if (!p.logement_id) continue;
      const k = cle(p);
      compte.set(k, (compte.get(k) || 0) + 1);
    }
    if (!compte.size) return null;
    const retenue = [...compte.entries()].sort(
      (a, b) => b[1] - a[1] || comparer(a[0], b[0])
    )[0][0];
    return unites.find((u) => cle(u) === retenue) || null;
  }

  // La meilleure unite pouvant accueillir `combien` personnes.
  //
  // `mode` dit ce que « meilleure » veut dire, et les deux sens sont
  // justes a leur tour :
  //
  //   "juste" -- LA PLUS PETITE QUI SUFFIT. Donner un gite de six a un
  //              couple, c'est le retirer a la famille de six qui passe
  //              apres.
  //   "large" -- LA PLUS GRANDE. On n'y vient que parce que le bloc
  //              entier n'entre nulle part : ce qui reste de place servira
  //              aux enfants qu'on pourra quand meme emmener.
  //
  //  A taille egale, LA PLUS VIDE. C'est ce qui evite d'empiler deux
  //  personnes seules dans une chambre pendant que la chambre d'a cote
  //  reste vide : personne n'a demande a partager avec quelqu'un en
  //  particulier, et une proposition qui etale se corrige plus facilement
  //  qu'une proposition qui tasse.
  function meilleure(candidates, combien, restant, demande, mode) {
    const prefere = (u) => (demande && u.logement_id === demande ? 0 : 1);
    const libre = (u) => restant.get(cle(u));
    const possibles = candidates.filter((u) => libre(u) >= combien);
    possibles.sort(
      (x, y) =>
        // Le type exactement demande passe devant : « gite de 6 » n'est
        // pas « gite de 4 », et l'inventaire sait la difference.
        prefere(x) - prefere(y) ||
        (mode === "large"
          ? libre(y) - libre(x) || y.capacite - x.capacite
          : x.capacite - y.capacite || libre(y) - libre(x)) ||
        x.numero - y.numero ||
        comparer(cle(x), cle(y))
    );
    return possibles[0] || null;
  }

  // `plan` est ce que rend `admin_couchages` : les unites d'une nuit, et
  // ceux qui y dorment. Rien n'est ecrit ici -- la fonction rend la liste
  // des places, et c'est l'appelant qui l'envoie.
  function repartir(plan, reglages) {
    const seuil = (reglages && reglages.ageAvecParents) || AGE_AVEC_PARENTS;
    const dormeurs = (plan && plan.dormeurs) || [];
    const unites = (plan && plan.unites) || [];
    const parId = new Map(dormeurs.map((d) => [d.id, d]));

    // Sans date de naissance, la categorie de facturation tranche -- et
    // elle tranche du cote prudent. Prendre un enfant de six ans pour un
    // grand le laisse seul dans une chambre ; prendre un grand de dix ans
    // pour un petit le met avec ses parents, ce qui n'a jamais fait de mal
    // a personne. Ne pas savoir doit couter le moins cher des deux.
    const jeune = (p) =>
      p.age === null || p.age === undefined
        ? p.categorie_age !== "adulte"
        : p.age < seuil;

    // Le conjoint, quand il dort la aussi. Le lien peut n'etre pose que
    // d'un seul cote : on le cherche des deux.
    const conjointDe = (p) => {
      for (const q of dormeurs) {
        if (q.id === p.id) continue;
        if (q.id === p.conjoint_id || (q.conjoint_id && q.conjoint_id === p.id)) return q;
      }
      return null;
    };

    // Le foyer : soi, ou le couple qu'on forme. Designe par le plus petit
    // des deux identifiants, pour que les deux conjoints tombent sur la
    // meme clef sans se concerter.
    const foyer = new Map();
    for (const p of dormeurs) {
      const q = conjointDe(p);
      foyer.set(p.id, q ? [p.id, q.id].sort()[0] : p.id);
    }
    // Un jeune enfant n'a pas de foyer a lui : il prend celui de son
    // parent, quand ce parent dort la. Sinon il garde le sien, se
    // retrouve seul dans son bloc, et un bloc sans adulte ne se pose pas.
    // C'est la regle 3 qui s'applique, et non un oubli.
    for (const p of dormeurs) {
      if (!jeune(p)) continue;
      const parent = p.parent_id ? parId.get(p.parent_id) : null;
      if (parent) foyer.set(p.id, foyer.get(parent.id));
    }

    // Un bloc = un foyer qui demande la meme chose. Le souhait entre dans
    // la clef parce qu'il prime sur le foyer (regle 1 avant regle 2).
    const blocs = new Map();
    for (const p of dormeurs) {
      const k = `${foyer.get(p.id)}|${p.hebergement}|${p.vue_mer ? "mer" : ""}`;
      if (!blocs.has(k)) {
        blocs.set(k, {
          cle: k,
          categorie: p.hebergement,
          vue_mer: !!p.vue_mer,
          gens: [],
        });
      }
      blocs.get(k).gens.push(p);
    }

    const liste = [...blocs.values()]
      .map((b) => {
        const aPoser = b.gens.filter((p) => !p.logement_id);
        return {
          ...b,
          aPoser,
          adultes: aPoser.filter((p) => !jeune(p)),
          // Les plus petits d'abord : si la place manque pour tous, ce
          // sont eux qui doivent l'avoir.
          petits: aPoser
            .filter((p) => jeune(p))
            .sort(
              (x, y) =>
                (x.age === null || x.age === undefined ? 99 : x.age) -
                  (y.age === null || y.age === undefined ? 99 : y.age) ||
                comparer(x.prenom, y.prenom) ||
                comparer(x.id, y.id)
            ),
          // Un adulte du bloc, meme deja pose ailleurs : un enfant peut
          // rejoindre un parent qui dort deja quelque part.
          unAdulte: b.gens.some((p) => !jeune(p)),
          demande_id: memeDemande(b.gens),
          premier: b.gens.map((p) => p.prenom).sort()[0],
        };
      })
      .filter((b) => b.aPoser.length && b.unAdulte)
      // Les gros blocs d'abord. Une famille de cinq n'a qu'un ou deux
      // endroits possibles ; une personne seule en a vingt. Servir le
      // contraint avant le libre est ce qui place le plus de monde.
      .sort(
        (x, y) =>
          y.aPoser.length - x.aPoser.length ||
          comparer(x.premier, y.premier) ||
          comparer(x.cle, y.cle)
      );

    const restant = new Map(unites.map((u) => [cle(u), u.capacite]));
    for (const p of dormeurs) {
      if (!p.logement_id) continue;
      const k = cle(p);
      if (restant.has(k)) restant.set(k, restant.get(k) - 1);
    }

    const places = [];
    for (const b of liste) {
      const ensemble = uniteDeja(b.gens, unites);
      // Sans personne de pose, tout ce qui correspond au souhait. Avec,
      // cette unite-la et elle seule.
      const candidates = ensemble
        ? [ensemble]
        : unites.filter((u) => u.categorie === b.categorie && !!u.vue_mer === b.vue_mer);

      let u = meilleure(candidates, b.aPoser.length, restant, b.demande_id, "juste");
      let poses = b.aPoser;

      // Le bloc entier n'entre nulle part. Les adultes prennent alors la
      // plus grande unite qui reste, et emmenent autant de petits qu'elle
      // en accepte : les autres restent a placer. C'est la regle 3, lue
      // enfant par enfant et non tout ou rien -- deux petits sous l'aile
      // de leurs parents valent mieux qu'aucun.
      if (!u && b.petits.length) {
        // Un bloc dont les adultes dorment deja la n'a plus de socle a
        // poser : il reste a y glisser les enfants, d'ou le minimum d'une
        // place.
        const socle = b.adultes.length;
        u = meilleure(candidates, Math.max(socle, 1), restant, b.demande_id, "large");
        if (u) {
          poses = b.adultes.concat(b.petits.slice(0, restant.get(cle(u)) - socle));
        }
      }
      if (!u || !poses.length) continue;

      for (const p of poses) {
        places.push({
          participant_id: p.id,
          logement_id: u.logement_id,
          numero: u.numero,
        });
      }
      restant.set(cle(u), restant.get(cle(u)) - poses.length);
    }

    const deja = dormeurs.filter((p) => p.logement_id).length;
    return {
      places,
      total: dormeurs.length,
      deja,
      poses: places.length,
      restent: dormeurs.length - deja - places.length,
    };
  }

  return { repartir, AGE_AVEC_PARENTS };
})();
