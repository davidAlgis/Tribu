"use strict";

// Des tableaux vers un fichier : CSV, ou classeur Excel (.xlsx).
//
// SANS BIBLIOTHEQUE. Un .xlsx n'est qu'une archive zip de quelques fichiers
// XML ; l'ecrire tient en deux cents lignes, et ne fait pas dependre une
// page de famille d'un script tiers charge depuis un autre serveur. Le zip
// est STOCKE, sans compression : quelques tableaux de soixante lignes ne
// pesent rien, et la compression demanderait un second module.
//
// CE MODULE NE TOUCHE NI A LA PAGE NI AU RESEAU : il recoit des lignes,
// il rend des octets. Un test le fait tourner sous Node et relit le
// classeur avec openpyxl.
//
// Une LIGNE est une liste de valeurs : un nombre reste un nombre (Excel
// peut le sommer), un texte reste un texte, `null` laisse la case vide.

window.CLASSEUR = (function () {
  // ------------------------------------------------------------------ CSV
  //
  // A la francaise : point-virgule entre les cases et virgule decimale --
  // c'est ce qu'Excel attend sur un poste en francais, sans quoi tout
  // tombe dans la premiere colonne. Le BOM dit UTF-8 : sans lui, les
  // accents arrivent en desordre.
  function csv(lignes) {
    const dire = (v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return String(v).replace(".", ",");
      const texte = String(v);
      return /[;"\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
    };
    return "﻿" + lignes.map((l) => l.map(dire).join(";")).join("\r\n") + "\r\n";
  }

  // ----------------------------------------------------------------- XLSX

  const encodeur = new TextEncoder();

  function echapper(texte) {
    return String(texte)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Les caracteres de controle sont interdits en XML.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  }

  // A, B, ... Z, AA, AB...
  function colonne(rang) {
    let nom = "";
    let n = rang + 1;
    while (n > 0) {
      const reste = (n - 1) % 26;
      nom = String.fromCharCode(65 + reste) + nom;
      n = Math.floor((n - 1) / 26);
    }
    return nom;
  }

  // Excel refuse certains caracteres dans un nom de feuille, et plus de
  // trente et un. Deux feuilles ne peuvent pas porter le meme nom.
  function nommerFeuilles(noms) {
    const pris = new Set();
    return noms.map((nom, i) => {
      let propre = String(nom || `Feuille ${i + 1}`).replace(/[\[\]:*?/\\]/g, " ").trim();
      propre = (propre || `Feuille ${i + 1}`).slice(0, 31);
      let essai = propre;
      let n = 2;
      while (pris.has(essai.toLowerCase())) {
        const suffixe = ` (${n})`;
        essai = propre.slice(0, 31 - suffixe.length) + suffixe;
        n += 1;
      }
      pris.add(essai.toLowerCase());
      return essai;
    });
  }

  // La premiere ligne en gras : c'est l'en-tete.
  function feuilleXml(lignes) {
    const rangees = lignes
      .map((ligne, r) => {
        const cases = ligne
          .map((v, c) => {
            if (v === null || v === undefined || v === "") return "";
            const ref = `${colonne(c)}${r + 1}`;
            const style = r === 0 ? ' s="1"' : "";
            if (typeof v === "number" && Number.isFinite(v)) {
              return `<c r="${ref}"${style}><v>${v}</v></c>`;
            }
            return (
              `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">` +
              `${echapper(v)}</t></is></c>`
            );
          })
          .join("");
        return `<row r="${r + 1}">${cases}</row>`;
      })
      .join("");
    const largeur = Math.max(1, ...lignes.map((l) => l.length));
    const premiere = lignes[0] || [];
    const cols = Array.from({ length: largeur }, (_, c) => {
      const long = Math.max(8, ...lignes.map((l) => String(l[c] ?? "").length));
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, long + 2)}" customWidth="1"/>`;
    }).join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (premiere.length
        ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" ' +
          'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        : "") +
      `<cols>${cols}</cols><sheetData>${rangees}</sheetData></worksheet>`
    );
  }

  // `feuilles` : [{ nom, lignes }]. Rend les octets du .xlsx.
  function xlsx(feuilles) {
    const liste = feuilles.length ? feuilles : [{ nom: "Feuille 1", lignes: [] }];
    const noms = nommerFeuilles(liste.map((f) => f.nom));
    const fichiers = [
      [
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          liste
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            )
            .join("") +
          "</Types>",
      ],
      [
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ],
      [
        "xl/workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          noms
            .map((nom, i) => `<sheet name="${echapper(nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join("") +
          "</sheets></workbook>",
      ],
      [
        "xl/_rels/workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          liste
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" ` +
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
                `Target="worksheets/sheet${i + 1}.xml"/>`
            )
            .join("") +
          `<Relationship Id="rId${liste.length + 1}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
          'Target="styles.xml"/></Relationships>',
      ],
      [
        "xl/styles.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
          '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
          '<fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
          '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
          "</styleSheet>",
      ],
      ...liste.map((f, i) => [`xl/worksheets/sheet${i + 1}.xml`, feuilleXml(f.lignes || [])]),
    ];
    return zip(fichiers.map(([nom, texte]) => [nom, encodeur.encode(texte)]));
  }

  // ------------------------------------------------------------------ zip

  const TABLE_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(octets) {
    let c = 0xffffffff;
    for (let i = 0; i < octets.length; i += 1) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Une archive zip « stockee » : chaque fichier tel quel, son en-tete, puis
  // le repertoire central qui les liste. Date fixe -- le 1er janvier 2020 --
  // pour que deux exports des memes tableaux soient les memes octets.
  function zip(fichiers) {
    const DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
    const morceaux = [];
    const central = [];
    let position = 0;

    for (const [nom, donnees] of fichiers) {
      const octetsNom = encodeur.encode(nom);
      const crc = crc32(donnees);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // noms en UTF-8
      local.setUint16(8, 0, true); // stocke
      local.setUint16(10, 0, true);
      local.setUint16(12, DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, donnees.length, true);
      local.setUint32(22, donnees.length, true);
      local.setUint16(26, octetsNom.length, true);
      local.setUint16(28, 0, true);
      morceaux.push(new Uint8Array(local.buffer), octetsNom, donnees);

      const entree = new DataView(new ArrayBuffer(46));
      entree.setUint32(0, 0x02014b50, true);
      entree.setUint16(4, 20, true);
      entree.setUint16(6, 20, true);
      entree.setUint16(8, 0x0800, true);
      entree.setUint16(10, 0, true);
      entree.setUint16(12, 0, true);
      entree.setUint16(14, DATE, true);
      entree.setUint32(16, crc, true);
      entree.setUint32(20, donnees.length, true);
      entree.setUint32(24, donnees.length, true);
      entree.setUint16(28, octetsNom.length, true);
      entree.setUint32(42, position, true);
      central.push(new Uint8Array(entree.buffer), octetsNom);

      position += 30 + octetsNom.length + donnees.length;
    }

    const tailleCentral = central.reduce((t, m) => t + m.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, fichiers.length, true);
    fin.setUint16(10, fichiers.length, true);
    fin.setUint32(12, tailleCentral, true);
    fin.setUint32(16, position, true);

    const tout = [...morceaux, ...central, new Uint8Array(fin.buffer)];
    const resultat = new Uint8Array(tout.reduce((t, m) => t + m.length, 0));
    let curseur = 0;
    for (const m of tout) {
      resultat.set(m, curseur);
      curseur += m.length;
    }
    return resultat;
  }

  return { csv, xlsx };
})();
