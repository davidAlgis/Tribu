"use strict";

// La porte d'entree : le code, puis le choix.
//
// C'EST LA SEULE PAGE QUI NE DEMANDE RIEN D'AUTRE. Les quatre suivantes
// reprennent le code toutes seules -- il est retenu sur l'appareil -- et
// ne redemandent que le prenom, qui leur sert a savoir pour qui l'on
// repond. Celle-ci n'a pas besoin du prenom : elle n'ecrit rien.
//
// Le code est VERIFIE ici, et non simplement retenu. Le garder sans le
// verifier ferait echouer la page suivante, loin de l'endroit ou on l'a
// tape -- et la faute paraitrait venir d'elle.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const MESSAGES = {
  CODE_REFUSE: "Code incorrect. Demande-le à l'organisateur.",
};

async function rpc(fonction, args) {
  const reponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fonction}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      ...(SUPABASE_ANON_KEY.startsWith("eyJ")
        ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
        : {}),
    },
    body: JSON.stringify(args),
  });

  const corps = await reponse.json().catch(() => null);
  if (reponse.ok) return corps;

  const brut = corps && corps.message ? corps.message : `HTTP ${reponse.status}`;
  throw new Error(MESSAGES[brut] || brut);
}

// La meme clef que les quatre autres pages : entre une fois, entre
// partout.
const MEMOIRE = "tribu.code";

function lireMemoire() {
  try {
    return localStorage.getItem(MEMOIRE) || "";
  } catch {
    return "";
  }
}

function ecrireMemoire(valeur) {
  try {
    localStorage.setItem(MEMOIRE, valeur);
  } catch {
    /* navigation privee : sans importance */
  }
}

// LES DEUX ENSEMBLE. Les pages retiennent aussi le prenom de celui qui
// repond ; le laisser derriere ferait reprendre la saisie sous le nom du
// precedent des qu'un code est redonne -- sur un telephone qui circule,
// c'est exactement ce qu'on ne veut pas.
function oublierMemoire() {
  try {
    localStorage.removeItem(MEMOIRE);
    localStorage.removeItem("tribu.moi");
  } catch {
    /* idem */
  }
}

// ------------------------------------------------------------- etapes

const champCode = document.getElementById("code");
const messageCode = document.getElementById("message-code");

function montrer(id) {
  for (const section of document.querySelectorAll("main section")) {
    section.hidden = section.id !== id;
  }
}

champCode.value = lireMemoire();

document.getElementById("form-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = champCode.value.trim();
  messageCode.className = "";
  messageCode.textContent = "Vérification…";

  try {
    // N'importe quelle lecture protegee par le code ferait l'affaire :
    // celle-ci est la plus legere, et c'est celle que les autres pages
    // appellent en premier.
    await rpc("participants_lister", { p_code: code });
    ecrireMemoire(code);
    messageCode.textContent = "";
    montrer("etape-choix");
  } catch (erreur) {
    // Un code retenu qui ne passe plus : on l'oublie plutot que de le
    // laisser echouer page apres page.
    oublierMemoire();
    messageCode.className = "erreur";
    messageCode.textContent = erreur.message;
    champCode.select();
  }
});

document.getElementById("oublier").addEventListener("click", () => {
  oublierMemoire();
  champCode.value = "";
  messageCode.className = "";
  messageCode.textContent = "";
  montrer("etape-code");
  champCode.focus();
});

// Le code est deja connu de cet appareil : on saute la premiere etape,
// comme sur les quatre autres pages.
if (champCode.value) {
  document.getElementById("form-code").requestSubmit();
}
