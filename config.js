// Configuration Supabase.
//
// Ces deux valeurs sont PUBLIQUES par conception : le site est servi
// par GitHub Pages, n'importe qui peut lire ce fichier. Ce n'est pas
// un probleme tant que le RLS est actif (cf. supabase/schema.sql) :
// la cle `anon` ne permet que d'INSERER, jamais de lire ni modifier.
//
// La cle `service_role`, elle, ne doit JAMAIS apparaitre ici.
window.CONFIG = {
  SUPABASE_URL: "https://REMPLACER.supabase.co",
  SUPABASE_ANON_KEY: "REMPLACER",

  // Dates du sejour (bornes incluses).
  DATE_DEBUT: "2027-07-10",
  DATE_FIN: "2027-07-14",
};
