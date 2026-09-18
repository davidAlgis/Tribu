// Configuration Supabase.
//
// Ces deux valeurs sont PUBLIQUES par conception : le site est servi
// par GitHub Pages, n'importe qui peut lire ce fichier. Ce n'est pas
// un probleme tant que le RLS est actif (cf. supabase/schema.sql) :
// la cle publishable ne permet que d'INSERER, jamais de lire ni modifier.
//
// La cle `secret` (sb_secret_...), elle, ne doit JAMAIS apparaitre ici :
// elle contourne le RLS et reste sur la machine qui genere les exports.
window.CONFIG = {
  SUPABASE_URL: "https://hxytygyppzgjvdmixfqj.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_9cgp2cV9ydUKJmcz_erROw_dOqN57NI",

  // Dates du sejour (bornes incluses). A ajuster quand l'hotel sera connu.
  DATE_DEBUT: "2027-07-10",
  DATE_FIN: "2027-07-14",
};
