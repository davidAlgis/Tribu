-- ============================================================
--  Tribu - dates du sejour et code d'acces
--  A coller dans Supabase > SQL Editor, APRES schema.sql
-- ============================================================
--
--  CE FICHIER EST UN MODELE. Adapte-le dans le SQL Editor et ne
--  recommite jamais ta version remplie : le depot est public.
--
--  La liste des participants, elle, n'est pas ici : elle se genere
--  a partir de famille.txt (voir generer_participants.py).
-- ============================================================


-- ------------------------------------------------------------
--  1. Les dates du sejour
-- ------------------------------------------------------------
--
--  Le formulaire lit ces dates : rien a changer dans le code quand
--  elles bougent. `saisie_ouverte` a false ferme le formulaire pour
--  tout le monde, ce qui ramene la surface d'attaque a zero hors
--  periode de collecte.
--
insert into private.reglages (id, date_debut, date_fin, saisie_ouverte)
values (true, '2027-07-10', '2027-07-14', true)
on conflict (id) do update
  set date_debut     = excluded.date_debut,
      date_fin       = excluded.date_fin,
      saisie_ouverte = excluded.saisie_ouverte;


-- ------------------------------------------------------------
--  2. Le code d'acces, partage par toute la famille
-- ------------------------------------------------------------
--
--  Casse, accents, espaces et tirets sont ignores : "Les Abricots",
--  "lesabricots" et "LES-ABRICOTS" sont le meme code.
--
--  Evite `tribu` et l'annee : le depot s'appelle publiquement Tribu et
--  les dates sont en base. Prends ce que seule la famille connait.
--
delete from private.acces;
insert into private.acces (code_normalise, libelle)
values (private.normaliser_code('CHANGE MOI'), 'Sejour 2027');

-- Verification (doit renvoyer true) :
--   select private.code_valide('change moi');
