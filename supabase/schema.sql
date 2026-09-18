-- ============================================================
--  Tribu - schema Supabase (POC)
--  A coller dans Supabase > SQL Editor > New query > Run
-- ============================================================
--
--  PRINCIPE : la base ne stocke que des FAITS SAISIS.
--  Aucun regime (pension complete, demi-pension...), aucun tarif,
--  aucun total n'est stocke ici : tout est calcule par le Python.
--
--  Si une regle metier change, on change le code, pas la base.
-- ============================================================

-- ---------- Table 1 : les personnes ----------
create table if not exists public.personnes (
  id             uuid primary key,
  nom            text not null check (length(trim(nom)) between 1 and 80),
  famille        text not null check (length(trim(famille)) between 1 and 80),
  categorie_age  text not null check (categorie_age in ('adulte', 'enfant', 'bebe')),
  created_at     timestamptz not null default now()
);

-- ---------- Table 2 : les presences ----------
--
--  Une ligne = une personne, un jour de calendrier.
--
--  hebergement    : ou la personne dort LA NUIT DU `jour` AU LENDEMAIN.
--                   'exterieur' = presente ce jour-la mais ne dort pas
--                   sur place. Une personne totalement absente n'a
--                   simplement aucune ligne pour ce jour.
--  petit_dejeuner : repas pris LE MATIN du `jour`.
--  dejeuner       : repas pris LE MIDI du `jour`.
--  diner          : repas pris LE SOIR du `jour`.
--
--  C'est ce decalage (nuit du jour J, petit-dejeuner du jour J+1)
--  qui permet au Python de reconstituer les regimes :
--    diner[J] + nuit[J] + petit_dej[J+1] + dejeuner[J+1] = pension complete.
--
create table if not exists public.presences (
  id              uuid primary key,
  personne_id     uuid not null references public.personnes(id) on delete cascade,
  jour            date not null,
  hebergement     text not null check (hebergement in ('chambre', 'gite', 'exterieur')),
  petit_dejeuner  boolean not null default false,
  dejeuner        boolean not null default false,
  diner           boolean not null default false,
  vue_mer         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (personne_id, jour)
);

create index if not exists presences_jour_idx on public.presences (jour);

-- ============================================================
--  SECURITE : Row Level Security
-- ============================================================
--
--  Le site GitHub Pages est public et contient la cle `anon`.
--  On part donc du principe que N'IMPORTE QUI peut appeler l'API
--  avec cette cle. Les regles ci-dessous accordent donc le strict
--  minimum : INSERER, et rien d'autre.
--
--    - pas de SELECT  -> personne ne peut lire les donnees des autres
--    - pas de UPDATE  -> personne ne peut modifier une saisie existante
--    - pas de DELETE  -> personne ne peut effacer quoi que ce soit
--
--  La lecture se fait uniquement par le script Python, avec la cle
--  `service_role`, qui contourne le RLS et ne doit JAMAIS se trouver
--  dans le navigateur (uniquement en secret GitHub Actions ou en local).
--
alter table public.personnes enable row level security;
alter table public.presences enable row level security;

-- Deux verrous independants, et il faut passer les deux :
--
--   1. le GRANT  : le role a-t-il le droit d'utiliser cette operation ?
--   2. le RLS    : a-t-il le droit sur CES lignes-la ?
--
-- Le RLS seul ne suffit pas : sans GRANT, PostgreSQL refuse avant meme
-- de regarder les policies. On revoque donc tout, puis on ne rend que
-- l'insertion.
revoke all on public.personnes from anon;
revoke all on public.presences from anon;

grant insert on public.personnes to anon;
grant insert on public.presences to anon;

drop policy if exists "anon peut inserer une personne" on public.personnes;
create policy "anon peut inserer une personne"
  on public.personnes for insert to anon
  with check (true);

drop policy if exists "anon peut inserer une presence" on public.presences;
create policy "anon peut inserer une presence"
  on public.presences for insert to anon
  with check (true);

-- Note : aucune policy SELECT/UPDATE/DELETE n'est creee.
-- Avec le RLS actif, l'absence de policy = interdiction totale.
