-- ============================================================
--  Tribu - schema complet
--  A coller dans Supabase > SQL Editor > New query > Run
-- ============================================================
--
--  ATTENTION : ce script repart de zero. Il supprime les tables
--  precedentes et les donnees de test qu'elles contiennent.
--
--  PRINCIPES
--
--  1. La base ne stocke que des FAITS SAISIS. Aucun regime, aucun
--     tarif, aucun total : tout est derive par le Python.
--
--  2. Aucune table n'est accessible directement depuis le navigateur.
--     Tout passe par trois fonctions qui verifient le code d'acces et
--     les droits.
--
--  3. Absent est l'etat par defaut. Une personne qui n'a rien saisi
--     n'a aucune ligne. Saisir, c'est declarer une presence.
-- ============================================================

drop table if exists public.presences cascade;
drop table if exists public.personnes cascade;

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

-- ============================================================
--  2. Le code d'acces, partage par toute la famille
-- ============================================================
--
--  Ce code n'est ecrit NULLE PART dans le depot, qui est public.
--  Il se pose a la main (voir supabase/participants.exemple.sql).
--
create table if not exists private.acces (
  code_normalise text primary key,
  libelle        text,
  cree_le        timestamptz not null default now()
);

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
create or replace function private.code_valide(c text)
returns boolean language sql stable
set search_path = private, pg_temp as $fn$
  select exists (
    select 1 from private.acces
    where code_normalise = private.normaliser_code(c)
  )
$fn$;

create or replace function private.verifier_code(c text)
returns void language plpgsql stable
set search_path = private, pg_temp as $fn$
begin
  if not private.code_valide(c) then
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
  cree_le       timestamptz not null default now()
);

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
create table public.presences (
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
  with recursive portee as (
    select p.id, p.conjoint_id
    from private.participants p
    where p.id = p_acteur

    union

    select p.id, p.conjoint_id
    from private.participants p
    join portee f
      on p.parent_id = f.id           -- ses enfants
      or p.id = f.conjoint_id         -- son conjoint
      or p.conjoint_id = f.id         -- ...meme si le lien n'est pose que d'un cote
  )
  select portee.id from portee
$fn$;

-- ============================================================
--  6. Les trois seules portes d'entree du navigateur
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

-- ---- 6c. Enregistrer la saisie d'une personne ----
--
--  Remplacement complet : ce que le formulaire envoie devient l'etat
--  exact de cette personne. Decocher un jour le supprime, donc la rend
--  absente. C'est ce qui rend la modification possible a tout moment
--  sans jamais accumuler de doublons.
--
create or replace function public.sejour_enregistrer(
  p_code    text,
  p_acteur  uuid,
  p_cible   uuid,
  p_lignes  jsonb
)
returns jsonb
language plpgsql security definer
set search_path = private, pg_temp as $fn$
declare
  r  private.reglages;
  nb integer;
begin
  perform private.verifier_code(p_code);

  select * into r from private.reglages;
  if not r.saisie_ouverte then
    raise exception 'SAISIE_FERMEE' using errcode = 'P0001';
  end if;

  if p_cible not in (select m.id from private.personnes_modifiables(p_acteur) m) then
    raise exception 'DROIT_REFUSE' using errcode = 'P0001';
  end if;

  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) > 400 then
    raise exception 'TROP_DE_LIGNES' using errcode = 'P0001';
  end if;

  delete from public.presences where participant_id = p_cible;

  insert into public.presences (
    participant_id, jour, hebergement, petit_dejeuner, dejeuner, diner, vue_mer
  )
  select
    p_cible,
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
  return jsonb_build_object('enregistrees', nb);
end $fn$;

grant execute on function public.participants_lister(text)                   to anon;
grant execute on function public.sejour_charger(text, uuid)                  to anon;
grant execute on function public.sejour_enregistrer(text, uuid, uuid, jsonb) to anon;

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
  select id, prenom, famille, categorie_age
  from private.participants;

revoke all on public.v_participants from anon, authenticated;
grant select on public.v_participants to service_role;

revoke all on public.presences from anon, authenticated;
grant select on public.presences to service_role;
