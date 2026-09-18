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
  ('8aee72f9-e1a8-46ac-bb49-da99296cd2c7', 'Gerard', 'Durand', 'adulte', null, 'd8ab2863-42fd-4bd2-9c1d-ed0692ee9ca8'),
  ('d8ab2863-42fd-4bd2-9c1d-ed0692ee9ca8', 'Simone', 'Durand', 'adulte', null, '8aee72f9-e1a8-46ac-bb49-da99296cd2c7'),
  ('9e1f036f-8d1f-4553-9036-b753df7b9d6e', 'Sylvain', 'Durand', 'adulte', '8aee72f9-e1a8-46ac-bb49-da99296cd2c7', 'daaa2114-588e-4b3d-8063-d280ea229de4'),
  ('daaa2114-588e-4b3d-8063-d280ea229de4', 'Nadia', 'Durand', 'adulte', '8aee72f9-e1a8-46ac-bb49-da99296cd2c7', '9e1f036f-8d1f-4553-9036-b753df7b9d6e'),
  ('0432d9c3-ed32-440c-afe9-e96c676ad792', 'Louise', 'Durand', 'enfant', '9e1f036f-8d1f-4553-9036-b753df7b9d6e', null),
  ('f5bf90fe-b69f-43d6-a2e7-5bafb490529a', 'Simon', 'Durand', 'adulte', '8aee72f9-e1a8-46ac-bb49-da99296cd2c7', null),
  ('a57e32da-7027-4815-891b-5d96ca769b3b', 'Marthe', 'Petit', 'adulte', null, null),
  ('8816e722-50a2-48ea-b270-d82a69366332', 'Paul', 'Petit', 'adulte', 'a57e32da-7027-4815-891b-5d96ca769b3b', '999a1584-6945-4e35-912b-0d9d7166eacc'),
  ('999a1584-6945-4e35-912b-0d9d7166eacc', 'Alice', 'Petit', 'adulte', 'a57e32da-7027-4815-891b-5d96ca769b3b', '8816e722-50a2-48ea-b270-d82a69366332'),
  ('252ee002-7367-40df-a2c7-0fdb5e1fc523', 'Jules', 'Petit', 'enfant', '8816e722-50a2-48ea-b270-d82a69366332', null),
  ('5469e8a8-736a-4c6f-b415-9e97c7a94c95', 'Zoe', 'Petit', 'bebe', '8816e722-50a2-48ea-b270-d82a69366332', null),
  ('fd01f7e9-da87-4dd0-882e-cca581efefaf', 'Helene', 'Petit', 'adulte', 'a57e32da-7027-4815-891b-5d96ca769b3b', null);

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
