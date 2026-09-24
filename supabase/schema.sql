-- ============================================================
--  Tribu - schema complet
--  A coller dans Supabase > SQL Editor > New query > Run
-- ============================================================
--
--  RE-EXECUTABLE. Ce qu'il fait a une base deja en place :
--
--    - les PRESENCES saisies sont effacees et la table recreee ;
--    - les PARTICIPANTS sont conserves : la base fait foi, ce serait
--      perdre la liste que de la reconstruire a chaque passage ;
--    - les colonnes apparues depuis la derniere execution sont ajoutees ;
--    - les codes d'acces sont conserves.
--
--  PRINCIPES
--
--  1. La base ne stocke que des FAITS SAISIS. Aucun regime, aucun
--     tarif, aucun total : tout est derive par le Python.
--
--  2. Aucune table n'est accessible directement depuis le navigateur.
--     Tout passe par des fonctions qui verifient le code d'acces et les
--     droits a chaque appel.
--
--  3. Absent est l'etat par defaut. Une personne qui n'a rien saisi
--     n'a aucune ligne. Saisir, c'est declarer une presence.
-- ============================================================

-- `public.personnes` est une table des premieres versions, remplacee par
-- `private.participants`. Elle ne porte plus rien : on la solde.
drop table if exists public.personnes cascade;

-- IL N'Y A PLUS DE `drop table public.presences`.
--
-- Il y en avait un, et il a coute une saisie entiere. Le script se recolle
-- a chaque changement -- c'est la seule facon de poser une fonction -- et
-- il emportait donc les presences a chaque fois. Tant que la table etait
-- vide, cela ne se voyait pas ; le jour ou soixante personnes y etaient,
-- tout le monde est redevenu absent d'un coup.
--
-- Les presences suivent desormais la regle du reste du fichier : la table
-- se cree si elle manque, et les colonnes venues apres coup s'ajoutent une
-- par une (section 4). Rien n'est jamais detruit par un recollage.

create schema if not exists private;
grant usage on schema private to anon;   -- juste de quoi appeler les fonctions

-- ============================================================
--  1. Reglages du sejour
-- ============================================================
create table if not exists private.reglages (
  id             boolean primary key default true check (id),  -- une seule ligne
  date_debut     date not null,
  date_fin       date not null,
  saisie_ouverte boolean not null default true
);

-- A partir de quel age on cesse d'etre un bebe, puis un enfant. Ce sont les
-- bornes de l'HOTEL, pas de la famille : chaque etablissement compte a sa
-- facon, et `config.toml` range ses tarifs sous ces trois mots. Elles
-- vivaient dans les options de `importer_ged.py`, donc nulle part une fois
-- l'amorcage passe.
alter table private.reglages
  add column if not exists age_bebe smallint not null default 3;
alter table private.reglages
  add column if not exists age_enfant smallint not null default 12;

-- ============================================================
--  2. Le code d'acces, partage par toute la famille
-- ============================================================
--
--  Ce code n'est ecrit NULLE PART dans le depot, qui est public.
--  Il se pose a la main (voir supabase/participants.exemple.sql).
--
--  Le code FAMILLE. Il circule dans toute la famille, se dicte au
--  telephone, et n'est donc pas un secret fort par nature : il est
--  stocke en clair, normalise. Ce qu'il protege, c'est l'acces a la
--  liste des prenoms et a la saisie -- pas l'administration.
--
create table if not exists private.acces (
  code_normalise text primary key,
  libelle        text,
  cree_le        timestamptz not null default now()
);

-- Une version anterieure logeait les deux codes ici, distingues par une
-- colonne `role`. Le code organisateur a depuis sa propre table, ou il
-- n'est plus stocke en clair. On retire la colonne -- mais on efface
-- d'abord les lignes 'admin' : sans le role, elles deviendraient des
-- codes famille valides, ce qui ouvrirait la saisie a un code cense
-- etre reserve.
do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'private' and table_name = 'acces' and column_name = 'role'
  ) then
    delete from private.acces where role = 'admin';
    alter table private.acces drop column role;
  end if;
end $mig$;

-- Le code doit pouvoir se dicter au telephone : casse, accents,
-- espaces et tirets sont ignores. "Les Abricots" = "lesabricots".
create or replace function private.normaliser_code(c text)
returns text language sql immutable as $fn$
  select regexp_replace(
           lower(translate(
             coalesce(c, ''),
             'àâäãéèêëíìîïóòôöõúùûüçñÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
             'aaaaeeeeiiiiooooouuuucnAAAAEEEEIIIIOOOOOUUUUCN'
           )),
           '[^a-z0-9]', '', 'g'
         )
$fn$;

-- Variante booleenne, pratique pour verifier un code a la main dans le
-- SQL Editor. Elle reste dans `private` : PostgREST ne l'expose donc pas,
-- et elle ne peut pas servir d'oracle de force brute depuis l'exterieur.
-- `create or replace function` ne remplace que la MEME signature : avec une
-- liste d'arguments differente, il ajoute une surcharge. Les deux versions
-- coexisteraient alors, et comme l'ancienne avait une valeur par defaut,
-- l'appel a un seul argument deviendrait ambigu -- « function name is not
-- unique ». On efface donc explicitement les signatures d'avant.
drop function if exists private.code_valide(text, text);
drop function if exists private.verifier_code(text);

create or replace function private.code_valide(c text)
returns boolean language sql stable
set search_path = private, pg_temp as $fn$
  select exists (
    select 1 from private.acces a
    where a.code_normalise = private.normaliser_code(c)
  )
$fn$;

-- ---------- Le code ORGANISATEUR ----------
--
--  Celui-la est d'une autre nature : un seul porteur, jamais dicte, et
--  c'est le seul secret qui protege la liste des participants. Il n'est
--  donc PAS stocke en clair.
--
--  On garde une empreinte SHA-256 et un sel tire au hasard. Le code lui
--  meme n'existe que dans le gestionnaire de mots de passe de
--  l'organisateur : il n'a jamais ete tape dans l'editeur SQL, qui en
--  conserverait l'historique, ni ecrit dans un fichier.
--
--  Il n'est pas normalise, contrairement au code famille : il se copie,
--  il ne se dicte pas. Cela evite aussi d'avoir a reproduire a
--  l'identique la normalisation cote Python, ou le moindre ecart
--  rendrait le code invalide.
--
create extension if not exists pgcrypto with schema extensions;

create table if not exists private.acces_admin (
  id        boolean primary key default true check (id),  -- une seule ligne
  sel       text not null,
  empreinte text not null,
  cree_le   timestamptz not null default now()
);

create or replace function private.code_admin_valide(c text)
returns boolean language sql stable
set search_path = private, extensions, public, pg_temp as $fn$
  select exists (
    select 1 from private.acces_admin a
    where a.empreinte = encode(digest(a.sel || coalesce(c, ''), 'sha256'), 'hex')
  )
$fn$;

create or replace function private.verifier_code(c text, r text default 'famille')
returns void language plpgsql stable
set search_path = private, pg_temp as $fn$
begin
  if not (case when r = 'admin'
               then private.code_admin_valide(c)
               else private.code_valide(c)
          end) then
    raise exception 'CODE_REFUSE' using errcode = 'P0001';
  end if;
end $fn$;

-- ============================================================
--  3. Les participants, definis a l'avance par l'organisateur
-- ============================================================
--
--  Aucune saisie libre de prenom : plus de doublons, plus de fautes
--  de frappe, des exports propres.
--
--  parent_id   : le parent dont la personne descend.
--  conjoint_id : le/la partenaire, renseigne des DEUX cotes.
--
--  Ces deux liens suffisent a reconstituer l'arbre.
--
create table if not exists private.participants (
  id            uuid primary key default gen_random_uuid(),
  prenom        text not null check (length(trim(prenom)) between 1 and 40),
  famille       text not null check (length(trim(famille)) between 1 and 60),
  categorie_age text not null check (categorie_age in ('adulte', 'enfant', 'bebe')),
  parent_id     uuid references private.participants(id) on delete set null,
  conjoint_id   uuid references private.participants(id) on delete set null,
  -- Un invite n'est pas de la famille. Rattache a son hote via parent_id,
  -- son hote peut donc gerer sa presence ; sans rattachement, il ne depend
  -- que de lui-meme.
  invite        boolean not null default false,
  cree_le       timestamptz not null default now()
);

-- `create table if not exists` ne modifie PAS une table deja presente : sur
-- une base creee par une version anterieure, la colonne ci-dessus n'aurait
-- jamais vu le jour, et la vue de la section 7 echouerait a la reclamer.
alter table private.participants
  add column if not exists invite boolean not null default false;

-- Jusqu'ici la portee de chacun se deduisait entierement de l'arbre. Elle
-- reste la regle par defaut, mais peut desormais etre restreinte personne
-- par personne, sans toucher aux liens de parente :
--
--   'descendance' : conjoint, descendants et leurs conjoints (le defaut)
--   'foyer'       : soi et son conjoint, rien de plus
--   'soi'         : soi seulement
--
-- Restreindre quelqu'un ne change rien aux droits des autres : une
-- grand-mere limitee a son foyer n'empeche pas ses enfants de gerer les
-- leurs.
alter table private.participants
  add column if not exists portee text not null default 'descendance';

-- La date de naissance. Nullable, et elle le restera : le GEDCOM ne la
-- donne pas pour tout le monde, et un invite n'y figure pas du tout.
--
-- POURQUOI LA GARDER, puisque `categorie_age` suffit a facturer ?
--
-- Parce que la categorie, elle, PERIME. Elle est calculee a la date du
-- sejour ; l'enfant qui a onze ans cette annee en aura douze la prochaine,
-- et rien dans la base ne le sait. Jusqu'ici il fallait relancer l'import
-- GEDCOM -- qui vide tout -- ou corriger a la main, personne par personne.
-- Avec la date, la categorie se recalcule (`admin_ages_recalculer`).
--
-- `categorie_age` reste ce qui FACTURE : c'est elle que lit la vue
-- d'export et le moteur de tarifs, et elle peut etre corrigee a la main
-- quand l'hotel compte autrement. La date propose, l'organisateur dispose.
alter table private.participants
  add column if not exists date_naissance date;

alter table private.participants drop constraint if exists participants_portee_valide;
alter table private.participants add constraint participants_portee_valide
  check (portee in ('descendance', 'foyer', 'soi'));

-- L'age accompli a une date. `age()` rend un intervalle ; l'annee qu'on en
-- extrait est le nombre d'anniversaires passes, ce qui est exactement ce
-- qu'on appelle un age.
create or replace function private.age_au(p_naissance date, p_jour date)
returns integer language sql immutable
set search_path = private, pg_temp as $fn$
  select case
           when p_naissance is null or p_jour is null then null
           else extract(year from age(p_jour, p_naissance))::integer
         end
$fn$;

-- La categorie qu'une date de naissance appelle. UNE SEULE DEFINITION,
-- lue par la liste des participants comme par le recalcul : deux formules
-- qui doivent s'accorder finissent toujours par diverger.
--
-- Sans date, `null` -- et non « adulte ». Ne pas savoir n'est pas la meme
-- chose que savoir que c'est un adulte, et la page doit pouvoir le dire.
create or replace function private.categorie_pour(
  p_naissance date, p_jour date, p_bebe integer, p_enfant integer
)
returns text language sql immutable
set search_path = private, pg_temp as $fn$
  select case
           when private.age_au(p_naissance, p_jour) is null then null
           when private.age_au(p_naissance, p_jour) < p_bebe then 'bebe'
           when private.age_au(p_naissance, p_jour) < p_enfant then 'enfant'
           else 'adulte'
         end
$fn$;

-- ============================================================
--  4. Les presences
-- ============================================================
--
--  Une ligne = une personne, un jour.
--
--  hebergement    : ou elle dort LA NUIT DU `jour` AU LENDEMAIN.
--                   'exterieur' = presente mais ne dort pas sur place.
--  petit_dejeuner : repas pris LE MATIN du `jour`.
--  dejeuner       : repas pris LE MIDI du `jour`.
--  diner          : repas pris LE SOIR du `jour`.
--
--  C'est ce decalage qui permet au Python de reconstituer les regimes :
--    diner[J] + nuit[J] + petit_dej[J+1] + dejeuner[J+1] = pension complete.
--
--  Pas de ligne = absent. C'est l'etat par defaut de tout le monde.
--
create table if not exists public.presences (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null references private.participants(id) on delete cascade,
  jour            date not null,
  hebergement     text not null check (hebergement in ('chambre', 'gite', 'exterieur')),
  petit_dejeuner  boolean not null default false,
  dejeuner        boolean not null default false,
  diner           boolean not null default false,
  vue_mer         boolean not null default false,
  maj_le          timestamptz not null default now(),
  unique (participant_id, jour)
);

-- `create table if not exists` ne MODIFIE pas une table deja presente : sur
-- une base creee par une version anterieure, ces colonnes n'auraient jamais
-- vu le jour. Meme precaution que pour `private.participants`.
alter table public.presences
  add column if not exists vue_mer boolean not null default false;
alter table public.presences
  add column if not exists maj_le timestamptz not null default now();

create index if not exists presences_jour_idx on public.presences (jour);

-- ============================================================
--  5. Qui a le droit de modifier qui
-- ============================================================
--
--  Regle : on peut modifier sa propre presence, celle de son conjoint,
--  celle de ses descendants, et celle de leurs conjoints.
--
--  Un grand-pere couvre donc sa femme, ses enfants, leurs compagnons,
--  et leurs enfants a leur tour. Un petit-fils ne remonte pas vers son
--  grand-pere, et personne ne peut modifier ses freres et soeurs ni sa
--  belle-famille.
--
--  `union` (et non `union all`) : indispensable, sinon deux conjoints
--  qui se pointent mutuellement feraient boucler la recursion.
--
create or replace function private.personnes_modifiables(p_acteur uuid)
returns table (id uuid)
language sql stable
set search_path = private, pg_temp as $fn$
  with recursive
  acteur as (
    select p.id, p.conjoint_id, p.portee
    from private.participants p
    where p.id = p_acteur
  ),
  descendance as (
    select p.id, p.conjoint_id
    from private.participants p
    where p.id = p_acteur

    union

    select p.id, p.conjoint_id
    from private.participants p
    join descendance f
      on p.parent_id = f.id           -- ses enfants
      or p.id = f.conjoint_id         -- son conjoint
      or p.conjoint_id = f.id         -- ...meme si le lien n'est pose que d'un cote
  )

  -- Portee complete : toute la descendance, soi-meme inclus.
  select d.id from descendance d
  where (select a.portee from acteur a) = 'descendance'

  union

  -- Portee restreinte : soi, toujours. Nul ne perd la main sur sa propre
  -- presence, sans quoi il ne pourrait plus rien declarer.
  select a.id from acteur a
  where a.portee in ('foyer', 'soi')

  union

  -- ...et son conjoint, pour la portee 'foyer'.
  select a.conjoint_id from acteur a
  where a.portee = 'foyer' and a.conjoint_id is not null
$fn$;

-- ============================================================
--  6. Les seules portes d'entree du navigateur
-- ============================================================

-- Personne ne touche aux tables directement.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon;

-- ---- 6a. La liste des prenoms, pour l'autocompletion ----
--
--  Les prenoms sont des donnees personnelles : le code est exige
--  avant de les servir.
--
create or replace function public.participants_lister(p_code text)
returns table (id uuid, prenom text, famille text)
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code);
  return query
    select p.id, p.prenom, p.famille
    from private.participants p
    order by p.prenom;
end $fn$;

-- ---- 6b. Charger son sejour et celui des siens ----
create or replace function public.sejour_charger(p_code text, p_acteur uuid)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
begin
  perform private.verifier_code(p_code);
  select * into r from private.reglages;

  return jsonb_build_object(
    'date_debut', r.date_debut,
    'date_fin', r.date_fin,
    'saisie_ouverte', r.saisie_ouverte,
    'modifiables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'prenom', p.prenom,
               'famille', p.famille,
               'categorie_age', p.categorie_age,
               'saisi', exists (select 1 from public.presences x where x.participant_id = p.id)
             ) order by (p.id <> p_acteur), p.prenom)
      from private.participants p
      where p.id in (select m.id from private.personnes_modifiables(p_acteur) m)
    ), '[]'::jsonb),
    'presences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', pr.participant_id,
               'jour', pr.jour,
               'hebergement', pr.hebergement,
               'petit_dejeuner', pr.petit_dejeuner,
               'dejeuner', pr.dejeuner,
               'diner', pr.diner,
               'vue_mer', pr.vue_mer
             ))
      from public.presences pr
      where pr.participant_id in (select m.id from private.personnes_modifiables(p_acteur) m)
    ), '[]'::jsonb)
  );
end $fn$;

-- ---- 6c. Enregistrer la saisie ----
--
--  Remplacement complet : ce que le formulaire envoie devient l'etat exact
--  de chaque personne visee. Decocher un jour le supprime, donc la rend
--  absente. C'est ce qui rend la modification possible a tout moment sans
--  jamais accumuler de doublons.
--
--  `p_cibles` est un TABLEAU, parce que la meme grille sert souvent a
--  plusieurs : une fratrie qui arrive et repart ensemble, des parents qui
--  prennent les memes repas. Une seule personne, c'est un tableau d'un
--  element -- le cas courant reste le plus simple a ecrire.
--
--  Tout se joue dans une seule transaction : soit toutes les personnes
--  sont enregistrees, soit aucune. Sans cela, un refus au milieu d'une
--  application groupee laisserait la famille a moitie saisie, sans moyen
--  de savoir ou la reprendre.
--
drop function if exists public.sejour_enregistrer(text, uuid, uuid, jsonb);

create or replace function public.sejour_enregistrer(
  p_code    text,
  p_acteur  uuid,
  p_cibles  uuid[],
  p_lignes  jsonb
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r      private.reglages;
  cibles uuid[];
  cible  uuid;
  nb     integer;
  total  integer := 0;
begin
  perform private.verifier_code(p_code);
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into r from private.reglages;
  if not r.saisie_ouverte then
    raise exception 'SAISIE_FERMEE' using errcode = 'P0001';
  end if;

  select array_agg(distinct c) into cibles from unnest(coalesce(p_cibles, '{}')) c;
  if cibles is null then
    raise exception 'AUCUNE_CIBLE' using errcode = 'P0001';
  end if;

  -- Les droits sont verifies sur TOUTES les cibles avant la premiere
  -- ecriture : refuser a mi-parcours reviendrait a n'en enregistrer qu'une
  -- partie.
  if exists (
    select 1 from unnest(cibles) c
    where c not in (select m.id from private.personnes_modifiables(p_acteur) m)
  ) then
    raise exception 'DROIT_REFUSE' using errcode = 'P0001';
  end if;

  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) > 400 then
    raise exception 'TROP_DE_LIGNES' using errcode = 'P0001';
  end if;

  foreach cible in array cibles loop
    delete from public.presences where participant_id = cible;

    insert into public.presences (
      participant_id, jour, hebergement, petit_dejeuner, dejeuner, diner, vue_mer
    )
    select
      cible,
      (l->>'jour')::date,
      l->>'hebergement',
      coalesce((l->>'petit_dejeuner')::boolean, false),
      coalesce((l->>'dejeuner')::boolean, false),
      coalesce((l->>'diner')::boolean, false),
      -- Le supplement vue mer n'existe que pour les chambres.
      coalesce((l->>'vue_mer')::boolean, false) and l->>'hebergement' = 'chambre'
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) as l
    where (l->>'jour')::date between r.date_debut and r.date_fin
      and l->>'hebergement' in ('chambre', 'gite', 'exterieur');

    get diagnostics nb = row_count;
    total := total + nb;
  end loop;

  return jsonb_build_object(
    'personnes', array_length(cibles, 1),
    'enregistrees', total
  );
end $fn$;

grant execute on function public.participants_lister(text)                   to anon;
grant execute on function public.sejour_charger(text, uuid)                  to anon;
grant execute on function public.sejour_enregistrer(text, uuid, uuid[], jsonb) to anon;

-- ============================================================
--  7. La porte de sortie : l'export Python
-- ============================================================
--
--  PostgREST n'expose que le schema `public`. Le script d'export a
--  donc besoin d'une vue pour atteindre les participants, qui vivent
--  dans `private`.
--
--  Cette vue n'est lisible que par `service_role`, c'est-a-dire par la
--  cle secrete, qui ne quitte jamais la machine de l'organisateur. Le
--  navigateur, lui, n'y a aucun acces.
--
create or replace view public.v_participants as
  select id, prenom, famille, categorie_age, invite
  from private.participants;

revoke all on public.v_participants from anon, authenticated;
grant select on public.v_participants to service_role;

revoke all on public.presences from anon, authenticated;
grant select on public.presences to service_role;

-- ============================================================
--  8. L'administration des participants
-- ============================================================
--
--  La base est la SOURCE DE VERITE. Le GEDCOM ne sert qu'a l'amorcage,
--  une seule fois ; ensuite, tout passe par ces fonctions, appelees
--  depuis admin.html.
--
--  Elles exigent le code ORGANISATEUR, distinct du code famille : qui
--  peut saisir ses vacances ne peut pas pour autant modifier la liste.
--

-- ---- 8a. Tout voir ----
create or replace function public.admin_lister(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Les ages se comptent A LA DATE DU SEJOUR, et non aujourd'hui : c'est
  -- celle-la que l'hotel facture. Un enfant qui a douze ans le mois d'apres
  -- reste un enfant pour ce sejour.
  select * into r from private.reglages;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'prenom', p.prenom,
             'famille', p.famille,
             'categorie_age', p.categorie_age,
             'date_naissance', p.date_naissance,
             'age', private.age_au(p.date_naissance, r.date_debut),
             -- Ce que la date appellerait. `null` quand on ne sait pas ; la
             -- page ne signale un ecart que lorsqu'elle sait.
             'categorie_attendue',
               private.categorie_pour(p.date_naissance, r.date_debut,
                                      r.age_bebe, r.age_enfant),
             'parent_id', p.parent_id,
             'conjoint_id', p.conjoint_id,
             'invite', p.invite,
             'portee', p.portee,
             -- Le nombre rend le reglage concret : passer de 16 a 2 se voit,
             -- la ou « portee : foyer » ne dit rien de ce qu'on a change.
             'nb_geres', (select count(*) from private.personnes_modifiables(p.id)),
             'a_saisi', exists (select 1 from public.presences x where x.participant_id = p.id)
           ) order by p.famille, p.prenom)
    from private.participants p
  ), '[]'::jsonb);
end $fn$;

-- ---- 8b. Ajouter quelqu'un ----
--
--  Trois facons de rattacher, et elles suffisent a tout :
--
--    p_conjoint_de : un nouveau conjoint. Il entre dans le foyer de son
--                    partenaire, et les memes personnes peuvent gerer sa
--                    presence.
--    p_enfant_de   : un nouveau bebe, ou un invite rattache a son hote.
--                    Son parent et les ascendants de son parent le gerent.
--    ni l'un ni l'autre : un invite independant. Lui seul se gere.
--
-- La signature a gagne `p_naissance` : `create or replace` ne remplace que
-- la fonction de MEME signature, l'ancienne survivrait a cote et PostgREST
-- ne saurait plus laquelle appeler.
drop function if exists public.admin_ajouter(text, text, text, uuid, uuid, boolean, text);

create or replace function public.admin_ajouter(
  p_code        text,
  p_prenom      text,
  p_age         text,
  p_conjoint_de uuid default null,
  p_enfant_de   uuid default null,
  p_invite      boolean default false,
  p_famille     text default null,
  p_naissance   date default null
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  nouveau  uuid := gen_random_uuid();
  rattache private.participants;
  famille  text;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if coalesce(trim(p_prenom), '') = '' then
    raise exception 'PRENOM_VIDE' using errcode = 'P0001';
  end if;
  if p_conjoint_de is not null and p_enfant_de is not null then
    raise exception 'DEUX_LIENS' using errcode = 'P0001';
  end if;

  select * into rattache from private.participants
   where id = coalesce(p_conjoint_de, p_enfant_de);

  if coalesce(p_conjoint_de, p_enfant_de) is not null and rattache.id is null then
    raise exception 'RATTACHEMENT_INCONNU' using errcode = 'P0001';
  end if;

  -- Un conjoint deja pris signale une erreur de saisie plutot qu'un foyer
  -- recompose : mieux vaut le dire que l'ecraser en silence.
  if p_conjoint_de is not null and rattache.conjoint_id is not null then
    raise exception 'CONJOINT_DEJA_PRIS' using errcode = 'P0001';
  end if;

  famille := coalesce(
    nullif(trim(coalesce(p_famille, '')), ''),
    rattache.famille,
    case when p_invite then 'Invites' else 'Sans famille' end
  );

  insert into private.participants
    (id, prenom, famille, categorie_age, parent_id, conjoint_id, invite, date_naissance)
  values (
    nouveau,
    trim(p_prenom),
    famille,
    p_age,
    case
      -- Un conjoint entre dans le meme foyer que son partenaire : il se
      -- rattache donc au meme parent, pas a son partenaire.
      when p_conjoint_de is not null then rattache.parent_id
      else p_enfant_de
    end,
    p_conjoint_de,
    p_invite,
    p_naissance
  );

  if p_conjoint_de is not null then
    update private.participants set conjoint_id = nouveau where id = p_conjoint_de;
  end if;

  return jsonb_build_object('id', nouveau, 'famille', famille);
end $fn$;

-- ---- 8c. Corriger une faute de frappe ou un age ----
create or replace function public.admin_modifier(
  p_code   text,
  p_id     uuid,
  p_prenom text,
  p_age    text
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  avant   private.participants;
  neuf    text;
  branche integer := 0;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into avant from private.participants where id = p_id;
  if avant.id is null then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  neuf := coalesce(nullif(trim(p_prenom), ''), avant.prenom);

  update private.participants
     set prenom = neuf,
         categorie_age = coalesce(p_age, categorie_age)
   where id = p_id;

  -- Un prenom ne vit qu'a UN endroit, et tout le reste designe la personne
  -- par son identifiant : les presences, les voeux, les refus de lieu, les
  -- liens de parente suivent d'eux-memes. Il y a une exception, et une
  -- seule : `famille` est une COPIE du prenom du chef de branche, posee au
  -- moment de l'amorcage.
  --
  -- Sans ce rattrapage, corriger « Marie-Odille » en « Marie-Odile »
  -- laisserait l'ancienne orthographe en tete de la liste et dans les
  -- totaux de l'export, pour toute sa descendance, indefiniment.
  --
  -- On ne recopie que si la personne renommee est bien celle qui donne son
  -- nom a la branche : son `famille` valait son propre prenom. Deux chefs
  -- de branche homonymes seraient renommes ensemble -- mais leurs totaux
  -- etaient deja confondus dans l'export, qui groupe sur ce meme libelle.
  if avant.famille = avant.prenom and neuf <> avant.prenom then
    update private.participants
       set famille = neuf
     where famille = avant.prenom;
    get diagnostics branche = row_count;
  end if;

  return jsonb_build_object('id', p_id, 'prenom', neuf, 'branche', branche);
end $fn$;

-- ---- 8c bis. Restreindre la portee de quelqu'un ----
--
--  Utile quand l'arbre dit plus que la realite : une grand-mere qui figure
--  au-dessus de toute sa descendance, mais qui ne s'occupe en pratique que
--  de son mari.
--
--  Restreindre une personne ne retire rien aux autres : ses enfants
--  gardent la main sur leurs propres foyers.
--
create or replace function public.admin_portee(p_code text, p_id uuid, p_portee text)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  nb integer;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if p_portee not in ('descendance', 'foyer', 'soi') then
    raise exception 'PORTEE_INCONNUE' using errcode = 'P0001';
  end if;

  update private.participants set portee = p_portee where id = p_id;
  if not found then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  select count(*) into nb from private.personnes_modifiables(p_id);
  return jsonb_build_object('portee', p_portee, 'nb_geres', nb);
end $fn$;

-- ---- 8d. Retirer quelqu'un ----
--
--  Retirer ne coupe jamais la branche : les enfants de la personne sont
--  d'abord repris par son conjoint s'il reste, sinon par son propre
--  parent. Sans cela, une generation entiere se retrouverait orpheline et
--  plus personne ne pourrait gerer sa presence.
--
create or replace function public.admin_retirer(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  partant   private.participants;
  repreneur uuid;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into partant from private.participants where id = p_id;
  if partant.id is null then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  repreneur := coalesce(partant.conjoint_id, partant.parent_id);

  update private.participants set parent_id = repreneur where parent_id = p_id;
  update private.participants set conjoint_id = null     where conjoint_id = p_id;

  -- Les presences deja saisies partent avec la personne (on delete cascade).
  delete from private.participants where id = p_id;

  return jsonb_build_object('retire', partant.prenom, 'repris_par', repreneur);
end $fn$;

-- ---- 8e. L'amorcage depuis le GEDCOM ----
--
--  Appelee UNE SEULE FOIS par importer_ged.py. Elle remplace toute la
--  liste : c'est un amorcage, pas une mise a jour. Passe cette etape, la
--  base fait foi et le GEDCOM n'est plus consulte.
--
create or replace function public.admin_importer(p_code text, p_participants jsonb)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  nb integer;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if jsonb_array_length(coalesce(p_participants, '[]'::jsonb)) = 0 then
    raise exception 'LISTE_VIDE' using errcode = 'P0001';
  end if;

  -- TRUNCATE et non DELETE : Supabase charge l'extension `safeupdate` pour
  -- le role qui sert l'API, laquelle refuse tout DELETE sans clause WHERE
  -- (erreur 21000). Un `where true` n'y changerait rien, le planificateur
  -- l'eliminerait. TRUNCATE n'est pas un DELETE et passe donc outre.
  --
  -- TOUTES les tables qui referencent les participants sont citees
  -- ensemble : Postgres refuse de vider seule une table referencee, meme
  -- quand la referencante n'a aucune ligne. La liste s'est allongee avec le
  -- projet -- voeux, refus de lieu, plan de couchage -- et l'oublier
  -- faisait echouer l'amorcage entier.
  --
  -- De toute facon, reamorcer la liste donne de nouveaux identifiants :
  -- tout ce qui designait les anciens ne veut plus rien dire.
  truncate table public.presences, public.voeux, public.refus_lieu,
                 private.couchages, private.participants;

  -- Les identifiants viennent du script : cela permet de poser parents et
  -- conjoints dans le meme insert. Les contraintes de cle etrangere n'etant
  -- verifiees qu'en fin d'instruction, les references croisees passent.
  insert into private.participants
    (id, prenom, famille, categorie_age, parent_id, conjoint_id, invite, date_naissance)
  select
    (l->>'id')::uuid,
    l->>'prenom',
    l->>'famille',
    l->>'categorie_age',
    nullif(l->>'parent_id', '')::uuid,
    nullif(l->>'conjoint_id', '')::uuid,
    coalesce((l->>'invite')::boolean, false),
    nullif(l->>'date_naissance', '')::date
  from jsonb_array_elements(p_participants) as l;

  get diagnostics nb = row_count;
  return jsonb_build_object('importes', nb);
end $fn$;

-- ---- 8f. L'import des presences deja connues ----
--
--  Le sejour a d'abord ete tenu dans un tableur, et il s'y trouve deja
--  soixante lignes de presences. Les ressaisir a la main sur index.html
--  serait long et fautif.
--
--  Cette fonction fait pour les presences ce que `admin_importer` fait
--  pour la liste : elle remplace, pour les SEULES personnes citees, ce
--  qu'elles avaient declare. Celles qui ne sont pas dans l'envoi ne sont
--  pas touchees -- reimporter une branche corrigee ne doit pas effacer le
--  reste.
--
--  Elle renvoie `recues` ET `ecrites`. Les dates hors sejour arretent
--  desormais tout avant la moindre ecriture ; le couple reste affiche parce
--  qu'un hebergement inconnu ferait encore tomber une ligne en silence.
--
create or replace function public.admin_presences_importer(p_code text, p_lignes jsonb)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r      private.reglages;
  cibles uuid[];
  nb     integer;
begin
  perform private.verifier_code(p_code, 'admin');

  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into r from private.reglages;

  select array_agg(distinct (l->>'participant_id')::uuid)
    into cibles
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) as l;

  if cibles is null then
    raise exception 'AUCUNE_CIBLE' using errcode = 'P0001';
  end if;

  -- On le dit tout de suite et clairement. Sans ce controle, un
  -- identifiant errone remonterait sous forme de violation de cle
  -- etrangere, message que personne ne rattache a « le rapprochement des
  -- prenoms s'est trompe ».
  if exists (
    select 1 from unnest(cibles) c
     where not exists (select 1 from private.participants p where p.id = c)
  ) then
    raise exception 'PARTICIPANT_INCONNU' using errcode = 'P0001';
  end if;

  -- AVANT d'effacer quoi que ce soit.
  --
  -- L'insert plus bas filtre sur les dates du sejour. Le delete, lui, ne
  -- filtre rien : un fichier cale sur d'autres dates effacait la saisie des
  -- personnes citees puis n'ecrivait aucune ligne -- et la transaction
  -- reussissait, donc rien ne l'annulait. On leve ici, pendant que la
  -- transaction peut encore tout rendre.
  if exists (
    select 1 from jsonb_array_elements(p_lignes) as l
     where (l->>'jour')::date not between r.date_debut and r.date_fin
  ) then
    raise exception
      'HORS_SEJOUR : le sejour est regle du % au %, le fichier est ailleurs',
      r.date_debut, r.date_fin
      using errcode = 'P0001';
  end if;

  delete from public.presences where participant_id = any(cibles);

  insert into public.presences
    (participant_id, jour, hebergement, petit_dejeuner, dejeuner, diner, vue_mer)
  select (l->>'participant_id')::uuid,
         (l->>'jour')::date,
         l->>'hebergement',
         coalesce((l->>'petit_dejeuner')::boolean, false),
         coalesce((l->>'dejeuner')::boolean, false),
         coalesce((l->>'diner')::boolean, false),
         -- Le supplement vue mer n'existe que pour les chambres.
         coalesce((l->>'vue_mer')::boolean, false) and l->>'hebergement' = 'chambre'
    from jsonb_array_elements(p_lignes) as l
   where (l->>'jour')::date between r.date_debut and r.date_fin
     and l->>'hebergement' in ('chambre', 'gite', 'exterieur');

  get diagnostics nb = row_count;

  return jsonb_build_object(
    'personnes', array_length(cibles, 1),
    'recues', jsonb_array_length(p_lignes),
    'ecrites', nb,
    'date_debut', r.date_debut,
    'date_fin', r.date_fin
  );
end $fn$;

grant execute on function public.admin_presences_importer(text, jsonb) to anon;

-- ---- 8g. Les dates du sejour ----
--
--  Elles vivaient dans `private.reglages` et ne se changeaient que par
--  l'editeur SQL. C'est peu, et c'est mal place : ce sont elles qui
--  bornent la grille de saisie et qui filtrent tout ce qui s'ecrit dans
--  `presences`. Les laisser sur les dates d'exemple fait echouer un import
--  entier sans qu'on comprenne pourquoi.
--
--  `saisie_ouverte` les accompagne. La colonne existait depuis le debut,
--  `sejour_enregistrer` la respecte -- mais aucune fonction ne permettait
--  de la basculer. Le sondage des dates et la carte avaient leur
--  interrupteur ; le formulaire des presences, non.
--
create or replace function public.admin_sejour(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
begin
  perform private.verifier_code(p_code, 'admin');
  select * into r from private.reglages;
  if r.id is null then
    raise exception 'REGLAGES_ABSENTS' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'date_debut', r.date_debut,
    'date_fin', r.date_fin,
    'jours', (r.date_fin - r.date_debut) + 1,
    'saisie_ouverte', r.saisie_ouverte,
    'age_bebe', r.age_bebe,
    'age_enfant', r.age_enfant,
    -- Combien de personnes n'ont pas de date : le panneau le dit, sinon
    -- « recalculer » paraitrait ne rien faire pour la moitie du monde.
    'sans_naissance', (select count(*) from private.participants
                        where date_naissance is null),
    'presences', (select count(*) from public.presences),
    -- Ce qui a ete saisi hors des bornes actuelles. Zero en temps normal ;
    -- non nul apres un deplacement des dates, et il faut le dire.
    'presences_hors', (
      select count(*) from public.presences p
       where p.jour not between r.date_debut and r.date_fin
    )
  );
end $fn$;

create or replace function public.admin_sejour_dates(p_code text, p_debut date, p_fin date)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  hors integer;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if p_debut is null or p_fin is null then
    raise exception 'DATES_MANQUANTES' using errcode = 'P0001';
  end if;
  if p_fin < p_debut then
    raise exception 'DATES_INVERSEES' using errcode = 'P0001';
  end if;

  -- `where id` sur une table qui n'a qu'une ligne : ce n'est pas une
  -- precaution, c'est une obligation. Supabase charge `safeupdate` pour le
  -- role qui sert l'API, et elle refuse tout UPDATE sans clause WHERE --
  -- « UPDATE requires a WHERE clause ». Le commentaire de `admin_importer`
  -- ne parlait que des DELETE ; l'extension arrete les deux.
  -- `id` vaut toujours `true` (cf. section 1), la clause designe donc la
  -- ligne unique sans rien exclure.
  update private.reglages set date_debut = p_debut, date_fin = p_fin
   where id;
  if not found then
    raise exception 'REGLAGES_ABSENTS' using errcode = 'P0001';
  end if;

  -- Deplacer les dates ne deplace pas ce qui a ete saisi. Les journees
  -- tombees hors des nouvelles bornes restent en base, invisibles du
  -- formulaire et ignorees du prochain import : on ne les efface pas -- ce
  -- serait decider a la place de l'organisateur -- mais on les compte, et
  -- l'interface le dit.
  select count(*) into hors
    from public.presences p
   where p.jour not between p_debut and p_fin;

  return jsonb_build_object(
    'date_debut', p_debut,
    'date_fin', p_fin,
    'jours', (p_fin - p_debut) + 1,
    'presences_hors', hors
  );
end $fn$;

create or replace function public.admin_saisie_ouvrir(p_code text, p_ouvert boolean)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  -- `where id` : safeupdate refuse un UPDATE sans clause WHERE.
  update private.reglages set saisie_ouverte = p_ouvert where id;
  return jsonb_build_object('saisie_ouverte', p_ouvert);
end $fn$;

-- ---- 8h. Les dates de naissance ----
--
--  Le GEDCOM les porte toutes, et `importer_ged.py` les lisait deja -- pour
--  en tirer une categorie d'age, puis les jeter. Les garder demandait
--  jusqu'ici de relancer l'amorcage, qui VIDE la liste et tout ce qui s'y
--  rattache. Hors de question une fois le sejour commence.
--
--  Cette fonction ne detruit rien : elle pose une date sur des personnes
--  qui existent deja, une par une, par leur identifiant. Le script se
--  charge de dire QUI est qui -- c'est lui qui a l'arbre sous les yeux --
--  et l'organisateur voit l'appariement avant qu'il parte.
--
create or replace function public.admin_naissances_poser(p_code text, p_dates jsonb)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  ecrites   integer;
  inconnues integer;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if jsonb_array_length(coalesce(p_dates, '[]'::jsonb)) = 0 then
    raise exception 'LISTE_VIDE' using errcode = 'P0001';
  end if;

  -- Ce qui ne designe personne est COMPTE, pas ignore en silence : un
  -- appariement qui rate a moitie doit se voir.
  select count(*) into inconnues
    from jsonb_array_elements(p_dates) as l
   where not exists (
     select 1 from private.participants p where p.id = (l->>'id')::uuid
   );

  update private.participants p
     set date_naissance = nullif(d.date_naissance, '')::date
    from (
      select l->>'id' as id, l->>'date_naissance' as date_naissance
        from jsonb_array_elements(p_dates) as l
    ) d
   where p.id = d.id::uuid;
  get diagnostics ecrites = row_count;

  return jsonb_build_object('ecrites', ecrites, 'inconnues', inconnues);
end $fn$;

-- ---- 8i. Recalculer les categories d'age ----
--
--  La categorie perime : elle vaut a la date du sejour, et le sejour
--  bouge. Ce bouton la refait depuis les dates de naissance.
--
--  Il RAPPORTE ce qu'il change, personne par personne, plutot que de le
--  faire en silence. Une categorie posee a la main -- parce que l'hotel
--  compte autrement pour quelqu'un -- serait sinon effacee sans un mot.
--
--  Ceux dont on ignore la date ne bougent pas : ne pas savoir n'est pas
--  une raison de decider.
--
create or replace function public.admin_ages_recalculer(p_code text)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r        private.reglages;
  changes  jsonb;
begin
  perform private.verifier_code(p_code, 'admin');
  perform private.sauver_si_nouvelle_semaine();

  select * into r from private.reglages;
  if r.id is null then
    raise exception 'REGLAGES_ABSENTS' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'prenom', t.prenom,
           'avant', t.categorie_age,
           'apres', t.attendue,
           'age', private.age_au(t.date_naissance, r.date_debut)
         ) order by t.famille, t.prenom), '[]'::jsonb)
    into changes
    from (
      select p.*, private.categorie_pour(p.date_naissance, r.date_debut,
                                         r.age_bebe, r.age_enfant) as attendue
        from private.participants p
    ) t
   where t.attendue is not null and t.attendue <> t.categorie_age;

  update private.participants p
     set categorie_age = private.categorie_pour(p.date_naissance, r.date_debut,
                                                r.age_bebe, r.age_enfant)
   where p.date_naissance is not null
     and private.categorie_pour(p.date_naissance, r.date_debut,
                                r.age_bebe, r.age_enfant) <> p.categorie_age;

  return jsonb_build_object(
    'jour', r.date_debut,
    'changes', changes,
    'sans_date', (select count(*) from private.participants where date_naissance is null)
  );
end $fn$;

-- ---- 8j. Les bornes d'age ----
--
--  Elles viennent de l'hotel, pas de la famille : chaque etablissement
--  compte a sa facon. Elles vivaient dans les options de `importer_ged.py`,
--  donc nulle part une fois l'amorcage passe.
--
create or replace function public.admin_sejour_ages(p_code text, p_bebe integer, p_enfant integer)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  perform private.sauver_si_nouvelle_semaine();

  if p_bebe is null or p_enfant is null or p_bebe < 0 or p_enfant < 0 then
    raise exception 'AGE_INVALIDE' using errcode = 'P0001';
  end if;
  if p_bebe >= p_enfant then
    raise exception 'AGES_INVERSES' using errcode = 'P0001';
  end if;

  -- `where id` : safeupdate refuse un UPDATE sans clause WHERE.
  update private.reglages set age_bebe = p_bebe, age_enfant = p_enfant where id;
  return jsonb_build_object('age_bebe', p_bebe, 'age_enfant', p_enfant);
end $fn$;

grant execute on function public.admin_naissances_poser(text, jsonb)     to anon;
grant execute on function public.admin_ages_recalculer(text)             to anon;
grant execute on function public.admin_sejour_ages(text, integer, integer) to anon;

grant execute on function public.admin_sejour(text)                    to anon;
grant execute on function public.admin_sejour_dates(text, date, date)  to anon;
grant execute on function public.admin_saisie_ouvrir(text, boolean)    to anon;

grant execute on function public.admin_lister(text)                                         to anon;
grant execute on function public.admin_ajouter(text, text, text, uuid, uuid, boolean, text, date) to anon;
grant execute on function public.admin_modifier(text, uuid, text, text)                     to anon;
grant execute on function public.admin_portee(text, uuid, text)                             to anon;
grant execute on function public.admin_retirer(text, uuid)                                  to anon;
grant execute on function public.admin_importer(text, jsonb)                                to anon;


-- ============================================================
--  9. Le choix de la date
-- ============================================================
--
--  Un sondage, en amont du reste : on choisit d'abord le week-end, on
--  remplit les presences ensuite.
--
--  Meme modele d'identite et de droits que le formulaire de presences :
--  code famille, prenom, et l'on repond pour les personnes qu'on gere.
--  Rien de nouveau a expliquer a la famille.
--
--  Les options sont posees par l'organisateur : personne d'autre ne
--  propose de date, sans quoi le sondage se diluerait.
--

alter table private.reglages
  add column if not exists voeux_ouverts boolean not null default true;

create table if not exists private.options_date (
  id         uuid primary key default gen_random_uuid(),
  libelle    text not null check (length(trim(libelle)) between 1 and 80),
  date_debut date,
  date_fin   date,
  cree_le    timestamptz not null default now()
);

--  Pas de reponse = aucune ligne, comme l'absence pour les presences.
--  C'est le meme principe : la base ne stocke que ce qui a ete declare.
create table if not exists public.voeux (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participants(id) on delete cascade,
  option_id      uuid not null references private.options_date(id) on delete cascade,
  choix          text not null check (choix in ('oui', 'non')),
  maj_le         timestamptz not null default now(),
  unique (participant_id, option_id)
);

-- « Si besoin » a existe, et n'existe plus : la reponse est binaire.
--
--  Une reponse « si besoin » deja donnee n'est ni un oui ni un non. La
--  convertir lui ferait dire ce qu'elle n'a pas dit -- « oui » gonflerait
--  le resultat, « non » le plomberait. On l'efface : la personne repasse
--  en « pas repondu », sa pastille reprend son point, et on lui redemande.
delete from public.voeux where choix = 'peut_etre';

--  `create table if not exists` ne touche pas a une table deja en place :
--  son CHECK garderait les trois valeurs, et la premiere reponse binaire
--  passerait sans que rien n'empeche une troisieme de revenir par une
--  autre porte.
alter table public.voeux drop constraint if exists voeux_choix_check;
alter table public.voeux add constraint voeux_choix_check
  check (choix in ('oui', 'non'));

revoke all on public.voeux from anon, authenticated;
grant select on public.voeux to service_role;

-- ---- 9a. Charger le sondage ----
create or replace function public.dates_charger(p_code text, p_acteur uuid)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
begin
  perform private.verifier_code(p_code);
  select * into r from private.reglages;

  return jsonb_build_object(
    'voeux_ouverts', r.voeux_ouverts,

    -- Combien de monde en tout, et combien se sont prononces. Sans ces deux
    -- nombres, « 2 oui » se lit pareil dans une famille de quatre et dans
    -- une famille de vingt, et un classement fonde sur trois reponses
    -- passerait pour un resultat. Ce sont des comptes, jamais des noms --
    -- les memes que sert deja `lieux_charger`.
    'participants', (select count(*) from private.participants),
    'repondants', (select count(distinct participant_id) from public.voeux),

    -- Les totaux sont renvoyes a tout le monde, mais jamais les noms : voir
    -- que le premier week-end tient la corde aide a se decider, savoir qui
    -- a dit non ne regarde personne.
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'libelle', o.libelle,
               'date_debut', o.date_debut,
               'date_fin', o.date_fin,
               'oui', (select count(*) from public.voeux v
                        where v.option_id = o.id and v.choix = 'oui'),
               'non', (select count(*) from public.voeux v
                        where v.option_id = o.id and v.choix = 'non')
             ) order by o.date_debut nulls last, o.libelle)
      from private.options_date o
    ), '[]'::jsonb),

    'modifiables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'prenom', p.prenom,
               'famille', p.famille,
               'repondu', exists (select 1 from public.voeux v where v.participant_id = p.id)
             ) order by (p.id <> p_acteur), p.prenom)
      from private.participants p
      where p.id in (select m.id from private.personnes_modifiables(p_acteur) m)
    ), '[]'::jsonb),

    'voeux', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', v.participant_id,
               'option_id', v.option_id,
               'choix', v.choix
             ))
      from public.voeux v
      where v.participant_id in (select m.id from private.personnes_modifiables(p_acteur) m)
    ), '[]'::jsonb)
  );
end $fn$;

-- ---- 9b. Enregistrer les voeux ----
--
--  Remplacement complet, comme pour les presences : ce qui est envoye
--  devient l'etat exact de chaque personne visee. Une option laissee sans
--  reponse redevient sans reponse.
--
create or replace function public.dates_enregistrer(
  p_code   text,
  p_acteur uuid,
  p_cibles uuid[],
  p_choix  jsonb
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r      private.reglages;
  cibles uuid[];
  cible  uuid;
  total  integer := 0;
  nb     integer;
begin
  perform private.verifier_code(p_code);
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into r from private.reglages;
  if not r.voeux_ouverts then
    raise exception 'VOEUX_FERMES' using errcode = 'P0001';
  end if;

  select array_agg(distinct c) into cibles from unnest(coalesce(p_cibles, '{}')) c;
  if cibles is null then
    raise exception 'AUCUNE_CIBLE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from unnest(cibles) c
    where c not in (select m.id from private.personnes_modifiables(p_acteur) m)
  ) then
    raise exception 'DROIT_REFUSE' using errcode = 'P0001';
  end if;

  foreach cible in array cibles loop
    delete from public.voeux where participant_id = cible;

    insert into public.voeux (participant_id, option_id, choix)
    select cible, (l->>'option_id')::uuid, l->>'choix'
    from jsonb_array_elements(coalesce(p_choix, '[]'::jsonb)) as l
    where l->>'choix' in ('oui', 'non')
      -- Une option supprimee entre-temps est ignoree plutot que de faire
      -- echouer toute la saisie.
      and exists (select 1 from private.options_date o where o.id = (l->>'option_id')::uuid);

    get diagnostics nb = row_count;
    total := total + nb;
  end loop;

  return jsonb_build_object('personnes', array_length(cibles, 1), 'enregistres', total);
end $fn$;

grant execute on function public.dates_charger(text, uuid)                  to anon;
grant execute on function public.dates_enregistrer(text, uuid, uuid[], jsonb) to anon;

-- ---- 9c. Cote organisateur : poser et retirer les options ----

create or replace function public.admin_dates_lister(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  return jsonb_build_object(
    'voeux_ouverts', (select voeux_ouverts from private.reglages),
    'participants', (select count(*) from private.participants),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'libelle', o.libelle,
               'date_debut', o.date_debut,
               'date_fin', o.date_fin,
               'oui', (select count(*) from public.voeux v
                        where v.option_id = o.id and v.choix = 'oui'),
               'non', (select count(*) from public.voeux v
                        where v.option_id = o.id and v.choix = 'non')
             ) order by o.date_debut nulls last, o.libelle)
      from private.options_date o
    ), '[]'::jsonb)
  );
end $fn$;

create or replace function public.admin_date_ajouter(
  p_code    text,
  p_libelle text,
  p_debut   date default null,
  p_fin     date default null
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  nouveau uuid := gen_random_uuid();
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if coalesce(trim(p_libelle), '') = '' then
    raise exception 'LIBELLE_VIDE' using errcode = 'P0001';
  end if;
  if p_debut is not null and p_fin is not null and p_fin < p_debut then
    raise exception 'DATES_INVERSEES' using errcode = 'P0001';
  end if;

  insert into private.options_date (id, libelle, date_debut, date_fin)
  values (nouveau, trim(p_libelle), p_debut, p_fin);

  return jsonb_build_object('id', nouveau);
end $fn$;

create or replace function public.admin_date_retirer(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  partant private.options_date;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into partant from private.options_date where id = p_id;
  if partant.id is null then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  -- Les voeux deja exprimes sur cette option partent avec elle
  -- (on delete cascade).
  delete from private.options_date where id = p_id;
  return jsonb_build_object('retire', partant.libelle);
end $fn$;

create or replace function public.admin_voeux_ouvrir(p_code text, p_ouvert boolean)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  -- `where id` : safeupdate refuse un UPDATE sans clause WHERE.
  update private.reglages set voeux_ouverts = p_ouvert where id;
  return jsonb_build_object('voeux_ouverts', p_ouvert);
end $fn$;

grant execute on function public.admin_dates_lister(text)                      to anon;
grant execute on function public.admin_date_ajouter(text, text, date, date)    to anon;
grant execute on function public.admin_date_retirer(text, uuid)                to anon;
grant execute on function public.admin_voeux_ouvrir(text, boolean)             to anon;


-- ============================================================
--  10. Le choix du lieu
-- ============================================================
--
--  Chacun peint en rouge les departements ou il ne veut pas aller. Le
--  croisement designe ceux que personne ne refuse.
--
--  Un refus, c'est une ligne. Pas de ligne = pas d'objection, comme
--  l'absence pour les presences : la base ne stocke que ce qui a ete
--  declare.
--
--  On stocke le CODE du departement et rien d'autre. Les contours vivent
--  dans carte.js, cote navigateur : la base n'a aucune geometrie a
--  manipuler, et changer le fond de carte ne la touche pas.
--

alter table private.reglages
  add column if not exists lieux_ouverts boolean not null default true;

create table if not exists public.refus_lieu (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participants(id) on delete cascade,
  departement    text not null check (departement ~ '^(0[1-9]|[1-8][0-9]|9[0-5]|2[AB])$'),
  maj_le         timestamptz not null default now(),
  unique (participant_id, departement)
);

create index if not exists refus_lieu_dep_idx on public.refus_lieu (departement);

revoke all on public.refus_lieu from anon, authenticated;
grant select on public.refus_lieu to service_role;

-- ---- 10a. Charger la carte ----
create or replace function public.lieux_charger(p_code text, p_acteur uuid)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
begin
  perform private.verifier_code(p_code);
  select * into r from private.reglages;

  return jsonb_build_object(
    'lieux_ouverts', r.lieux_ouverts,
    'participants', (select count(*) from private.participants),

    -- Combien de refus par departement, pour toute la famille. Des nombres,
    -- jamais des noms : savoir qu'un departement recueille trois refus aide
    -- a chercher ailleurs, savoir lesquels ne regarde personne.
    'totaux', coalesce((
      select jsonb_object_agg(x.departement, x.n)
      from (
        select departement, count(*) as n
        from public.refus_lieu group by departement
      ) x
    ), '{}'::jsonb),

    -- Combien de personnes se sont prononcees : sans cela, « 0 refus »
    -- pourrait aussi bien vouloir dire « personne n'a encore repondu ».
    'repondants', (select count(distinct participant_id) from public.refus_lieu),

    'modifiables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'prenom', p.prenom,
               'famille', p.famille,
               'repondu', exists (select 1 from public.refus_lieu x
                                   where x.participant_id = p.id)
             ) order by (p.id <> p_acteur), p.prenom)
      from private.participants p
      where p.id in (select m.id from private.personnes_modifiables(p_acteur) m)
    ), '[]'::jsonb),

    'refus', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', x.participant_id,
               'departement', x.departement
             ))
      from public.refus_lieu x
      where x.participant_id in (select m.id from private.personnes_modifiables(p_acteur) m)
    ), '[]'::jsonb)
  );
end $fn$;

-- ---- 10b. Enregistrer les refus ----
--
--  Remplacement complet, comme partout ailleurs : ce qui arrive devient
--  l'etat exact de chaque personne visee. Effacer un departement de sa
--  carte le rend a nouveau acceptable.
--
create or replace function public.lieux_enregistrer(
  p_code         text,
  p_acteur       uuid,
  p_cibles       uuid[],
  p_departements text[]
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r      private.reglages;
  cibles uuid[];
  cible  uuid;
  total  integer := 0;
  nb     integer;
begin
  perform private.verifier_code(p_code);
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into r from private.reglages;
  if not r.lieux_ouverts then
    raise exception 'LIEUX_FERMES' using errcode = 'P0001';
  end if;

  select array_agg(distinct c) into cibles from unnest(coalesce(p_cibles, '{}')) c;
  if cibles is null then
    raise exception 'AUCUNE_CIBLE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from unnest(cibles) c
    where c not in (select m.id from private.personnes_modifiables(p_acteur) m)
  ) then
    raise exception 'DROIT_REFUSE' using errcode = 'P0001';
  end if;

  -- Refuser toute la France n'est pas une reponse, c'est une erreur de
  -- manipulation : mieux vaut la signaler que l'enregistrer.
  if array_length(coalesce(p_departements, '{}'), 1) > 90 then
    raise exception 'TOUT_REFUSE' using errcode = 'P0001';
  end if;

  foreach cible in array cibles loop
    delete from public.refus_lieu where participant_id = cible;

    insert into public.refus_lieu (participant_id, departement)
    select distinct cible, d
    from unnest(coalesce(p_departements, '{}')) d
    where d ~ '^(0[1-9]|[1-8][0-9]|9[0-5]|2[AB])$';

    get diagnostics nb = row_count;
    total := total + nb;
  end loop;

  return jsonb_build_object('personnes', array_length(cibles, 1), 'refus', total);
end $fn$;

grant execute on function public.lieux_charger(text, uuid)                     to anon;
grant execute on function public.lieux_enregistrer(text, uuid, uuid[], text[]) to anon;

-- ---- 10c. Cote organisateur ----

create or replace function public.admin_lieux(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  return jsonb_build_object(
    'lieux_ouverts', (select lieux_ouverts from private.reglages),
    'participants', (select count(*) from private.participants),
    'repondants', (select count(distinct participant_id) from public.refus_lieu),
    'totaux', coalesce((
      select jsonb_object_agg(x.departement, x.n)
      from (
        select departement, count(*) as n
        from public.refus_lieu group by departement
      ) x
    ), '{}'::jsonb)
  );
end $fn$;

create or replace function public.admin_lieux_ouvrir(p_code text, p_ouvert boolean)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  -- `where id` : safeupdate refuse un UPDATE sans clause WHERE.
  update private.reglages set lieux_ouverts = p_ouvert where id;
  return jsonb_build_object('lieux_ouverts', p_ouvert);
end $fn$;

grant execute on function public.admin_lieux(text)                 to anon;
grant execute on function public.admin_lieux_ouvrir(text, boolean) to anon;

-- ============================================================
--  11. Les logements
-- ============================================================
--
--  Un inventaire, et rien de plus : combien de chambres de deux, combien
--  de gites de six. Pas de plan de couchage, pas de nom sur une porte --
--  « qui dort avec qui » est une autre question, et la melanger a
--  celle-ci ferait de la saisie d'un nombre une reunion de famille.
--
--  UNE LIGNE = UN TYPE DE COUCHAGE, PAS UNE UNITE
--
--  « 4 chambres de 2 personnes » tient sur une ligne qu'on corrige, et
--  non sur quatre lignes qu'on additionne. La cle est donc naturelle --
--  (categorie, capacite, vue mer) -- et unique : reposer le meme type met
--  son nombre a jour au lieu d'empiler un doublon. Deux saisies distraites
--  ne peuvent pas produire un total que personne n'a voulu.
--
--  POURQUOI UNE TABLE, ET NON DES COLONNES DANS `reglages`
--
--  Parce que le nombre de types change d'une annee a l'autre : un hotel
--  a deux sortes de chambres, un village de vacances en a six. Une
--  colonne par type obligerait a modifier le schema a chaque sejour ;
--  une table ne demande que de retaper l'inventaire. C'est le meme
--  raisonnement que pour les dates du sejour, sorties de l'editeur SQL
--  pour la meme raison.
--
--  CE QUE CELA NE FAIT PAS ENCORE
--
--  Rien ne contraint la saisie des familles : quelqu'un peut declarer une
--  nuit en chambre alors qu'il n'en reste plus. Le panneau le DIT -- il
--  confronte l'inventaire aux nuits deja declarees, jour par jour -- mais
--  il ne l'interdit pas. Poser la contrainte avant d'avoir l'inventaire
--  bloquerait toute la famille sur une table vide.
--

create table if not exists private.logements (
  id        uuid primary key default gen_random_uuid(),
  categorie text     not null,
  capacite  smallint not null,
  nombre    smallint not null,
  vue_mer   boolean  not null default false,
  cree_le   timestamptz not null default now()
);

-- `drop ... if exists` avant chaque `add` : le script se recolle en entier
-- a chaque changement, et `add constraint` seul casserait au second passage.
alter table private.logements drop constraint if exists logements_categorie_valide;
alter table private.logements add constraint logements_categorie_valide
  check (categorie in ('chambre', 'gite'));

-- Des bornes de formulaire, pas des bornes de verite : elles existent pour
-- qu'un doigt qui glisse sur le pave numerique ne pose pas trois mille
-- couchages sans que rien ne bronche.
alter table private.logements drop constraint if exists logements_capacite_valide;
alter table private.logements add constraint logements_capacite_valide
  check (capacite between 1 and 30);

alter table private.logements drop constraint if exists logements_nombre_valide;
alter table private.logements add constraint logements_nombre_valide
  check (nombre between 1 and 200);

-- La vue mer est un supplement d'hotel : `presences` ne l'accepte qu'avec
-- une nuit en chambre, et l'inventaire doit dire la meme chose. Deux
-- endroits valent mieux qu'un pour une regle qui vient du tarif.
alter table private.logements drop constraint if exists logements_vue_mer_en_chambre;
alter table private.logements add constraint logements_vue_mer_en_chambre
  check (not vue_mer or categorie = 'chambre');

-- C'est cet index qui porte la regle « une ligne par type », et c'est lui
-- que vise le `on conflict` de `admin_logement_poser`.
create unique index if not exists logements_type_idx
  on private.logements (categorie, capacite, vue_mer);

-- Comme `sauvegardes` : la table nait APRES le `revoke all` de la section 6,
-- qui ne la couvre donc pas. Seules les fonctions ci-dessous y touchent, et
-- elles exigent le code organisateur.
revoke all on private.logements from anon, authenticated;

-- ---- 11a. L'offre et la demande, cote a cote ----
--
--  L'inventaire seul ne dit rien. Ce qui interesse l'organisateur, c'est
--  l'ecart : combien de places en chambre, combien de personnes en ont
--  demande une, et quelle nuit. Les deux partent donc ensemble, et c'est
--  admin.js qui les confronte -- la base sert des faits, les derivees se
--  calculent la ou elles se testent.
--
create or replace function public.admin_logements(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
begin
  perform private.verifier_code(p_code, 'admin');
  select * into r from private.reglages;
  if r.id is null then
    raise exception 'REGLAGES_ABSENTS' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'logements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'categorie', l.categorie,
               'capacite', l.capacite,
               'nombre', l.nombre,
               'vue_mer', l.vue_mer,
               'places', l.capacite * l.nombre
             ) order by l.categorie, l.vue_mer, l.capacite)
      from private.logements l
    ), '[]'::jsonb),

    -- Les nuits deja declarees, dans les bornes du sejour. `hebergement`
    -- porte la nuit QUI SUIT le jour (cf. section 4), donc une ligne par
    -- nuit et non par journee. « exterieur » ne dort pas sur place : il ne
    -- prend aucun couchage et ne compte pas ici.
    'nuits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'jour', t.jour,
               'chambre', t.chambre,
               'chambre_vue_mer', t.vue,
               'gite', t.gite
             ) order by t.jour)
      from (
        select p.jour,
               count(*) filter (where p.hebergement = 'chambre' and not p.vue_mer) as chambre,
               count(*) filter (where p.hebergement = 'chambre' and p.vue_mer)     as vue,
               count(*) filter (where p.hebergement = 'gite')                      as gite
          from public.presences p
         where p.jour between r.date_debut and r.date_fin
           and p.hebergement <> 'exterieur'
         group by p.jour
      ) t
    ), '[]'::jsonb)
  );
end $fn$;

-- ---- 11b. Poser un type, le corriger, le retirer ----
--
--  Trois fonctions et trois verbes. `poser` cree, et se contente de
--  corriger le nombre si le type existe deja -- c'est ce qui evite les
--  doublons au formulaire d'ajout. `modifier` reprend une ligne connue,
--  jusqu'a sa capacite. `retirer` la fait disparaitre.
--

create or replace function public.admin_logement_poser(
  p_code      text,
  p_categorie text,
  p_capacite  integer,
  p_nombre    integer,
  p_vue_mer   boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  pose private.logements;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if p_categorie is null or p_categorie not in ('chambre', 'gite') then
    raise exception 'CATEGORIE_INCONNUE' using errcode = 'P0001';
  end if;
  if p_capacite is null or p_capacite not between 1 and 30 then
    raise exception 'CAPACITE_INVALIDE' using errcode = 'P0001';
  end if;
  if p_nombre is null or p_nombre not between 1 and 200 then
    raise exception 'NOMBRE_INVALIDE' using errcode = 'P0001';
  end if;
  if coalesce(p_vue_mer, false) and p_categorie <> 'chambre' then
    raise exception 'VUE_MER_HORS_CHAMBRE' using errcode = 'P0001';
  end if;

  -- Reposer un type deja connu le CORRIGE, il ne s'ajoute pas. C'est ce qui
  -- permet au formulaire de n'avoir qu'un bouton, et a la liste de n'avoir
  -- jamais deux lignes a dire la meme chose.
  insert into private.logements (categorie, capacite, nombre, vue_mer)
  values (p_categorie, p_capacite, p_nombre, coalesce(p_vue_mer, false))
  on conflict (categorie, capacite, vue_mer) do update set nombre = excluded.nombre
  returning * into pose;

  return jsonb_build_object('id', pose.id, 'places', pose.capacite * pose.nombre);
end $fn$;

-- Un type pose se CORRIGE. Il fallait sinon le retirer et le reposer pour
-- une unite de plus, ou pour une capacite mal tapee -- trois gestes la ou
-- il en faut un.
--
-- Une seule fonction sert les deux usages : le pas a pas de la liste (un de
-- plus, un de moins) et la reprise complete de la ligne. Un pas est une
-- modification comme une autre, et deux chemins d'ecriture pour le meme
-- champ finiraient par diverger.
--
-- Elle travaille sur l'`id`, jamais sur la cle naturelle : changer la
-- capacite d'une ligne reviendrait sinon a en creer une seconde en laissant
-- la premiere derriere.
create or replace function public.admin_logement_modifier(
  p_code      text,
  p_id        uuid,
  p_categorie text,
  p_capacite  integer,
  p_nombre    integer,
  p_vue_mer   boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  avant private.logements;
  vue   boolean := coalesce(p_vue_mer, false);
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into avant from private.logements where id = p_id;
  if avant.id is null then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  if p_categorie is null or p_categorie not in ('chambre', 'gite') then
    raise exception 'CATEGORIE_INCONNUE' using errcode = 'P0001';
  end if;
  if p_capacite is null or p_capacite not between 1 and 30 then
    raise exception 'CAPACITE_INVALIDE' using errcode = 'P0001';
  end if;
  if p_nombre is null or p_nombre not between 1 and 200 then
    raise exception 'NOMBRE_INVALIDE' using errcode = 'P0001';
  end if;
  if vue and p_categorie <> 'chambre' then
    raise exception 'VUE_MER_HORS_CHAMBRE' using errcode = 'P0001';
  end if;

  -- Deplacer une ligne sur un type deja present ferait deux lignes pour la
  -- meme chose -- ce que l'index unique refuse de toute facon. On le dit
  -- avec un mot plutot qu'en laissant remonter une violation de contrainte :
  -- l'organisateur doit apprendre que l'autre ligne existe, pas lire un
  -- message de Postgres.
  if exists (
    select 1 from private.logements l
     where l.id <> p_id
       and l.categorie = p_categorie
       and l.capacite = p_capacite
       and l.vue_mer = vue
  ) then
    raise exception 'LOGEMENT_EXISTANT' using errcode = 'P0001';
  end if;

  update private.logements
     set categorie = p_categorie,
         capacite  = p_capacite,
         nombre    = p_nombre,
         vue_mer   = vue
   where id = p_id;

  return jsonb_build_object('id', p_id, 'places', p_capacite * p_nombre);
end $fn$;

create or replace function public.admin_logement_retirer(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  partant private.logements;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  select * into partant from private.logements where id = p_id;
  if partant.id is null then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  -- Rien ne pointe vers un logement : les presences disent une CATEGORIE,
  -- pas une unite. Retirer un type ne casse donc aucune saisie -- il change
  -- seulement ce que la page compte comme places disponibles.
  delete from private.logements where id = p_id;
  return jsonb_build_object('retire', partant.capacite * partant.nombre);
end $fn$;

grant execute on function public.admin_logements(text)                                  to anon;
grant execute on function public.admin_logement_poser(text, text, integer, integer, boolean) to anon;
grant execute on function public.admin_logement_modifier(text, uuid, text, integer, integer, boolean) to anon;
grant execute on function public.admin_logement_retirer(text, uuid)                     to anon;


-- ---- 11c. Le plan de couchage ----
--
--  L'inventaire dit COMBIEN de couchages. Ceci dit QUI est dans lequel.
--
--  UNE LIGNE PAR PERSONNE ET PAR NUIT
--
--  C'est la souplesse demandee : on dort avec sa soeur le premier soir et
--  avec trois cousins le lendemain. Une affectation valable pour tout le
--  sejour ne saurait pas le dire, et obligerait a tout reprendre des qu'un
--  seul soir differe.
--
--  Le report d'une nuit sur les suivantes rend le cas courant -- « la meme
--  chose toute la semaine » -- aussi court qu'une affectation unique. La
--  souplesse ne coute donc rien a celui qui n'en veut pas.
--
--  UNE UNITE N'EST PAS UNE LIGNE DE `logements`
--
--  « 4 chambres de 2 » est UNE ligne d'inventaire et QUATRE couchages. Une
--  unite se designe donc par un couple : la ligne, et le rang de
--  l'exemplaire parmi les siens. C'est ce qui evite de poser quatre lignes
--  jumelles dans l'inventaire pour le seul besoin de les nommer.
--
--  Baisser le nombre d'un type laisse des affectations au-dela du rang.
--  Elles sont ECARTEES A LA LECTURE -- les personnes reapparaissent a
--  placer -- mais pas effacees : remonter le nombre les retrouve. Retirer
--  le type, lui, les emporte pour de bon (`on delete cascade`).
--
--  LA CAPACITE NE BLOQUE PAS
--
--  Comme le panneau de tension : un depassement se voit, il ne se refuse
--  pas. Sept personnes dans un gite de six est arrive pour de vrai, et la
--  base n'a pas a trancher ce que l'organisateur assume.
--

create table if not exists private.couchages (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participants(id) on delete cascade,
  jour           date not null,
  logement_id    uuid not null references private.logements(id) on delete cascade,
  numero         smallint not null check (numero between 1 and 200),
  maj_le         timestamptz not null default now(),
  -- Un seul lit par personne et par nuit. C'est aussi ce qui permet a
  -- « placer » d'etre un upsert : deplacer quelqu'un est la meme operation
  -- que le poser.
  unique (participant_id, jour)
);

create index if not exists couchages_jour_idx on private.couchages (jour);

-- La table nait apres le `revoke all` de la section 6 : il ne la couvre pas.
revoke all on private.couchages from anon, authenticated;

-- Le plan d'une nuit : les unites, les dormeurs, et ou chacun se trouve.
--
-- Les trois partent ensemble parce qu'ils ne se lisent qu'ensemble : une
-- unite sans ses occupants ne dit rien, et un dormeur sans les unites n'a
-- nulle part ou aller. `nuits` accompagne le tout pour que la page puisse
-- proposer les autres soirs sans un second appel.
create or replace function public.admin_couchages(p_code text, p_jour date default null)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  r private.reglages;
  j date;
begin
  perform private.verifier_code(p_code, 'admin');
  select * into r from private.reglages;
  if r.id is null then
    raise exception 'REGLAGES_ABSENTS' using errcode = 'P0001';
  end if;

  -- Sans jour demande, la premiere nuit ou quelqu'un dort sur place -- et
  -- a defaut le premier jour du sejour, pour que la page ait toujours une
  -- date a afficher.
  j := coalesce(
    p_jour,
    (select min(pr.jour) from public.presences pr
      where pr.jour between r.date_debut and r.date_fin
        and pr.hebergement <> 'exterieur'),
    r.date_debut
  );

  return jsonb_build_object(
    'jour', j,

    -- Toutes les nuits du sejour, avec leur nombre de dormeurs : c'est le
    -- selecteur de la page, et il doit montrer les soirs vides aussi.
    'nuits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'jour', d.jour,
               'dormeurs', (select count(*) from public.presences pr
                             where pr.jour = d.jour and pr.hebergement <> 'exterieur')
             ) order by d.jour)
      from (select (r.date_debut + i) as jour
              from generate_series(0, r.date_fin - r.date_debut) as i) d
    ), '[]'::jsonb),

    -- « 4 chambres de 2 » se deplie ici en quatre unites. Le rang vient de
    -- `generate_series` : il n'est pas stocke dans l'inventaire, il se
    -- recalcule, et il ne veut rien dire de plus que « la deuxieme ».
    'unites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'logement_id', u.id,
               'numero', u.n,
               'categorie', u.categorie,
               'capacite', u.capacite,
               'vue_mer', u.vue_mer
             ) order by u.categorie, u.vue_mer, u.capacite, u.n)
      from (select l.*, n from private.logements l, generate_series(1, l.nombre) as n) u
    ), '[]'::jsonb),

    -- Qui a besoin d'un lit cette nuit-la, et ou il est pose. « exterieur »
    -- ne dort pas sur place : il n'a rien a faire dans le plan.
    'dormeurs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'prenom', p.prenom,
               'famille', p.famille,
               'categorie_age', p.categorie_age,
               'hebergement', pr.hebergement,
               'vue_mer', pr.vue_mer,
               'logement_id', c.logement_id,
               'numero', c.numero
             ) order by p.famille, p.prenom)
      from public.presences pr
      join private.participants p on p.id = pr.participant_id
      -- La jointure ecarte les affectations tombees au-dela du rang apres
      -- une baisse du nombre : la personne revient simplement a placer.
      left join private.couchages c
        on c.participant_id = p.id
       and c.jour = pr.jour
       and c.numero <= (select l.nombre from private.logements l where l.id = c.logement_id)
      where pr.jour = j and pr.hebergement <> 'exterieur'
    ), '[]'::jsonb)
  );
end $fn$;

-- Poser quelqu'un, le deplacer, ou le sortir : un seul verbe. Deplacer
-- n'est qu'un poser ailleurs, et `p_logement` nul est le retour au tas.
create or replace function public.admin_couchage_placer(
  p_code        text,
  p_participant uuid,
  p_jour        date,
  p_logement    uuid default null,
  p_numero      integer default null
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  gite private.logements;
begin
  perform private.verifier_code(p_code, 'admin');
  -- Le premier changement de la semaine emporte une copie de l'avant.
  perform private.sauver_si_nouvelle_semaine();

  if not exists (select 1 from private.participants where id = p_participant) then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;

  if p_logement is null then
    delete from private.couchages
     where participant_id = p_participant and jour = p_jour;
    return jsonb_build_object('place', false);
  end if;

  select * into gite from private.logements where id = p_logement;
  if gite.id is null then
    raise exception 'INCONNU' using errcode = 'P0001';
  end if;
  if p_numero is null or p_numero < 1 or p_numero > gite.nombre then
    raise exception 'UNITE_INCONNUE' using errcode = 'P0001';
  end if;

  -- Placer quelqu'un qui n'a pas declare dormir sur place ecrirait une
  -- ligne que la lecture n'affiche jamais : un fantome dans la base, et un
  -- lit compte pour rien.
  if not exists (
    select 1 from public.presences pr
     where pr.participant_id = p_participant
       and pr.jour = p_jour
       and pr.hebergement <> 'exterieur'
  ) then
    raise exception 'PAS_SUR_PLACE' using errcode = 'P0001';
  end if;

  -- Aucune verification de capacite : un depassement se voit sur la page,
  -- il ne se refuse pas ici (cf. l'en-tete de cette sous-partie).
  insert into private.couchages (participant_id, jour, logement_id, numero)
  values (p_participant, p_jour, p_logement, p_numero)
  on conflict (participant_id, jour) do update set logement_id = excluded.logement_id, numero = excluded.numero, maj_le = now();

  return jsonb_build_object('place', true);
end $fn$;

-- « La meme chose les soirs suivants ». Sans ce bouton, la souplesse d'une
-- ligne par nuit se paierait huit fois pour le cas le plus courant.
--
-- Ne suit que les personnes qui dorment AUSSI ces nuits-la : reporter ne
-- doit pas donner un lit a quelqu'un qui repart le lendemain.
create or replace function public.admin_couchages_reporter(p_code text, p_jour date)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r      private.reglages;
  ecrits integer;
  nuits  integer;
begin
  perform private.verifier_code(p_code, 'admin');
  perform private.sauver_si_nouvelle_semaine();

  select * into r from private.reglages;
  if r.id is null then
    raise exception 'REGLAGES_ABSENTS' using errcode = 'P0001';
  end if;

  select count(*) into nuits
    from generate_series(0, r.date_fin - r.date_debut) as i
   where (r.date_debut + i) > p_jour;

  insert into private.couchages (participant_id, jour, logement_id, numero)
  select c.participant_id, d.jour, c.logement_id, c.numero
    from private.couchages c
    cross join (select (r.date_debut + i) as jour
                  from generate_series(0, r.date_fin - r.date_debut) as i) d
   where c.jour = p_jour
     and d.jour > p_jour
     and exists (
       select 1 from public.presences pr
        where pr.participant_id = c.participant_id
          and pr.jour = d.jour
          and pr.hebergement <> 'exterieur'
     )
  on conflict (participant_id, jour) do update set logement_id = excluded.logement_id, numero = excluded.numero, maj_le = now();
  get diagnostics ecrits = row_count;

  return jsonb_build_object('nuits', nuits, 'ecrits', ecrits);
end $fn$;

grant execute on function public.admin_couchages(text, date)                            to anon;
grant execute on function public.admin_couchage_placer(text, uuid, date, uuid, integer) to anon;
grant execute on function public.admin_couchages_reporter(text, date)                   to anon;


-- ============================================================
--  12. Revenir en arriere
-- ============================================================
--
--  Trois gestes effacent beaucoup d'un coup, et aucun n'est reversible :
--  « Appliquer a tous » sur les trois pages familiales, le retrait d'un
--  participant qui emporte ses saisies, et le reamorcage GEDCOM qui vide
--  la liste. La base ne garde que l'etat courant : ce qui est remplace
--  n'existe plus nulle part.
--
--  D'ou un instantane par semaine.
--
--  QUAND IL EST PRIS
--
--  Pas par un planificateur. pg_cron demanderait une extension a activer
--  a la main, hors du « coller schema.sql et c'est pret », et prendrait
--  des copies identiques les semaines sans activite.
--
--  Il est pris A LA PREMIERE ECRITURE de chaque semaine, juste avant
--  qu'elle ait lieu. L'instantane porte donc l'etat tel qu'il etait avant
--  le premier changement de la semaine : exactement le point de retour
--  qu'on cherche. Une semaine sans aucune modification n'en produit
--  aucun, puisqu'il n'y aurait rien a y sauver.
--
--  CE QU'IL CONTIENT
--
--  Les sept tables qui portent de la donnee saisie, dans un seul jsonb.
--  Ce n'est pas la forme la plus compacte ; c'est la plus simple a relire
--  dans cinq semaines, et vingt personnes tiennent en quelques dizaines
--  de kilo-octets.
--
--  La COMPARAISON n'est pas ici : `admin_etat` sert l'etat courant sous
--  la meme forme, et admin.js compare les deux. Meme principe que le
--  reste du projet -- la base sert des faits, les derivees se calculent
--  ailleurs, la ou elles se testent.
--

create table if not exists private.sauvegardes (
  id       uuid primary key default gen_random_uuid(),
  semaine  date not null,             -- le lundi de la semaine couverte
  prise_le timestamptz not null default now(),
  motif    text not null check (motif in ('hebdomadaire', 'manuelle', 'avant_restauration')),
  contenu  jsonb not null
);

-- Une seule copie hebdomadaire par semaine ; les manuelles et les
-- « avant_restauration » peuvent se repeter.
create unique index if not exists sauvegardes_semaine_idx
  on private.sauvegardes (semaine) where motif = 'hebdomadaire';

create index if not exists sauvegardes_prise_le_idx
  on private.sauvegardes (prise_le desc);

-- La table nait APRES le `revoke all` de la section 6 : il ne la couvre
-- pas. Elle porte une copie complete de tout ce que la base contient de
-- personnel, donc on la ferme explicitement, comme `voeux` et `refus_lieu`.
-- Seules les fonctions de cette section y touchent, et elles exigent le
-- code organisateur.
revoke all on private.sauvegardes from anon, authenticated;

-- Combien de copies on garde, par motif. Douze semaines couvrent large
-- pour un sejour qui se prepare sur un trimestre.
create or replace function private.sauvegardes_purger()
returns void language sql
set search_path = private, pg_temp as $fn$
  delete from private.sauvegardes s
   where s.id in (
     select id from (
       select id, row_number() over (partition by motif order by prise_le desc) as rang
         from private.sauvegardes
     ) t
      where t.rang > 12
   )
$fn$;

-- L'etat courant, sous la forme exacte qu'aura l'instantane. Une seule
-- definition pour les deux : c'est ce qui garantit que comparer une copie
-- et le present compare bien la meme chose.
create or replace function private.etat_courant()
returns jsonb language sql stable
set search_path = private, pg_temp as $fn$
  select jsonb_build_object(
    'participants', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.id) from private.participants p), '[]'::jsonb),
    'options_date', coalesce(
      (select jsonb_agg(to_jsonb(o) order by o.id) from private.options_date o), '[]'::jsonb),
    'presences', coalesce(
      (select jsonb_agg(to_jsonb(x) order by x.participant_id, x.jour) from public.presences x), '[]'::jsonb),
    'voeux', coalesce(
      (select jsonb_agg(to_jsonb(v) order by v.participant_id, v.option_id) from public.voeux v), '[]'::jsonb),
    'refus_lieu', coalesce(
      (select jsonb_agg(to_jsonb(r) order by r.participant_id, r.departement) from public.refus_lieu r), '[]'::jsonb),
    'logements', coalesce(
      (select jsonb_agg(to_jsonb(l) order by l.id) from private.logements l), '[]'::jsonb),
    'couchages', coalesce(
      (select jsonb_agg(to_jsonb(c) order by c.participant_id, c.jour) from private.couchages c), '[]'::jsonb)
  )
$fn$;

-- Appelee au debut de CHAQUE fonction qui ecrit, apres la verification du
-- code et avant la moindre modification. Ne fait rien si la semaine est
-- deja couverte : le cout normal est un index scan.
create or replace function private.sauver_si_nouvelle_semaine()
returns void language plpgsql
set search_path = private, pg_temp as $fn$
declare
  lundi date := date_trunc('week', now() at time zone 'Europe/Paris')::date;
begin
  if exists (
    select 1 from private.sauvegardes
     where motif = 'hebdomadaire' and semaine = lundi
  ) then
    return;
  end if;

  -- `on conflict` et non un simple insert : deux personnes qui enregistrent
  -- a la meme seconde le lundi matin passeraient toutes les deux le test
  -- ci-dessus, et la seconde casserait sur l'index unique -- donc sur son
  -- enregistrement, qui n'y est pour rien.
  --
  -- Sans cible : la forme precise serait `on conflict (semaine) where motif
  -- = 'hebdomadaire'`, qui demande a Postgres d'inferer l'index partiel. Si
  -- l'inference echouait, elle echouerait a la PREMIERE ECRITURE d'une
  -- semaine, des mois apres l'installation, sur le dos de quelqu'un qui
  -- remplit ses vacances. La forme nue ne peut pas echouer, et il n'y a de
  -- toute facon qu'une seule contrainte a heurter : la cle primaire tire un
  -- uuid au hasard.
  insert into private.sauvegardes (semaine, motif, contenu)
  values (lundi, 'hebdomadaire', private.etat_courant())
  on conflict do nothing;

  perform private.sauvegardes_purger();
end $fn$;

-- ---- 12a. Ce qu'on a sous la main ----
--
--  Les compteurs, jamais le contenu : douze copies completes feraient
--  plusieurs mega-octets pour une page qui ne veut afficher qu'une liste.
--
create or replace function public.admin_sauvegardes_lister(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id,
             'semaine', s.semaine,
             'prise_le', s.prise_le,
             'motif', s.motif,
             'compteurs', jsonb_build_object(
               'participants', jsonb_array_length(coalesce(s.contenu->'participants', '[]'::jsonb)),
               'presences',    jsonb_array_length(coalesce(s.contenu->'presences', '[]'::jsonb)),
               'voeux',        jsonb_array_length(coalesce(s.contenu->'voeux', '[]'::jsonb)),
               'refus_lieu',   jsonb_array_length(coalesce(s.contenu->'refus_lieu', '[]'::jsonb)),
               'options_date', jsonb_array_length(coalesce(s.contenu->'options_date', '[]'::jsonb)),
               'logements',    jsonb_array_length(coalesce(s.contenu->'logements', '[]'::jsonb)),
               'couchages',    jsonb_array_length(coalesce(s.contenu->'couchages', '[]'::jsonb))
             )
           ) order by s.prise_le desc)
      from private.sauvegardes s
  ), '[]'::jsonb);
end $fn$;

-- ---- 12b. Une copie a la demande ----
--
--  Avant une operation qu'on sent risquee, sans attendre lundi.
--
create or replace function public.admin_sauvegarde_prendre(p_code text)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  nouveau uuid;
begin
  perform private.verifier_code(p_code, 'admin');

  insert into private.sauvegardes (semaine, motif, contenu)
  values (date_trunc('week', now() at time zone 'Europe/Paris')::date,
          'manuelle', private.etat_courant())
  returning id into nouveau;

  perform private.sauvegardes_purger();
  return jsonb_build_object('id', nouveau);
end $fn$;

-- ---- 12c. Le contenu d'une copie, et celui du present ----
--
--  Meme forme, pour que le navigateur puisse les comparer champ a champ.
--
create or replace function public.admin_sauvegarde_lire(p_code text, p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
declare
  trouve jsonb;
begin
  perform private.verifier_code(p_code, 'admin');
  select s.contenu into trouve from private.sauvegardes s where s.id = p_id;
  if trouve is null then
    raise exception 'SAUVEGARDE_INCONNUE' using errcode = 'P0001';
  end if;
  return trouve;
end $fn$;

create or replace function public.admin_etat(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = private, pg_temp as $fn$
begin
  perform private.verifier_code(p_code, 'admin');
  return private.etat_courant();
end $fn$;

-- ---- 12d. Revenir dessus ----
--
--  Remplacement complet : apres l'appel, la base est celle de la copie.
--  Tout ce qui a ete saisi depuis disparait -- d'ou la copie
--  « avant_restauration » prise juste avant, qui rend le geste lui-meme
--  annulable. Se tromper de ligne dans la liste ne doit pas etre la
--  derniere erreur possible.
--
--  Les cinq tables sont citees ensemble dans le TRUNCATE parce qu'elles
--  se referencent : Postgres refuse de vider seule une table dont une
--  autre depend. Les participants sont reinseres en premier, et leurs
--  liens croises (parent, conjoint) passent parce que les cles etrangeres
--  ne sont verifiees qu'en fin d'instruction.
--
create or replace function public.admin_sauvegarde_restaurer(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  c jsonb;
  n_participants integer;
  n_presences    integer;
  n_voeux        integer;
  n_refus        integer;
  n_options      integer;
  n_logements    integer;   -- reste null si la copie ne dit rien des logements
  n_couchages    integer;   -- idem pour le plan de couchage
  couchages_gardes jsonb;   -- le plan mis de cote quand la copie l'ignore
begin
  perform private.verifier_code(p_code, 'admin');

  select s.contenu into c from private.sauvegardes s where s.id = p_id;
  if c is null then
    raise exception 'SAUVEGARDE_INCONNUE' using errcode = 'P0001';
  end if;

  insert into private.sauvegardes (semaine, motif, contenu)
  values (date_trunc('week', now() at time zone 'Europe/Paris')::date,
          'avant_restauration', private.etat_courant());

  -- Une copie anterieure au plan de couchage n'en dit rien, et le silence
  -- n'est pas « il n'y en avait aucun ». Mais `couchages` reference
  -- `participants` : Postgres refuse de vider seule une table referencee,
  -- meme quand la referencante n'a aucune ligne. Elle doit donc figurer
  -- dans le TRUNCATE -- on la met de cote, et on la repose apres.
  if not (c ? 'couchages') then
    select jsonb_agg(to_jsonb(x)) into couchages_gardes from private.couchages x;
  end if;

  truncate table public.presences, public.voeux, public.refus_lieu,
                 private.couchages, private.options_date, private.participants;

  insert into private.participants
    (id, prenom, famille, categorie_age, parent_id, conjoint_id, invite, portee,
     date_naissance, cree_le)
  select (l->>'id')::uuid,
         l->>'prenom',
         l->>'famille',
         l->>'categorie_age',
         nullif(l->>'parent_id', '')::uuid,
         nullif(l->>'conjoint_id', '')::uuid,
         coalesce((l->>'invite')::boolean, false),
         coalesce(nullif(l->>'portee', ''), 'descendance'),
         nullif(l->>'date_naissance', '')::date,
         coalesce((l->>'cree_le')::timestamptz, now())
    from jsonb_array_elements(coalesce(c->'participants', '[]'::jsonb)) as l;
  get diagnostics n_participants = row_count;

  insert into private.options_date (id, libelle, date_debut, date_fin, cree_le)
  select (l->>'id')::uuid,
         l->>'libelle',
         nullif(l->>'date_debut', '')::date,
         nullif(l->>'date_fin', '')::date,
         coalesce((l->>'cree_le')::timestamptz, now())
    from jsonb_array_elements(coalesce(c->'options_date', '[]'::jsonb)) as l;
  get diagnostics n_options = row_count;

  insert into public.presences
    (id, participant_id, jour, hebergement, petit_dejeuner, dejeuner, diner, vue_mer, maj_le)
  select (l->>'id')::uuid,
         (l->>'participant_id')::uuid,
         (l->>'jour')::date,
         l->>'hebergement',
         coalesce((l->>'petit_dejeuner')::boolean, false),
         coalesce((l->>'dejeuner')::boolean, false),
         coalesce((l->>'diner')::boolean, false),
         coalesce((l->>'vue_mer')::boolean, false),
         coalesce((l->>'maj_le')::timestamptz, now())
    from jsonb_array_elements(coalesce(c->'presences', '[]'::jsonb)) as l;
  get diagnostics n_presences = row_count;

  insert into public.voeux (id, participant_id, option_id, choix, maj_le)
  select (l->>'id')::uuid,
         (l->>'participant_id')::uuid,
         (l->>'option_id')::uuid,
         l->>'choix',
         coalesce((l->>'maj_le')::timestamptz, now())
    from jsonb_array_elements(coalesce(c->'voeux', '[]'::jsonb)) as l;
  get diagnostics n_voeux = row_count;

  insert into public.refus_lieu (id, participant_id, departement, maj_le)
  select (l->>'id')::uuid,
         (l->>'participant_id')::uuid,
         l->>'departement',
         coalesce((l->>'maj_le')::timestamptz, now())
    from jsonb_array_elements(coalesce(c->'refus_lieu', '[]'::jsonb)) as l;
  get diagnostics n_refus = row_count;

  -- L'inventaire n'entre dans les copies que depuis la section 11. Une
  -- copie plus ancienne ne dit RIEN a son sujet -- et le silence n'est pas
  -- « il n'y en avait aucun ». On n'y touche donc pas, et le compte rendu
  -- le dit en renvoyant `null` plutot que zero. `logements` ne figure pas
  -- dans le TRUNCATE ci-dessus pour cette seule raison.
  if c ? 'logements' then
    -- `couchages` est deja vide, mais il reference `logements` : le vider
    -- avec lui est la seule forme que Postgres accepte.
    truncate table private.logements, private.couchages;
    insert into private.logements (id, categorie, capacite, nombre, vue_mer, cree_le)
    select (l->>'id')::uuid,
           l->>'categorie',
           (l->>'capacite')::smallint,
           (l->>'nombre')::smallint,
           coalesce((l->>'vue_mer')::boolean, false),
           coalesce((l->>'cree_le')::timestamptz, now())
      from jsonb_array_elements(c->'logements') as l;
    get diagnostics n_logements = row_count;
  end if;

  -- Le plan revient apres les participants ET les logements : il pointe
  -- vers les deux.
  if c ? 'couchages' then
    insert into private.couchages (id, participant_id, jour, logement_id, numero, maj_le)
    select (l->>'id')::uuid,
           (l->>'participant_id')::uuid,
           (l->>'jour')::date,
           (l->>'logement_id')::uuid,
           (l->>'numero')::smallint,
           coalesce((l->>'maj_le')::timestamptz, now())
      from jsonb_array_elements(c->'couchages') as l;
    get diagnostics n_couchages = row_count;

  elsif couchages_gardes is not null then
    -- La copie ne parle pas du plan : on le remet tel qu'il etait. Seules
    -- partent les lignes dont la personne ou le couchage n'existe plus
    -- apres la restauration -- les garder violerait les cles etrangeres,
    -- et elles ne designeraient plus rien.
    insert into private.couchages (id, participant_id, jour, logement_id, numero, maj_le)
    select (l->>'id')::uuid,
           (l->>'participant_id')::uuid,
           (l->>'jour')::date,
           (l->>'logement_id')::uuid,
           (l->>'numero')::smallint,
           coalesce((l->>'maj_le')::timestamptz, now())
      from jsonb_array_elements(couchages_gardes) as l
     where exists (select 1 from private.participants p
                    where p.id = (l->>'participant_id')::uuid)
       and exists (select 1 from private.logements g
                    where g.id = (l->>'logement_id')::uuid);
    -- `n_couchages` reste null : rien n'a ete RESTAURE, seulement conserve.
  end if;

  perform private.sauvegardes_purger();

  return jsonb_build_object(
    'participants', n_participants,
    'options_date', n_options,
    'presences', n_presences,
    'voeux', n_voeux,
    'refus_lieu', n_refus,
    'logements', n_logements,
    'couchages', n_couchages
  );
end $fn$;

grant execute on function public.admin_sauvegardes_lister(text)          to anon;
grant execute on function public.admin_sauvegarde_prendre(text)          to anon;
grant execute on function public.admin_sauvegarde_lire(text, uuid)       to anon;
grant execute on function public.admin_etat(text)                        to anon;
grant execute on function public.admin_sauvegarde_restaurer(text, uuid)  to anon;

-- ============================================================
--  13. Etat de la base apres execution
-- ============================================================
--
--  Affiche ce qui existe reellement, plutot que de le supposer.
--
--    codes_famille  doit valoir 1  -> sinon, passer reglages.exemple.sql
--    codes_admin    doit valoir 1  -> sinon, lancer creer_code_admin.py
--    reglages       doit valoir 1  -> sinon, passer reglages.exemple.sql
--    participants   0 avant l'amorcage, puis la taille de la famille
--    presences      ce qui a ete saisi -- ce script n'y touche plus
--    options_date   les week-ends proposes, poses depuis admin.html
--    voeux          les reponses de la famille au sondage des dates
--    refus_lieu     les departements peints en rouge sur la carte
--    logements      l'inventaire des couchages, pose depuis admin.html
--    couchages      qui dort ou, nuit par nuit
--    sauvegardes    0 tant que personne n'a rien modifie cette semaine
--
select
  (select count(*) from private.participants) as participants,
  (select count(*) from public.presences)     as presences,
  (select count(*) from private.acces)        as codes_famille,
  (select count(*) from private.acces_admin)  as codes_admin,
  (select count(*) from private.reglages)     as reglages,
  (select count(*) from private.options_date) as options_date,
  (select count(*) from public.voeux)         as voeux,
  (select count(*) from public.refus_lieu)    as refus_lieu,
  (select count(*) from private.logements)    as logements,
  (select count(*) from private.couchages)    as couchages,
  (select count(*) from private.sauvegardes)  as sauvegardes;
