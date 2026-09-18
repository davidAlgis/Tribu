-- ============================================================
--  Participants - FICHIER GENERE, NE PAS EDITER A LA MAIN
-- ============================================================
--
--  Produit par generer_participants.py a partir de famille.exemple.txt.
--  Pour changer la liste : edite ce fichier .txt et relance
--
--      python generer_participants.py
--
--  Les identifiants sont poses ici plutot que tires par Postgres :
--  cela permet de lier parents et conjoints en un seul insert, sans
--  dependre de l'unicite des prenoms.
-- ============================================================

delete from private.participants;

insert into private.participants
  (id, prenom, famille, categorie_age, parent_id, conjoint_id)
values
  ('e4b4aabf-e472-422e-985c-49c7f0f9893c', 'Gerard', 'Durand', 'adulte', null, 'e29cc6cd-104c-4561-8a35-a3f8adde86f8'),
  ('e29cc6cd-104c-4561-8a35-a3f8adde86f8', 'Simone', 'Durand', 'adulte', null, 'e4b4aabf-e472-422e-985c-49c7f0f9893c'),
  ('c2477639-8bad-40ad-b310-8990bf8dea16', 'Sylvain', 'Durand', 'adulte', 'e4b4aabf-e472-422e-985c-49c7f0f9893c', '25587225-aeb1-45ed-b4e9-16d5acc1e6a2'),
  ('25587225-aeb1-45ed-b4e9-16d5acc1e6a2', 'Nadia', 'Durand', 'adulte', 'e4b4aabf-e472-422e-985c-49c7f0f9893c', 'c2477639-8bad-40ad-b310-8990bf8dea16'),
  ('f51f9c8f-ffad-4f7b-bec1-9046caec46dc', 'Louise', 'Durand', 'enfant', 'c2477639-8bad-40ad-b310-8990bf8dea16', null),
  ('be308f05-d03d-4926-b3ef-e1c585eb70e8', 'Simon', 'Durand', 'adulte', 'e4b4aabf-e472-422e-985c-49c7f0f9893c', null),
  ('ff022252-6d1e-4f32-a138-fbfdff2aea77', 'Marthe', 'Petit', 'adulte', null, null),
  ('f1cb08c8-ad16-4c49-865d-dcc06295dd25', 'Paul', 'Petit', 'adulte', 'ff022252-6d1e-4f32-a138-fbfdff2aea77', '33e2e7a1-059e-47c6-b7d4-9468dbcd20fd'),
  ('33e2e7a1-059e-47c6-b7d4-9468dbcd20fd', 'Alice', 'Petit', 'adulte', 'ff022252-6d1e-4f32-a138-fbfdff2aea77', 'f1cb08c8-ad16-4c49-865d-dcc06295dd25'),
  ('0d4bc247-b74d-4b5c-b450-512c60c8ee9f', 'Jules', 'Petit', 'enfant', 'f1cb08c8-ad16-4c49-865d-dcc06295dd25', null),
  ('dff2310b-5163-4fa1-a54b-2c0096826efc', 'Zoe', 'Petit', 'bebe', 'f1cb08c8-ad16-4c49-865d-dcc06295dd25', null),
  ('7cef5ae8-c723-40a4-90f5-65c93a09a42b', 'Helene', 'Petit', 'adulte', 'ff022252-6d1e-4f32-a138-fbfdff2aea77', null);

-- Verification : qui peut modifier qui.
-- A lire une fois avant d'ouvrir la saisie a la famille.
select
  acteur.prenom as "peut modifier",
  count(*) as "nb",
  string_agg(cible.prenom, ', ' order by cible.prenom) as "ces personnes"
from private.participants acteur
cross join lateral private.personnes_modifiables(acteur.id) m
join private.participants cible on cible.id = m.id
group by acteur.prenom
order by acteur.prenom;
