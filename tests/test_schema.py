"""Le schéma tient-il les contraintes de l'hébergeur ?

Supabase charge l'extension `safeupdate` pour le rôle qui sert l'API. Elle
refuse tout `UPDATE` et tout `DELETE` dépourvu de clause `WHERE` :

    UPDATE requires a WHERE clause

Sur une table qui n'a qu'une ligne, la clause paraît superflue — et c'est
exactement pour ça qu'on l'oublie. Le SQL se pose sans broncher, la
fonction se crée, et l'erreur n'apparaît qu'au premier clic de
l'organisateur, des mois plus tard.

Ces tests ne lisent que l'intérieur des fonctions : c'est là que passe
l'API. Les instructions de premier niveau, elles, tournent dans l'éditeur
SQL sous un autre rôle, où l'extension n'est pas chargée.
"""

import re
from pathlib import Path

import pytest

SCHEMA = (Path(__file__).resolve().parent.parent / "supabase" / "schema.sql").read_text(
    encoding="utf-8"
)

# Le corps d'une fonction, entre ses deux marqueurs `$fn$`.
CORPS = re.compile(r"create (?:or replace )?function\s+([\w.]+)\(.*?\$fn\$(.*?)\$fn\$", re.DOTALL | re.I)


def instructions(mot: str):
    """(nom de la fonction, instruction) pour chaque `mot` trouvé dans un corps."""
    trouves = []
    for fonction in CORPS.finditer(SCHEMA):
        nom, corps = fonction.group(1), fonction.group(2)
        for m in re.finditer(r"\n\s*" + mot + r"\s+[\w.]+\s+set\b(.*?);"
                             if mot == "update"
                             else r"\n\s*" + mot + r"\s+from\s+[\w.]+(.*?);",
                             corps, re.DOTALL | re.I):
            trouves.append((nom, " ".join(m.group(0).split())))
    return trouves


def test_il_y_a_bien_des_fonctions_a_examiner():
    """Si l'extraction cassait, tous les tests passeraient pour rien."""
    assert len(CORPS.findall(SCHEMA)) > 15


@pytest.mark.parametrize("mot", ["update", "delete"])
def test_aucune_ecriture_sans_clause_where(mot):
    """`safeupdate` les refuse, et l'erreur ne sort qu'à l'exécution."""
    fautives = [
        (nom, texte)
        for nom, texte in instructions(mot)
        if not re.search(r"\bwhere\b", texte, re.I)
    ]
    assert fautives == [], (
        f"{mot.upper()} sans WHERE — Supabase le refusera au premier appel"
    )


def test_la_table_a_ligne_unique_se_designe_par_son_id():
    """`private.reglages` n'a qu'une ligne, et c'est `id` qui la désigne.

    Le test vaut surtout pour le lecteur : il explique pourquoi les
    fonctions écrivent `where id` sur une table qui n'a rien à filtrer.
    """
    assert re.search(
        r"create table if not exists private\.reglages\s*\(\s*\n\s*id\s+boolean primary key",
        SCHEMA,
    )
    for nom, texte in instructions("update"):
        if "private.reglages" in texte:
            assert re.search(r"where id\b", texte, re.I), f"{nom} : attendu `where id`"


def test_chaque_fonction_fige_son_search_path():
    """Une fonction `security definer` sans `search_path` fixe se laisse
    détourner par un objet homonyme créé ailleurs."""
    sans = []
    for m in re.finditer(
        r"create (?:or replace )?function\s+([\w.]+)\(.*?\$fn\$", SCHEMA, re.DOTALL | re.I
    ):
        entete = m.group(0)
        if "security definer" in entete.lower() and "set search_path" not in entete.lower():
            sans.append(m.group(1))
    assert sans == [], "fonctions `security definer` sans search_path figé"

def test_chaque_fonction_publique_est_appelable():
    """Une fonction posee sans `grant execute` existe et reste injoignable :
    PostgREST repond 404 au premier clic, des mois apres, sur une page qui
    n'a jamais servi.

    On compare les NOMS et non les signatures : le but est d'attraper le
    grant oublie, pas de rejouer la resolution de surcharge de Postgres.

    Les deux motifs sont ancres en debut de ligne (`^`, mode multiligne) :
    sans cela, un `grant` mis en commentaire d'un `--` compterait encore.
    """
    posees = set(
        re.findall(r"^create (?:or replace )?function\s+public\.(\w+)\(", SCHEMA, re.I | re.M)
    )
    ouvertes = set(
        re.findall(r"^grant execute on function\s+public\.(\w+)\(", SCHEMA, re.I | re.M)
    )
    assert posees, "aucune fonction publique trouvee, le test ne sert a rien"
    assert sorted(posees - ouvertes) == [], "fonctions publiques sans `grant execute`"


def test_aucun_grant_ne_vise_une_fonction_absente():
    """Le miroir du test precedent, et il a coute un collage.

    `grant execute on function f(...)` sur une fonction qui n'existe plus
    ne s'ignore pas : Postgres refuse, et le script s'arrete LA -- a
    moitie pose, avec tout ce qui suit non applique. Trois fonctions
    avaient ete remplacees par une seule ; deux `grant` avaient suivi, le
    troisieme etait reste.

    Le test precedent ne pouvait pas l'attraper : il cherche les
    fonctions sans grant, pas les grants sans fonction.
    """
    posees = set(
        re.findall(r"^create (?:or replace )?function\s+public\.(\w+)\(", SCHEMA, re.I | re.M)
    )
    ouvertes = set(
        re.findall(r"^grant execute on function\s+public\.(\w+)\(", SCHEMA, re.I | re.M)
    )
    assert sorted(ouvertes - posees) == [], (
        "`grant execute` sur des fonctions que le script ne pose pas — "
        "Postgres refusera et s'arretera la"
    )


# --- Recoller le script ne doit rien effacer -----------------------------
#
# Le fichier se recolle EN ENTIER a chaque changement : c'est la seule
# facon de poser une fonction. Toute instruction destructrice de premier
# niveau s'execute donc à chaque fois. Un `drop table public.presences` y a
# vécu longtemps sans se voir — tant que la table était vide — puis a
# emporté la saisie de soixante personnes d'un coup.

# Les tables qui portent de la donnée saisie ou déclarée. Les perdre, c'est
# perdre du travail que personne ne peut deviner.
SAISIE = [
    "public.presences",
    "public.voeux",
    "public.refus_lieu",
    "private.participants",
    "private.options_date",
    "private.logements",
    "private.couchages",
    "private.activites",
    "private.envies",
    "private.sauvegardes",
    "private.reglages",
    "private.acces",
    "private.acces_admin",
]


def test_aucune_table_de_donnees_n_est_detruite_au_recollage():
    """Un `drop table` de premier niveau s'exécute à chaque recollage."""
    detruites = set(re.findall(r"^drop table (?:if exists )?([\w.]+)", SCHEMA, re.I | re.M))
    fautives = sorted(detruites & set(SAISIE))
    assert fautives == [], "ces tables seraient vidées à chaque recollage du script"


def test_chaque_table_de_donnees_se_cree_sans_ecraser():
    """`create table` sans `if not exists` échoue sur une base déjà en
    place — et le script s'arrête là, à moitié posé."""
    manquantes = []
    for table in SAISIE:
        pose = re.search(r"^create table (if not exists )?" + re.escape(table) + r"\s*\(",
                         SCHEMA, re.I | re.M)
        if pose and not pose.group(1):
            manquantes.append(table)
    assert manquantes == [], "`create table` sans `if not exists`"

# --- Une variable ne doit pas porter le nom d'un alias -------------------

MOTS_SQL = {
    "select", "from", "where", "group", "order", "having", "limit", "offset",
    "union", "join", "left", "right", "inner", "outer", "full", "cross",
    "lateral", "natural", "on", "using", "as", "set", "values", "returning",
    "into", "loop", "and", "or", "not", "for", "when", "then", "else", "end",
    "case", "with", "exists", "distinct",
}

# `from jsonb_array_elements(x) as l`, `join private.logements g`, …
ALIAS = re.compile(r"\b(?:from|join)\s+[\w.]+(?:\s*\([^()]*\))?\s+(?:as\s+)?([a-z_]\w*)", re.I)


def variables_declarees(corps: str) -> set[str]:
    """Les noms déclarés entre `declare` et `begin`."""
    bloc = re.search(r"\bdeclare\b(.*?)\bbegin\b", corps, re.S | re.I)
    if not bloc:
        return set()
    noms = set()
    for ligne in bloc.group(1).splitlines():
        ligne = ligne.split("--")[0].strip()
        trouve = re.match(r"([a-z_]\w*)\s+\S", ligne, re.I)
        if trouve:
            noms.add(trouve.group(1).lower())
    return noms


def test_aucune_variable_ne_porte_le_nom_d_un_alias_de_table():
    """Une variable PL/pgSQL et un alias de table qui partagent un nom
    rendent toute référence ambiguë :

        column reference "l" is ambiguous
        It could refer to either a PL/pgSQL variable or a table column.

    La fonction se pose sans broncher — l'analyseur ne résout pas les
    noms — et n'échoue qu'au premier appel, chez l'organisateur, des
    semaines plus tard. C'est arrivé : `admin_tarifs_enregistrer`
    déclarait `l` pour ses boucles de contrôle et nommait `l` les tables
    dérivées de ses `insert`.

    Le remède tient en un mot : une variable s'appelle `ligne`, un alias
    s'appelle `l`.
    """
    fautives = []
    for fonction in CORPS.finditer(SCHEMA):
        nom, corps = fonction.group(1), fonction.group(2)
        alias = {a.lower() for a in ALIAS.findall(corps)} - MOTS_SQL
        partages = sorted(variables_declarees(corps) & alias)
        if partages:
            fautives.append(f"{nom} : {', '.join(partages)}")
    assert fautives == [], (
        "variable PL/pgSQL et alias de table de même nom — Postgres refusera "
        "l'appel : " + " | ".join(fautives)
    )

# --- Tout ce qui ecrit entre dans l'historique ---------------------------

# Les fonctions de l'historique lui-même : elles écrivent, et elles n'ont
# rien à y annoncer. `annuler_geste` est appelée par une fonction qui a
# déjà posé son étiquette ; la restauration d'un jalon coupe la trace
# exprès, le TRUNCATE qui la précède n'émettant aucun déclencheur.
SANS_GESTE = {
    "private.tracer",
    "private.geste_courant",
    "private.geste",
    "private.compacter",
    "private.compacter_si_du",
    "private.jalons_purger",
    "private.annuler_geste",
    "private.sauver_si_nouvelle_semaine",
    "public.admin_jalon_prendre",
    "public.admin_jalon_restaurer",
    "public.admin_compacter",
}

# Les tables dont une écriture doit se retrouver dans l'historique. La même
# liste que `private.tracees()`, côté SQL — et c'est le premier test qui
# vérifie qu'elles ne se séparent pas.
ECRITURE = re.compile(
    r"\b(?:insert\s+into|update|delete\s+from)\s+((?:private|public)\.\w+)", re.I
)


def test_la_liste_des_tables_tracees_ne_ment_pas():
    """`private.tracees()` pose les déclencheurs ET sert de garde-fou au SQL
    dynamique de l'annulation. Une table qui y figure sans exister ferait
    échouer le collage ; une qui existe sans y figurer serait invisible
    dans l'historique, en silence."""
    bloc = re.search(r"function private\.tracees\(\)(.*?)\$fn\$;", SCHEMA, re.S)
    assert bloc, "private.tracees() a disparu"
    tracees = set(re.findall(r"\('((?:private|public)\.\w+)'", bloc.group(1)))
    assert tracees, "aucune table tracée : le test ne sert à rien"

    posees = set(
        re.findall(r"^create table if not exists ((?:private|public)\.\w+)", SCHEMA, re.I | re.M)
    )
    manquantes = sorted(tracees - posees)
    assert manquantes == [], f"tracées mais jamais créées : {manquantes}"


def test_chaque_fonction_qui_ecrit_annonce_son_geste():
    """Le déclencheur sait QUELLES lignes ont bougé, jamais pourquoi.

    L'étiquette est la seule part qui ne s'automatise pas : sans elle,
    l'historique dit « présences : 12 lignes » là où il pourrait dire
    « Alice — Présences ». Une fonction d'écriture qui l'oublie ne casse
    rien et ne se voit pas — d'où ce test.
    """
    bloc = re.search(r"function private\.tracees\(\)(.*?)\$fn\$;", SCHEMA, re.S)
    tracees = set(re.findall(r"\('((?:private|public)\.\w+)'", bloc.group(1)))

    muettes = []
    for fonction in CORPS.finditer(SCHEMA):
        nom, corps = fonction.group(1), fonction.group(2)
        if nom in SANS_GESTE:
            continue
        # Les commentaires en parlent, et doivent pouvoir continuer.
        code = "\n".join(l for l in corps.splitlines() if not l.lstrip().startswith("--"))
        if not (set(ECRITURE.findall(code)) & tracees):
            continue
        if "private.geste(" not in code:
            muettes.append(nom)

    assert muettes == [], (
        "ces fonctions écrivent sans annoncer leur geste — l'historique les "
        "montrera sans savoir les nommer : " + ", ".join(sorted(muettes))
    )

def test_aucun_renommage_ne_vise_son_propre_nom():
    """`alter table private.jalons rename to jalons` : la table de départ
    n'existe plus sous ce nom, et le collage s'arrête là.

    C'est arrivé. Le renommage avait été écrit juste, puis un
    remplacement global `private.sauvegardes` → `private.jalons` l'a
    rattrapé au passage — y compris dans l'instruction dont le sens était
    précisément de nommer l'ANCIENNE table. Rien ne le signalait :
    `parse_sql` lit la phrase sans broncher, elle n'échoue qu'au collage,
    et seulement sur une base qui porte encore l'ancien nom.
    """
    fautifs = [
        f"{ancien} -> {neuf}"
        for ancien, neuf in re.findall(
            r"alter table ([\w.]+) rename to (\w+)", SCHEMA, re.I
        )
        if ancien.split(".")[-1] == neuf
    ]
    assert fautifs == [], (
        "ces renommages visent la table qu'ils prétendent créer — Postgres "
        "refusera au collage : " + ", ".join(fautifs)
    )


def test_une_migration_cherche_la_table_qu_elle_renomme():
    """Le garde et le geste doivent parler de la même table.

    Un bloc qui vérifie l'existence de `sauvegardes` puis renomme autre
    chose passe le garde et échoue sur l'instruction — exactement le cas
    du test précédent, vu de l'autre bout.
    """
    manquants = []
    for bloc in re.findall(r"do \$mig\$(.*?)\$mig\$;", SCHEMA, re.S):
        for ancien, _ in re.findall(
            r"alter table (?:\w+\.)?(\w+) rename to (\w+)", bloc, re.I
        ):
            if f"'{ancien}'" not in bloc:
                manquants.append(ancien)
    assert manquants == [], (
        "ces renommages portent sur une table que leur garde ne cherche "
        "pas : " + ", ".join(manquants)
    )

# --- Annuler ne doit rien detruire d'autre ------------------------------


def rangs_traces() -> dict:
    """Le rang de chaque table tracée, tel que `private.tracees()` le pose."""
    bloc = re.search(r"function private\.tracees\(\)(.*?)\$fn\$;", SCHEMA, re.S)
    assert bloc, "private.tracees() a disparu"
    rangs = {}
    for nom, rang in re.findall(
        r"\('((?:private|public)\.\w+)'(?:::text)?,[^)]*?(\d+)(?:::smallint)?\)",
        bloc.group(1),
    ):
        rangs[nom] = int(rang)
    return rangs


def test_les_parents_passent_avant_leurs_enfants():
    """L'annulation repose les lignes par rang croissant : une présence ne
    peut pas revenir avant la personne qu'elle désigne.

    Ce rang est écrit à la main dans `private.tracees()`. Les clés
    étrangères, elles, sont écrites dans les `create table`. Que les deux
    se contredisent ne se verrait qu'au moment d'annuler un geste qui a
    supprimé une personne — c'est-à-dire le jour où l'on en a le plus
    besoin.
    """
    rangs = rangs_traces()
    assert len(rangs) > 10, f"rangs mal relus : {rangs}"

    fautifs = []
    for table, corps in re.findall(
        r"create table if not exists ((?:private|public)\.\w+)\s*\((.*?)\n\);",
        SCHEMA, re.S,
    ):
        if table not in rangs:
            continue
        for parent in re.findall(r"references\s+((?:private|public)\.\w+)", corps):
            if parent == table or parent not in rangs:
                continue  # une table qui se désigne elle-même ne s'ordonne pas
            if rangs[parent] >= rangs[table]:
                fautifs.append(f"{table} ({rangs[table]}) désigne {parent} ({rangs[parent]})")

    assert fautifs == [], (
        "ces tables sont rangées avant ce dont elles dépendent — l'annulation "
        "reposera l'enfant avant le parent : " + " | ".join(fautifs)
    )


def test_une_ligne_modifiee_se_reprend_par_un_update():
    """Le défaut qui a coûté un séjour.

    Une ligne modifiée était remise en place par un `delete` suivi d'un
    `insert`. Sur `participants`, le `delete` emportait par CASCADE les
    présences, les couchages, les vœux et les refus de la personne — et
    l'`insert` reposait une personne nue. Annuler « végétarien : non →
    oui » effaçait tout ce que la personne avait déclaré.

    Le `delete` reste légitime pour une ligne que le geste a CRÉÉE : là,
    il n'y a rien à perdre. C'est sur la ligne modifiée qu'il ment.
    """
    corps = re.search(
        r"function private\.annuler_geste\(.*?\$fn\$(.*?)\$fn\$;", SCHEMA, re.S
    )
    assert corps, "private.annuler_geste a disparu"

    passe = re.search(
        r"gl\.avant is not null and gl\.apres is not null(.*?)end loop;",
        corps.group(1), re.S,
    )
    assert passe, "la passe des lignes modifiées a disparu"

    fait = passe.group(1)
    assert "'update" in fait, "une ligne modifiée doit se reprendre par un UPDATE"
    assert "'delete" not in fait, (
        "un DELETE sur une ligne modifiée emporte par cascade tout ce qui la "
        "désigne : c'est le défaut qui a effacé les présences d'une personne"
    )

def test_une_fonction_qui_rend_une_table_s_efface_avant_de_se_reposer():
    """`create or replace` refuse de changer le type de retour.

    Le type de retour d'une fonction `returns table (...)` comprend le
    **nom et le type de chaque colonne**. Lui en ajouter une — un rang, un
    libellé — fait échouer le collage :

        cannot change return type of existing function
        Row type defined by OUT parameters is different.

    Et seulement sur une base déjà en place : sur une base neuve, tout
    passe. C'est arrivé en ajoutant un rang à `private.tracees()`.

    Le remède tient en une ligne, posée une fois pour toutes devant chacune
    de ces fonctions : `drop function if exists`. Elles vivent dans
    `private`, donc sans `grant` à reposer, et aucune vue ne les désigne —
    un corps de fonction est du texte, pas une dépendance.
    """
    manquantes = []
    for trouve in re.finditer(
        r"create or replace function\s+([\w.]+)\(([^)]*)\)\s*\r?\n?returns table",
        SCHEMA, re.I,
    ):
        nom = trouve.group(1)
        avant = SCHEMA[: trouve.start()]
        if f"drop function if exists {nom}(" not in avant:
            manquantes.append(nom)

    assert manquantes == [], (
        "ces fonctions rendent une table sans s'effacer d'abord — ajouter une "
        "colonne arrêtera le collage : " + ", ".join(manquantes)
    )
