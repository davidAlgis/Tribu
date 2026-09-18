-- ============================================================
--  Tribu - le code d'acces et la liste des participants
-- ============================================================
--
--  CE FICHIER EST UN MODELE. Les prenoms ci-dessous sont inventes.
--
--  Le depot est PUBLIC : ni le vrai code, ni les vrais prenoms ne
--  doivent y figurer. Adapte ce script dans le SQL Editor de Supabase
--  et ne recommite jamais ta version remplie.
-- ============================================================


-- ------------------------------------------------------------
--  1. Les dates du sejour
-- ------------------------------------------------------------
--
--  Le formulaire lit ces dates : il n'y a rien a changer dans le code
--  quand elles bougent. `saisie_ouverte` a false ferme le formulaire
--  pour tout le monde, ce qui reduit la surface d'attaque a zero hors
--  periode de collecte.
--
insert into private.reglages (id, date_debut, date_fin, saisie_ouverte)
values (true, '2027-07-10', '2027-07-14', true)
on conflict (id) do update
  set date_debut     = excluded.date_debut,
      date_fin       = excluded.date_fin,
      saisie_ouverte = excluded.saisie_ouverte;


-- ------------------------------------------------------------
--  2. Le code d'acces
-- ------------------------------------------------------------
--
--  Casse, accents, espaces et tirets sont ignores : "Les Abricots",
--  "lesabricots" et "LES-ABRICOTS" sont le meme code.
--
--  Evite `tribu` et l'annee : le depot s'appelle publiquement Tribu et
--  les dates sont dans la base. Prends ce que seule la famille connait.
--
delete from private.acces;
insert into private.acces (code_normalise, libelle)
values (private.normaliser_code('CHANGE MOI'), 'Sejour 2027');

-- Verification (doit renvoyer true) :
--   select private.code_valide('change moi');


-- ------------------------------------------------------------
--  3. Les participants
-- ------------------------------------------------------------
--
--  Deux liens suffisent a decrire la famille :
--
--    parent_id   -> le parent dont la personne descend
--    conjoint_id -> le/la partenaire
--
--  Et ils determinent qui peut modifier qui : chacun couvre son
--  conjoint, ses descendants, et les conjoints de ses descendants.
--
--  L'exemple ci-dessous decrit trois generations :
--
--      Gerard === Simone                 (les grands-parents)
--         |
--         +-- Sylvain === Nadia
--         |       |
--         |       +-- Louise             (petite-fille)
--         |
--         +-- Simon
--
--  Gerard et Simone couvrent tout le monde.
--  Sylvain et Nadia couvrent Louise.
--  Simon ne couvre que lui-meme. Il ne peut pas toucher a Sylvain :
--  un frere n'a aucun droit sur son frere.
--
delete from private.participants;

insert into private.participants (prenom, famille, categorie_age)
values
  ('Gerard',  'Durand', 'adulte'),
  ('Simone',  'Durand', 'adulte'),
  ('Sylvain', 'Durand', 'adulte'),
  ('Simon',   'Durand', 'adulte'),
  ('Nadia',   'Durand', 'adulte'),
  ('Louise',  'Durand', 'enfant');

-- Les couples, poses des deux cotes.
update private.participants a
   set conjoint_id = b.id
  from private.participants b
 where (a.prenom, b.prenom) in (
         ('Gerard', 'Simone'), ('Simone', 'Gerard'),
         ('Sylvain', 'Nadia'), ('Nadia', 'Sylvain')
       );

-- La filiation. Il suffit de rattacher l'enfant a UN seul parent :
-- l'autre le couvre via son conjoint.
update private.participants e
   set parent_id = p.id
  from private.participants p
 where (e.prenom, p.prenom) in (
         ('Sylvain', 'Gerard'),
         ('Simon',   'Gerard'),
         ('Louise',  'Sylvain')
       );


-- ------------------------------------------------------------
--  4. Verifier les droits obtenus
-- ------------------------------------------------------------
--
--  Affiche, pour chaque personne, qui elle peut modifier. A lire une
--  fois avant d'envoyer le lien a la famille : c'est le seul moyen de
--  voir que l'arbre est correct.
--
select
  acteur.prenom as "peut modifier",
  string_agg(cible.prenom, ', ' order by cible.prenom) as "ces personnes"
from private.participants acteur
cross join lateral private.personnes_modifiables(acteur.id) m
join private.participants cible on cible.id = m.id
group by acteur.prenom
order by acteur.prenom;

--  Resultat attendu avec l'exemple ci-dessus :
--
--    Gerard  | Gerard, Louise, Nadia, Simon, Simone, Sylvain
--    Simone  | Gerard, Louise, Nadia, Simon, Simone, Sylvain
--    Sylvain | Louise, Nadia, Sylvain
--    Nadia   | Louise, Nadia, Sylvain
--    Simon   | Simon
--    Louise  | Louise
