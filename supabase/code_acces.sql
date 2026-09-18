-- ============================================================
--  Tribu - code d'acces famille (niveau 1)
--  A coller dans Supabase > SQL Editor > New query > Run
-- ============================================================
--
--  PROBLEME : la cle publishable est dans config.js, donc publique.
--  Des robots scannent GitHub en permanence a la recherche de cles
--  Supabase exposees et tentent des insertions automatiques.
--
--  SOLUTION : un secret partage que le formulaire exige, et qui
--  n'apparait NULLE PART dans le code source.
--
--  Le mecanisme est versionne ici, mais la table reste vide :
--  le code lui-meme se pose a la main (voir la fin du fichier).
-- ============================================================

-- ---------- Un schema que PostgREST n'expose pas ----------
--
--  Indispensable : une fonction placee dans `public` serait
--  appelable depuis l'exterieur en RPC :
--      POST /rest/v1/rpc/code_valide {"c": "essai"}
--  ...ce qui donnerait a un attaquant un oracle pour tester des
--  milliers de codes a la seconde. Dans `private`, PostgREST ne
--  l'expose pas, mais les policies peuvent toujours l'appeler.
--
create schema if not exists private;

grant usage on schema private to anon;  -- juste de quoi appeler la fonction

-- ---------- La table qui detient le secret ----------
create table if not exists private.acces (
  code_normalise text primary key,
  libelle        text,
  cree_le        timestamptz not null default now()
);

alter table private.acces enable row level security;
revoke all on private.acces from anon;
-- Aucune policy : meme en cas de fuite de la cle, cette table est
-- inatteignable. Seule une fonction `security definer` la lit.

-- ---------- Normalisation ----------
--
--  Le code doit etre simple a retenir et a dicter au telephone.
--  On accepte donc toutes les variantes d'ecriture :
--      "Tribu 2027", "tribu-2027", "TRIBU2027", "Tribù 2027"
--  deviennent toutes "tribu2027".
--
create or replace function private.normaliser_code(c text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           lower(translate(
             coalesce(c, ''),
             'àâäãéèêëíìîïóòôöõúùûüçñÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
             'aaaaeeeeiiiiooooouuuucnAAAAEEEEIIIIOOOOOUUUUCN'
           )),
           '[^a-z0-9]', '', 'g'
         )
$$;

-- ---------- La verification ----------
--
--  `security definer` : la fonction lit private.acces avec les droits
--  de son proprietaire, alors que l'appelant (anon) n'y a aucun acces.
--  `search_path` fige : sans cela, un attaquant pourrait detourner la
--  resolution des noms de tables.
--
create or replace function private.code_valide(c text)
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select exists (
    select 1 from private.acces
    where code_normalise = private.normaliser_code(c)
  )
$$;

grant execute on function private.code_valide(text) to anon;

-- ---------- Le code voyage avec la ligne ----------
--
--  Stocke en clair, mais dans une table qu'anon ne peut pas lire.
--  C'est volontairement simple : une verification par en-tete HTTP
--  personnalise obligerait a toucher a la configuration CORS.
--
alter table public.personnes add column if not exists code_acces text;
alter table public.presences add column if not exists code_acces text;

-- ---------- Les policies exigent desormais le code ----------
drop policy if exists "anon peut inserer une personne" on public.personnes;
create policy "anon peut inserer une personne"
  on public.personnes for insert to anon
  with check (private.code_valide(code_acces));

drop policy if exists "anon peut inserer une presence" on public.presences;
create policy "anon peut inserer une presence"
  on public.presences for insert to anon
  with check (private.code_valide(code_acces));


-- ============================================================
--  A FAIRE A LA MAIN, ET UNIQUEMENT ICI
-- ============================================================
--
--  Choisis un code court, prononcable, sans ambiguite a l'oral.
--  La casse, les accents, les espaces et les tirets sont ignores.
--
--  Decommente la ligne suivante en remplacant le code, puis execute-la
--  SEULE. Ne la commite jamais : ce fichier part sur un repo public.
--
--     insert into private.acces (code_normalise, libelle)
--     values (private.normaliser_code('TON CODE ICI'), 'Sejour 2027');
--
--  Pour verifier que ca marche (doit renvoyer `true`) :
--
--     select private.code_valide('ton code ici');
--
--  Pour changer le code plus tard :
--
--     delete from private.acces;
--     insert into private.acces (code_normalise, libelle)
--     values (private.normaliser_code('NOUVEAU CODE'), 'Sejour 2027');
--
