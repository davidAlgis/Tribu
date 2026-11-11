"""Le projet Supabase reste-t-il eveille ?

Un projet gratuit est mis en pause apres une semaine sans activite sur sa
base, et la famille ne s'en sert que par vagues. `public.ping()` ecrit une
ligne, le workflow `eveil.yml` l'appelle chaque jour. Les deux tiennent a des
chaines de caracteres : le nom de la fonction d'un cote, l'adresse de l'appel
de l'autre. Rien ne les rapproche avant la premiere pause.
"""

import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SCHEMA = (RACINE / "supabase" / "schema.sql").read_text(encoding="utf-8")
WORKFLOW = (RACINE / ".github" / "workflows" / "eveil.yml").read_text(encoding="utf-8")
CONFIG = (RACINE / "config.js").read_text(encoding="utf-8")


def corps_du_ping() -> str:
    trouve = re.search(r"create or replace function public\.ping\(\).*?\$fn\$(.*?)\$fn\$", SCHEMA, re.S)
    assert trouve, "public.ping() a disparu du schema"
    return trouve.group(1)


def test_le_ping_ecrit_une_ligne():
    """Ouvrir une connexion sans rien faire ne compte pas comme de
    l'activite : il faut une ECRITURE. Et une seule ligne, qui se remplace --
    un battement par jour ne doit pas faire grossir la base."""
    corps = corps_du_ping()
    assert "insert into private.sonde" in corps
    assert "on conflict (id) do update" in corps


def test_le_ping_est_ouvert_et_ne_sert_rien():
    """Appelable avec la cle publique, donc il ne doit rien reveler : il
    rend la date de son propre appel, et c'est tout."""
    assert re.search(r"grant execute on function public\.ping\(\)\s+to anon", SCHEMA)
    assert "returns timestamptz" in SCHEMA[SCHEMA.index("function public.ping()"):][:80]
    corps = corps_du_ping()
    for interdit in ("participants", "presences", "refus_lieu", "voeux", "acces"):
        assert interdit not in corps, f"le ping touche a {interdit}"


def test_le_ping_reste_hors_de_l_historique():
    """Un battement par jour n'est pas un geste : tracee, la table noierait
    l'historique de l'organisateur sous trente lignes par mois."""
    bloc = re.search(r"function private\.tracees\(\)(.*?)\$fn\$;", SCHEMA, re.S)
    assert bloc
    assert "private.sonde" not in bloc.group(1)


def test_le_workflow_appelle_la_fonction_qui_existe():
    assert "/rest/v1/rpc/ping" in WORKFLOW
    assert "cron:" in WORKFLOW, "plus aucune execution planifiee : la pause reviendrait"
    assert "workflow_dispatch" in WORKFLOW, "plus de lancement a la main pour l'essayer"


def test_le_workflow_ne_porte_aucune_cle():
    """L'adresse et la cle viennent de `config.js`, ou elles sont publiques
    par conception. Les recopier dans le workflow les ferait deriver quand on
    change de projet -- et une cle `secret` collee par erreur serait publique."""
    assert "config.js" in WORKFLOW
    assert not re.search(r"sb_(?:publishable|secret)_|eyJ[A-Za-z0-9_-]{10,}|https://\w+\.supabase\.co", WORKFLOW)


def test_les_extractions_du_workflow_trouvent_quelque_chose_dans_config_js():
    """Le workflow lit `config.js` avec deux expressions rationnelles. Si le
    fichier change de forme, elles ne trouvent plus rien et le ping part sur
    une adresse vide -- sans que rien ne le dise avant la pause."""
    assert re.search(r'SUPABASE_URL:\s*"[^"]+"', CONFIG)
    assert re.search(r'SUPABASE_ANON_KEY:\s*"[^"]+"', CONFIG)


# --- Le depot lui-meme reste actif ----------------------------------------
#
# GitHub desactive les workflows planifies d'un depot public sans activite
# sur main depuis 60 jours : `eveil.yml` s'arreterait, et le projet Supabase
# retomberait en pause. `activite.yml` pose un commit par mois.

ACTIVITE = (RACINE / ".github" / "workflows" / "activite.yml").read_text(encoding="utf-8")


def test_un_commit_automatique_part_chaque_mois():
    """Le delai de GitHub est de 60 jours : un lancement par mois en laisse
    passer un sans que rien ne se desactive. Au-dela -- tous les deux mois
    ou plus -- le moindre retard le depasserait."""
    cron = re.search(r'cron:\s*"([^"]+)"', ACTIVITE)
    assert cron, "plus d'execution planifiee"
    minute, heure, jour, mois, semaine = cron.group(1).split()
    assert jour.isdigit() and mois == "*" and semaine == "*", (
        "le commit n'est plus mensuel : " + cron.group(1)
    )


def test_le_commit_automatique_peut_ecrire_et_ne_touche_qu_a_son_fichier():
    """Sans `contents: write`, le jeton ne peut pas pousser. Et le commit ne
    doit toucher qu'au fichier prevu : ni le README, ni un fichier qu'on
    edite a la main -- un conflit se ferait sur le travail de quelqu'un."""
    assert re.search(r"contents:\s*write", ACTIVITE)
    assert "git push" in ACTIVITE
    ajoutes = re.findall(r"git add (\S+)", ACTIVITE)
    assert ajoutes == [".github/derniere-activite.txt"], ajoutes
    assert (RACINE / ajoutes[0]).exists(), "le fichier du battement n'existe pas"


def test_le_commit_automatique_ne_fait_pas_de_commit_vide():
    """Deux lancements le meme jour (le mensuel et un a la main) ecrivent le
    meme contenu : le second ne doit pas echouer sur « rien a commiter »."""
    assert "git diff --cached --quiet ||" in ACTIVITE
