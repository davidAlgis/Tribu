"""Tarification : une couche de multiplication au-dessus des regles.

LES PRIX VIENNENT DE LA BASE (section 12 du schema), et non plus de
`config.toml`. Ils s'y reglaient a la main ; ils se reglent desormais
depuis la page d'administration, et deux grilles -- un fichier et un
ecran -- auraient fini par se contredire. La contradiction se serait lue
sur une facture. `config.toml` ne garde que ce qui n'est pas un prix :
le nom du sejour et la devise.

COMMENT SE CALCULE UNE NUIT EN CHAMBRE

    prix de la ligne (semaine ou week-end, selon le jour ou l'on se couche)
    - la reduction du regime, jamais en dessous de zero
    + le supplement vue mer
    le tout diminue de la remise, en pourcentage

Le prix de la ligne est celui de la PENSION COMPLETE : les autres regimes
s'en deduisent par une reduction en euros, parce que c'est ainsi qu'un
hotel les annonce -- « la demi-pension, c'est vingt euros de moins ». Un
bebe facture zero reste a zero : une reduction ne rend pas d'argent.

UN GITE NE SE FACTURE PAS PAR PERSONNE

C'est LE GITE qu'on paye -- un gite de six coute son prix qu'on y dorme a
quatre ou a six -- et la note se partage entre ceux qui y passent la nuit.
D'ou le besoin du PLAN DE COUCHAGE : sans lui, on sait que quelqu'un dort
en gite, mais pas dans lequel ni avec qui, donc pas quelle part lui
revient. Ceux qui n'ont pas de place attribuee ne sont donc factures de
rien et remontent dans `sans_place`, que l'export affiche : c'est un
travail qui reste a faire, pas un cadeau.

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
    GITE_NUIT,
    LIBELLES_REGIME,
    LIBELLES_REPAS,
    PENSION_COMPLETE,
    Prestations,
)

# Les nombres qui ne dependent d'aucun couchage, tels que la page les
# range. `''` en tranche : le montant ne depend pas de l'age.
VUE_MER = "vue_mer"


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
    jours_weekend: set[int] = field(default_factory=lambda: {4, 5})
    # logement_id -> {categorie, capacite, vue_mer}
    logements: dict[str, dict] = field(default_factory=dict)
    # (personne_id, jour) -> (logement_id, numero)
    couchages: dict[tuple[str, date], tuple[str, int]] = field(default_factory=dict)

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


def _facturer_chambres(prestations, personnes, grille, facturation) -> None:
    for nuitee in prestations.nuitees:
        if nuitee.hebergement != CHAMBRE:
            continue
        personne = personnes[nuitee.personne_id]

        # La place REELLE d'abord -- c'est la qu'on a dormi -- et le type
        # declare a defaut, pour qui n'a pas encore de place sur le plan.
        place = grille.couchages.get((nuitee.personne_id, _jour(nuitee.jour)))
        logement_id = place[0] if place else nuitee.logement_id

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


def _facturer_gites(prestations, personnes, grille, facturation) -> None:
    # Un gite se paye entier : on regroupe donc les dormeurs par unite --
    # la ligne d'inventaire ET le numero de l'exemplaire, sans quoi deux
    # gites jumeaux n'en feraient qu'un.
    par_unite: dict[tuple[date, str, int], list] = {}

    for nuitee in prestations.nuitees:
        if nuitee.hebergement != GITE:
            continue
        place = grille.couchages.get((nuitee.personne_id, _jour(nuitee.jour)))
        if place is None:
            # Sans place, pas de part : on ne sait ni quel gite ni avec
            # combien. C'est le plan de couchage qui le dira.
            facturation.sans_place.append((nuitee.personne_id, nuitee.jour))
            facturation.lignes.append(
                LigneFacture(
                    personne_id=nuitee.personne_id,
                    jour=nuitee.jour,
                    libelle=LIBELLES_REGIME[GITE_NUIT],
                    detail="gite sans place attribuee",
                    prix=0.0,
                )
            )
            continue
        par_unite.setdefault((_jour(nuitee.jour), place[0], place[1]), []).append(nuitee)

    for (jour, logement_id, numero), occupants in sorted(
        par_unite.items(), key=lambda x: (x[0][0], str(x[0][1]), x[0][2])
    ):
        prix, remise = _montant(grille, logement_id, "entier", jour)
        if prix <= 0:
            facturation.tarifs_manquants.add(f"{grille.nom(logement_id)} - le gite entier")

        occupants.sort(key=lambda n: n.personne_id)
        parts = _parts(_remiser(prix, remise), len(occupants))
        for nuitee, part in zip(occupants, parts):
            facturation.lignes.append(
                LigneFacture(
                    personne_id=nuitee.personne_id,
                    jour=nuitee.jour,
                    libelle=LIBELLES_REGIME[GITE_NUIT],
                    detail=f"{grille.nom(logement_id)} n° {numero}"
                    + (f", partage a {len(occupants)}" if len(occupants) > 1 else ""),
                    prix=part,
                )
            )


def _facturer_repas(prestations, personnes, grille, facturation) -> None:
    for repas in prestations.repas_hors_pension:
        personne = personnes[repas.personne_id]
        prix = grille.annexes.get((repas.repas, personne.categorie_age))

        if prix is None:
            facturation.tarifs_manquants.add(
                f"{LIBELLES_REPAS[repas.repas]} hors pension - {personne.categorie_age}"
            )
            prix = 0.0

        facturation.lignes.append(
            LigneFacture(
                personne_id=repas.personne_id,
                jour=repas.jour,
                libelle=LIBELLES_REPAS[repas.repas],
                detail="hors pension",
                prix=round(prix, 2),
            )
        )


def facturer(prestations: Prestations, personnes: dict, grille: Grille) -> Facturation:
    facturation = Facturation()
    _facturer_chambres(prestations, personnes, grille, facturation)
    _facturer_gites(prestations, personnes, grille, facturation)
    _facturer_repas(prestations, personnes, grille, facturation)
    facturation.lignes.sort(key=lambda l: (l.jour, l.personne_id, l.libelle))
    facturation.sans_place.sort(key=lambda x: (x[1], x[0]))
    return facturation
