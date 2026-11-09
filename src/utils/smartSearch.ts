/**
 * Recherche « intelligente » pour les listes d'articles de luxe :
 *  - insensible aux accents, à la casse, aux tirets / espaces
 *    (« key pole » = « keypole » = « Key-Pole ») ;
 *  - synonymes : noms de modèles tels qu'écrits par les maisons d'enchères
 *    japonaises (Keepall = « Key Pole »), français ⇄ anglais (portefeuille =
 *    wallet, noir = black…), abréviations (LV, YSL) ;
 *  - mots dans n'importe quel ordre, chacun devant être trouvé ;
 *  - début de mot accepté (« pol » trouve « pole ») et une faute de frappe
 *    tolérée sur les mots de 5 lettres ou plus (« neverful », « speddy »).
 */

const SYNONYMS: string[][] = [
  // Louis Vuitton — modèles
  ['keepall', 'key pole', 'keep all'],
  ['speedy', 'speedie'],
  ['neverfull', 'never full'],
  ['alma'],
  ['noe', 'petit noe', 'grand noe'],
  ['papillon', 'papiyon'],
  ['pochette accessoires', 'pochette accessoire', 'accessories pouch', 'accessory pouch'],
  ['saint cloud', 'st cloud'],
  ['saint jacques', 'st jacques'],
  ['porte tresor', 'tresor'],
  ['porte monnaie', 'coin case', 'coin purse', 'coin wallet'],
  ['porte cartes', 'porte carte', 'card case', 'card holder'],
  ['bucket', 'petit bucket'],
  ['batignolles', 'batignol'],
  ['viennois', 'vienois'],
  ['trocadero'],
  ['musette'],
  ['marceau'],
  ['boulogne'],
  ['favorite', 'favori'],
  ['montsouris', 'mont souris'],
  ['looping'],
  ['deauville'],
  ['zippy', 'zippy wallet'],
  ['sarah', 'portefeuille sarah'],
  ['eva'],
  ['pallas'],
  ['tivoli'],
  ['lockit'],
  ['reade'],
  ['bloomsbury'],
  ['pegase', 'pegase'],
  ['monogram', 'monogramme'],
  ['damier', 'damier ebene', 'damier azur'],
  ['epi'],
  ['vernis'],
  ['multicolore', 'multicolor', 'multi color'],
  // Chanel / Hermès / Dior / autres
  ['matelasse', 'quilted', 'timeless', 'classic flap'],
  ['caviar', 'caviar skin'],
  ['cambon'],
  ['coco mark', 'cc mark', 'coco'],
  ['kelly'],
  ['birkin'],
  ['evelyne'],
  ['garden party'],
  ['herbag'],
  ['saddle', 'selle'],
  ['lady dior'],
  ['jackie'],
  ['ophidia'],
  ['bamboo', 'bambou'],
  ['gg', 'gg canvas', 'gg supreme', 'gg marmont'],
  ['macadam'],
  ['zucca', 'zucchino'],
  ['baguette'],
  ['peekaboo'],
  ['triomphe'],
  ['puzzle'],
  ['galleria'],
  // Marques / abréviations
  ['louis vuitton', 'lv', 'vuitton'],
  ['yves saint laurent', 'ysl', 'saint laurent'],
  ['christian dior', 'dior'],
  ['hermes'],
  ['chanel'],
  ['gucci'],
  ['prada'],
  ['fendi'],
  ['celine'],
  ['givenchy'],
  ['loewe'],
  ['goyard'],
  ['bottega veneta', 'bottega', 'bv'],
  ['salvatore ferragamo', 'ferragamo'],
  ['miu miu', 'miumiu'],
  ['balenciaga'],
  ['burberry'],
  ['coach'],
  // Types d'articles (français ⇄ anglais)
  ['sac', 'bag', 'handbag'],
  ['sac a main', 'handbag', 'hand bag'],
  ['sac a dos', 'backpack', 'rucksack', 'back pack'],
  ['bandouliere', 'shoulder', 'crossbody', 'cross body', 'shoulder bag'],
  ['cabas', 'tote', 'tote bag', 'shopping'],
  ['sac de voyage', 'boston', 'travel bag', 'duffle'],
  ['pochette', 'pouch', 'clutch', 'clutch bag'],
  ['portefeuille', 'wallet', 'long wallet', 'bi fold', 'bifold', 'tri fold', 'trifold'],
  ['etui', 'case', 'cover'],
  ['ceinture', 'belt'],
  ['foulard', 'scarf', 'carre', 'twilly'],
  ['chaussures', 'shoes', 'sneakers', 'escarpins', 'pumps'],
  ['bijou', 'bijoux', 'jewelry', 'jewellery', 'bracelet', 'collier', 'necklace', 'bague', 'ring'],
  ['montre', 'watch'],
  ['lunettes', 'sunglasses', 'glasses'],
  ['porte cles', 'key ring', 'keyring', 'key holder', 'key case', 'cles'],
  ['cuir', 'leather'],
  ['toile', 'canvas'],
  ['vernis', 'patent', 'enamel'],
  ['daim', 'suede'],
  ['python', 'snake', 'serpent'],
  ['crocodile', 'croco'],
  // Couleurs
  ['noir', 'black'],
  ['blanc', 'white'],
  ['marron', 'brown', 'brun'],
  ['beige', 'cream', 'creme'],
  ['rouge', 'red', 'bordeaux', 'burgundy'],
  ['rose', 'pink'],
  ['bleu', 'blue', 'navy', 'marine'],
  ['vert', 'green', 'khaki', 'kaki'],
  ['jaune', 'yellow'],
  ['orange'],
  ['gris', 'grey', 'gray'],
  ['violet', 'purple'],
  ['dore', 'gold'],
  ['argent', 'silver', 'argente'],
];

export const normalizeText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const compact = (s: string) => s.replace(/ /g, '');

// Phrase normalisée -> toutes les variantes de son (ou ses) groupe(s).
const SYNONYM_INDEX = new Map<string, Set<string>>();
for (const group of SYNONYMS) {
  const normalized = group.map(normalizeText);
  for (const phrase of normalized) {
    const set = SYNONYM_INDEX.get(phrase) || new Set<string>();
    normalized.forEach((p) => set.add(p));
    SYNONYM_INDEX.set(phrase, set);
  }
}
const MAX_PHRASE_WORDS = Math.max(...Array.from(SYNONYM_INDEX.keys()).map((k) => k.split(' ').length));

/** Distance d'édition ≤ 1 (une lettre en trop, en moins ou différente). */
const withinOneEdit = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

export interface PreparedText {
  spaced: string;
  compact: string;
  words: string[];
}

export const prepareText = (text: string): PreparedText => {
  const spaced = ` ${normalizeText(text)} `;
  return { spaced, compact: compact(spaced), words: spaced.trim().split(' ').filter(Boolean) };
};

const variantMatches = (variant: string, text: PreparedText): boolean => {
  // Mot ou expression entière (ou début de mot pour le dernier mot tapé).
  if (text.spaced.includes(` ${variant}`)) return true;
  // Sans espaces : « keypole » ⇄ « key pole ».
  if (variant.length >= 4 && text.compact.includes(compact(variant))) return true;
  // Faute de frappe : chaque mot de la variante (≥ 5 lettres) proche d'un mot du texte.
  const parts = variant.split(' ');
  return parts.every((part) =>
    part.length >= 5
      ? text.words.some((w) => withinOneEdit(part, w) || (w.length > part.length && withinOneEdit(part, w.slice(0, part.length))))
      : text.spaced.includes(` ${part}`)
  );
};

/** Requête découpée en unités : chaque unité = ensemble de variantes acceptées. */
export const parseQuery = (query: string): string[][] => {
  const words = normalizeText(query).split(' ').filter(Boolean);
  const units: string[][] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = Math.min(MAX_PHRASE_WORDS, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(' ');
      const group = SYNONYM_INDEX.get(phrase);
      if (group) {
        units.push(Array.from(group));
        i += n;
        matched = true;
        break;
      }
    }
    if (!matched) {
      units.push([words[i]]);
      i++;
    }
  }
  return units;
};

/** Vrai si chaque unité de la requête est trouvée (dans n'importe quel ordre). */
export const smartMatch = (units: string[][], text: PreparedText): boolean =>
  units.every((variants) => variants.some((v) => variantMatches(v, text)));
