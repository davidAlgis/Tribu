"""Tarification : une couche de multiplication au-dessus des regles.

LES PRIX VIENNENT DE LA BASE (section 12 du schema), et non plus de
`config.toml`. Ils s'y reglaient a la main ; ils se reglent desormais
depuis la page d'administration, et deux grilles -- un fichier et un
ecran -- auraient fini par se contredire. La contradiction se serait lue
sur une facture. `config.toml` ne garde que ce qui n'est pas un prix :
le nom du sejour et la devise.

LA TAXE DE SEJOUR EST A PART

Par adulte et par nuit, quel que soit le couchage. Elle ne se remise
pas, ne depend pas du regime, et ne se partage pas entre les occupants
d'un gite : c'est la personne qui la doit. Elle sort donc en ligne
distincte, comme sur une note d'hotel.

UNE NUIT A DEUX PARTS, ET ELLES S'ADDITIONNENT

Chaque type de logement dit lesquelles il a (`part_logement`,
`part_personne`, section 11 du schema). Le mot « chambre » decidait des
deux a la fois ; il n'en decide plus.

    part par personne (`par_occupant`) -- ce que chaque occupant paie
      prix de sa tranche d'age (semaine ou week-end, selon le jour ou
        l'on se couche)
      - la reduction du regime, jamais en dessous de zero
      + le supplement vue mer
      le tout diminue de la remise, en pourcentage

    part du logement (`fixe` ou `selon_occupation`) -- ce que coute le
      logement lui-meme, PARTAGE entre ceux qui y passent la nuit
      `fixe`             un seul prix, ligne « entier »
      `selon_occupation` un prix par nombre d'occupants, lignes
                         « entier_1 », « entier_2 »...

Une chambre d'hier n'avait que la premiere, un gite que la seconde. Un
hotel qui fait payer la chambre ET la personne a les deux, et rien dans
le calcul n'a eu a changer pour cela : les deux boucles ont simplement
cesse de s'exclure.

Le prix par personne est celui de la PENSION COMPLETE quand la nuit
comprend des repas : les autres regimes s'en deduisent par une reduction
en euros, parce que c'est ainsi qu'un hotel les annonce -- « la
demi-pension, c'est vingt euros de moins ». Un type qui ne comprend aucun
repas n'a pas de regime, donc pas de reduction. Un bebe facture zero
reste a zero : une reduction ne rend pas d'argent.

LA PART DU LOGEMENT EXIGE LE PLAN DE COUCHAGE

Sans lui, on sait que quelqu'un dort la, mais pas dans quel exemplaire ni
avec qui -- donc pas quelle part lui revient. Ceux qui n'ont pas de place
attribuee ne sont factures de rien et remontent dans `sans_place`, que
l'export affiche : c'est un travail qui reste a faire, pas un cadeau.
Cela ne concernait que les gites ; cela concerne desormais tout type qui
se paie au logement.

Un tarif absent ne fait pas planter le calcul : la ligne est facturee 0 et
remontee dans `tarifs_manquants`. L'export liste alors exactement les prix
qu'il reste a poser.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from engine.rules import (
    CHAMBRE,
    GITE,
    LIBELLES_REGIME,
    LIBELLES_REPAS,
    PENSION_COMPLETE,
    Prestations,
)

# La ligne de la part du logement. Ce n'est pas un regime -- une chambre
# peut la porter tout en comprenant des repas -- donc pas un libelle de
# `LIBELLES_REGIME` : c'est LE LOGEMENT qu'on paye.
LIBELLE_LOGEMENT = "Le logement"

# Ce que le type dit de sa facturation. Les memes mots que la base.
AUCUNE = "aucune"
FIXE = "fixe"
SELON_OCCUPATION = "selon_occupation"
PAR_OCCUPANT = "par_occupant"

# Les nombres qui ne dependent d'aucun couchage, tels que la page les
# range. `''` en tranche : le montant ne depend pas de l'age.
VUE_MER = "vue_mer"
TAXE_SEJOUR = "taxe_sejour"


@dataclass(frozen=True)
class LigneFacture:
    personne_id: str
    jour: object
    libelle: str
    detail: str
    prix: float


@dataclass
class Facturation:
    lignes: list[LigneFacture] = field(default_factory=list)
    tarifs_manquants: set[str] = field(default_factory=set)
    # (personne_id, jour) : en gite, mais sans place attribuee ce soir-la.
    sans_place: list[tuple[str, date]] = field(default_factory=list)

    @property
    def total(self) -> float:
        return round(sum(ligne.prix for ligne in self.lignes), 2)


@dataclass
class Grille:
    """La grille des prix, telle que la base la garde.

    Une seule forme pour deux sources : les vues Supabase et le fichier
    JSON de demonstration. Le moteur ne sait pas d'ou elle vient.
    """

    # (logement_id, tranche) -> {semaine, weekend, remise}
    prix: dict[tuple[str, str], dict] = field(default_factory=dict)
    # (cle, tranche) -> montant
    annexes: dict[tuple[str, str], float] = field(default_factory=dict)
    # (jour, repas, tranche) -> montant. Les jours qui font exception : le
    # diner du samedi n'est pas celui du mardi. Ce qui n'y est pas se
    # facture au prix ordinaire, dans `annexes`.
    repas_jour: dict[tuple[date, str, str], float] = field(default_factory=dict)
    jours_weekend: set[int] = field(default_factory=lambda: {4, 5})
    # logement_id -> {categorie, capacite, vue_mer}
    logements: dict[str, dict] = field(default_factory=dict)
    # (personne_id, jour) -> (logement_id, numero)
    couchages: dict[tuple[str, date], tuple[str, int]] = field(default_factory=dict)

    # --- Comment un type se facture -------------------------------
    #
    # Le repli par categorie n'est pas une commodite : un type declare
    # sans taille -- « en chambre », generique -- ne designe aucune ligne
    # d'inventaire, et il faut bien le facturer quand meme. C'est aussi ce
    # qui laisse passer les jeux de test ecrits avant ce reglage.

    def part_personne(self, logement_id, hebergement: str) -> str:
        ligne = self.logements.get(logement_id)
        if ligne and ligne.get("part_personne"):
            return ligne["part_personne"]
        return AUCUNE if hebergement == GITE else PAR_OCCUPANT

    def part_logement(self, logement_id, hebergement: str) -> str:
        ligne = self.logements.get(logement_id)
        if ligne and ligne.get("part_logement"):
            return ligne["part_logement"]
        return FIXE if hebergement == GITE else AUCUNE

    def nom(self, logement_id: str) -> str:
        """« gite de 6 », « chambre vue mer de 2 » -- de quoi lire un
        tarif manquant sans aller chercher l'identifiant en base."""
        logement = self.logements.get(logement_id)
        if not logement:
            return str(logement_id)
        quoi = logement["categorie"]
        if logement.get("vue_mer"):
            quoi += " vue mer"
        return f"{quoi} de {logement['capacite']}"


def _jour(valeur) -> date:
    return valeur if isinstance(valeur, date) else date.fromisoformat(str(valeur))


def grille_depuis(donnees: dict) -> Grille:
    """Construit la grille a partir de ce que rendent les vues d'export
    (ou le meme bloc, ecrit a la main dans le JSON de demonstration)."""
    grille = Grille()

    for ligne in donnees.get("logements", []):
        grille.logements[ligne["id"]] = {
            "categorie": ligne["categorie"],
            "capacite": ligne["capacite"],
            "vue_mer": bool(ligne.get("vue_mer", False)),
            # Comment ce type se facture. Absents d'un jeu de donnees
            # ecrit avant ce reglage : les methodes de `Grille` retombent
            # alors sur la regle de la categorie.
            "part_logement": ligne.get("part_logement"),
            "part_personne": ligne.get("part_personne"),
            "repas_compris": ligne.get("repas_compris"),
        }

    for ligne in donnees.get("tarifs", []):
        grille.prix[(ligne["logement_id"], ligne["tranche"])] = {
            "semaine": float(ligne.get("semaine") or 0),
            "weekend": float(ligne.get("weekend") or 0),
            "remise": float(ligne.get("remise") or 0),
        }

    for ligne in donnees.get("annexes", []):
        grille.annexes[(ligne["cle"], ligne.get("tranche") or "")] = float(
            ligne.get("montant") or 0
        )

    for ligne in donnees.get("repas_jour", []):
        grille.repas_jour[
            (_jour(ligne["jour"]), ligne["repas"], ligne["tranche"])
        ] = float(ligne.get("montant") or 0)

    jours = donnees.get("jours_weekend")
    if jours is not None:
        grille.jours_weekend = {int(j) for j in jours}

    for ligne in donnees.get("couchages", []):
        personne = ligne.get("participant_id") or ligne["personne_id"]
        grille.couchages[(personne, _jour(ligne["jour"]))] = (
            ligne["logement_id"],
            int(ligne["numero"]),
        )

    return grille


def charger_config(chemin: str | Path) -> dict:
    """`config.toml` : le nom du sejour et la devise, rien de plus.

    L'import est fait ICI et non en tete : `tomllib` est arrive avec
    Python 3.11, et le calcul des prix -- qui ne lit plus ce fichier --
    n'a pas a devenir inutilisable sur une version anterieure pour deux
    libelles d'en-tete.
    """
    import tomllib

    with open(chemin, "rb") as f:
        return tomllib.load(f)


def _montant(grille: Grille, logement_id: str, tranche: str, jour) -> tuple[float, float]:
    """(prix de la nuit, remise en %) pour une ligne de la grille.

    Un prix de week-end a zero veut dire « comme la semaine » et non
    « gratuit » : beaucoup d'hotels n'ont qu'un seul prix, et la colonne
    reste alors vide. Une nuit d'hotel n'est jamais gratuite -- si le prix
    de semaine est a zero, c'est qu'il n'a pas ete pose, et il remonte
    dans les tarifs manquants.
    """
    ligne = grille.prix.get((logement_id, tranche))
    if ligne is None:
        return 0.0, 0.0
    weekend = _jour(jour).weekday() in grille.jours_weekend
    montant = ligne["weekend"] if weekend and ligne["weekend"] > 0 else ligne["semaine"]
    return montant, ligne["remise"]


def _remiser(prix: float, remise: float) -> float:
    return round(prix * (1 - remise / 100), 2)


def _detail_chambre(grille: Grille, logement_id, vue_mer: bool) -> str:
    """Ce que la ligne de facture affiche.

    Le nom du couchage dit deja la vue quand elle est dans l'inventaire :
    « chambre vue mer de 2 + vue mer » se lirait comme deux supplements
    pour un seul. Le suffixe ne sert qu'au cas ou la vue a ete cochee sur
    une chambre ordinaire.
    """
    if logement_id is None:
        return "chambre + vue mer" if vue_mer else "chambre"
    nom = grille.nom(logement_id)
    deja = grille.logements.get(logement_id, {}).get("vue_mer", False)
    return nom + (" + vue mer" if vue_mer and not deja else "")


def _facturer_par_personne(prestations, personnes, grille, facturation) -> None:
    for nuitee in prestations.nuitees:
        # La place REELLE d'abord -- c'est la qu'on a dormi -- et le type
        # declare a defaut, pour qui n'a pas encore de place sur le plan.
        place = grille.couchages.get((nuitee.personne_id, _jour(nuitee.jour)))
        logement_id = place[0] if place else nuitee.logement_id

        if grille.part_personne(logement_id, nuitee.hebergement) == AUCUNE:
            continue
        personne = personnes[nuitee.personne_id]

        if logement_id is None:
            facturation.tarifs_manquants.add(
                "chambre sans type declare ni place attribuee"
            )
            prix, remise = 0.0, 0.0
        else:
            prix, remise = _montant(grille, logement_id, personne.categorie_age, nuitee.jour)
            if prix <= 0:
                facturation.tarifs_manquants.add(
                    f"{grille.nom(logement_id)} - {personne.categorie_age}"
                )

        # Le prix de la ligne est celui de la pension complete ; les autres
        # regimes s'en retranchent, sans jamais passer sous zero.
        if nuitee.regime != PENSION_COMPLETE:
            prix = max(0.0, prix - grille.annexes.get((nuitee.regime, ""), 0.0))

        if nuitee.vue_mer:
            prix += grille.annexes.get((VUE_MER, ""), 0.0)

        facturation.lignes.append(
            LigneFacture(
                personne_id=nuitee.personne_id,
                jour=nuitee.jour,
                libelle=LIBELLES_REGIME[nuitee.regime],
                detail=_detail_chambre(grille, logement_id, nuitee.vue_mer),
                prix=_remiser(prix, remise),
            )
        )


def _parts(total: float, combien: int) -> list[float]:
    """Partage un prix en parts egales, au centime pres.

    Le reste de l'arrondi va a la premiere part : sans cela, la somme des
    parts ne fait pas le prix du gite, et l'ecart se lit sur le total.
    """
    total = round(total, 2)
    part = round(total / combien, 2)
    parts = [part] * combien
    parts[0] = round(total - part * (combien - 1), 2)
    return parts


def _facturer_au_logement(prestations, personnes, grille, facturation) -> None:
    # Le logement se paye entier : on regroupe donc les dormeurs par unite
    # -- la ligne d'inventaire ET le numero de l'exemplaire, sans quoi deux
    # gites jumeaux n'en feraient qu'un.
    par_unite: dict[tuple[date, str, int], list] = {}

    for nuitee in prestations.nuitees:
        place = grille.couchages.get((nuitee.personne_id, _jour(nuitee.jour)))
        logement_id = place[0] if place else nuitee.logement_id
        mode = grille.part_logement(logement_id, nuitee.hebergement)
        if mode == AUCUNE:
            continue
        if place is None:
            # Sans place, pas de part : on ne sait ni quel exemplaire ni
            # avec combien. C'est le plan de couchage qui le dira.
            facturation.sans_place.append((nuitee.personne_id, nuitee.jour))
            facturation.lignes.append(
                LigneFacture(
                    personne_id=nuitee.personne_id,
                    jour=nuitee.jour,
                    libelle=LIBELLE_LOGEMENT,
                    detail="logement sans place attribuee",
                    prix=0.0,
                )
            )
            continue
        par_unite.setdefault((_jour(nuitee.jour), place[0], place[1]), []).append(nuitee)

    for (jour, logement_id, numero), occupants in sorted(
        par_unite.items(), key=lambda x: (x[0][0], str(x[0][1]), x[0][2])
    ):
        # `selon_occupation` : le prix depend du nombre de dormeurs de la
        # nuit -- la chambre a deux ne coute pas la chambre a trois. Une
        # ligne par occupation, et le prix plat en repli : un hotel qui
        # n'aurait rempli que « entier » ne facture pas zero pour autant.
        combien = len(occupants)
        mode = grille.part_logement(logement_id, occupants[0].hebergement)
        tranche = f"entier_{combien}" if mode == SELON_OCCUPATION else "entier"
        prix, remise = _montant(grille, logement_id, tranche, jour)
        if prix <= 0 and tranche != "entier":
            prix, remise = _montant(grille, logement_id, "entier", jour)
        if prix <= 0:
            facturation.tarifs_manquants.add(
                f"{grille.nom(logement_id)} - le logement entier"
                + (f", a {combien}" if mode == SELON_OCCUPATION else "")
            )

        occupants.sort(key=lambda n: n.personne_id)
        parts = _parts(_remiser(prix, remise), combien)
        for nuitee, part in zip(occupants, parts):
            facturation.lignes.append(
                LigneFacture(
                    personne_id=nuitee.personne_id,
                    jour=nuitee.jour,
                    libelle=LIBELLE_LOGEMENT,
                    detail=f"{grille.nom(logement_id)} n° {numero}"
                    + (f", partage a {combien}" if combien > 1 else ""),
                    prix=part,
                )
            )


def _facturer_taxe(prestations, personnes, grille, facturation) -> None:
    """La taxe de sejour : par adulte et par nuit, quel que soit le lit.

    UNE LIGNE A PART, et non un ajout au prix de la nuit. Elle ne suit
    aucune des regles qui valent pour les prix :

      - elle ne se remise pas -- une taxe ne se negocie pas ;
      - elle ne depend pas du regime -- on la doit en demi-pension comme
        en pension complete ;
      - elle NE SE PARTAGE PAS entre les occupants d'un gite : c'est la
        personne qui la doit, pas le couchage.

    Les mineurs en sont exoneres, ce que traduit ici la seule tranche
    « adulte » -- la borne « jeune » des reglages dit ou s'arrete la
    minorite, et elle se regle par commune.

    Une taxe a zero n'est pas un oubli : beaucoup de communes n'en levent
    aucune. Elle ne remonte donc pas dans les tarifs manquants.
    """
    montant = grille.annexes.get((TAXE_SEJOUR, ""), 0.0)
    if not montant:
        return

    for nuitee in prestations.nuitees:
        if personnes[nuitee.personne_id].categorie_age != "adulte":
            continue
        facturation.lignes.append(
            LigneFacture(
                personne_id=nuitee.personne_id,
                jour=nuitee.jour,
                libelle="Taxe de sejour",
                detail="par adulte et par nuit",
                prix=round(montant, 2),
            )
        )


def _facturer_repas(prestations, personnes, grille, facturation) -> None:
    for repas in prestations.repas_hors_pension:
        personne = personnes[repas.personne_id]

        # Le prix du jour d'abord, quand ce jour-la fait exception ; le
        # prix ordinaire sinon.
        exception = grille.repas_jour.get(
            (_jour(repas.jour), repas.repas, personne.categorie_age)
        )
        prix = (
            exception
            if exception is not None
            else grille.annexes.get((repas.repas, personne.categorie_age))
        )

        # Absent ou a zero : meme signalement que pour les nuits. Rien ne
        # distingue un repas offert d'un prix oublie, et le lire coute
        # moins cher que le rater.
        if not prix:
            facturation.tarifs_manquants.add(
                f"{LIBELLES_REPAS[repas.repas]} hors pension - {personne.categorie_age}"
                + (f" ({repas.jour})" if exception is not None else "")
            )
            prix = 0.0

        facturation.lignes.append(
            LigneFacture(
                personne_id=repas.personne_id,
                jour=repas.jour,
                libelle=LIBELLES_REPAS[repas.repas],
                detail="hors pension" + (", tarif du jour" if exception is not None else ""),
                prix=round(prix, 2),
            )
        )


def facturer(prestations: Prestations, personnes: dict, grille: Grille) -> Facturation:
    facturation = Facturation()
    # LES DEUX PARTS NE S'EXCLUENT PLUS : un type qui les a toutes les deux
    # passe dans les deux boucles, et sa nuit coute la somme.
    _facturer_par_personne(prestations, personnes, grille, facturation)
    _facturer_au_logement(prestations, personnes, grille, facturation)
    _facturer_taxe(prestations, personnes, grille, facturation)
    _facturer_repas(prestations, personnes, grille, facturation)
    facturation.lignes.sort(key=lambda l: (l.jour, l.personne_id, l.libelle))
    facturation.sans_place.sort(key=lambda x: (x[1], x[0]))
    return facturation
