// Hong Kong spellings of Cantonese syllables (milestone M07, In scope 2): many people write their
// name the way the Hong Kong government registry spelled it ("Cheung", "Kwok", "Tse"), not in
// Jyutping ("zoeng", "gwok", "ze"). Search therefore also keys a Jyutping name by its Hong Kong
// spelling, so "Cheung" finds a name stored as Jyutping or in Chinese characters.
//
// Two layers: a rule table that maps Jyutping initials and finals to the usual Hong Kong letters,
// and hand-kept rows (ALIAS_ROWS) for the spellings the rules miss. Each row names its source; the
// rows are romanization conventions, not data about any person. docs/search.md lists the limits.

export interface AliasRow {
  /** A toneless Jyutping syllable. */
  jyutping: string;
  /** Its Hong Kong spellings, lower case, the most common first. */
  spellings: readonly string[];
  /** Where the spelling comes from. */
  source: string;
}

const HK_SURNAMES = 'Hong Kong government romanization, common surname spellings';

/** Hand-kept spellings that the rules below do not produce, or produce only as a second choice. */
export const ALIAS_ROWS: readonly AliasRow[] = [
  { jyutping: 'zoeng', spellings: ['cheung', 'cheong'], source: HK_SURNAMES },
  { jyutping: 'coeng', spellings: ['cheung', 'cheong'], source: HK_SURNAMES },
  { jyutping: 'can', spellings: ['chan'], source: HK_SURNAMES },
  { jyutping: 'lei', spellings: ['lee', 'li'], source: HK_SURNAMES },
  { jyutping: 'ze', spellings: ['tse', 'che'], source: HK_SURNAMES },
  { jyutping: 'zeng', spellings: ['cheng', 'ching'], source: HK_SURNAMES },
  { jyutping: 'gwok', spellings: ['kwok'], source: HK_SURNAMES },
  { jyutping: 'lou', spellings: ['lo', 'lou'], source: HK_SURNAMES },
  { jyutping: 'lo', spellings: ['law', 'lo'], source: HK_SURNAMES },
  { jyutping: 'sou', spellings: ['so'], source: HK_SURNAMES },
  { jyutping: 'jip', spellings: ['yip'], source: HK_SURNAMES },
  { jyutping: 'jau', spellings: ['yau'], source: HK_SURNAMES },
  { jyutping: 'jyun', spellings: ['yuen'], source: HK_SURNAMES },
  { jyutping: 'zau', spellings: ['chau', 'chow'], source: HK_SURNAMES },
  { jyutping: 'ceoi', spellings: ['chui', 'tsui'], source: HK_SURNAMES },
  { jyutping: 'zeoi', spellings: ['chui', 'tsui'], source: HK_SURNAMES },
  { jyutping: 'ho', spellings: ['ho'], source: HK_SURNAMES },
  { jyutping: 'ng', spellings: ['ng'], source: HK_SURNAMES },
  { jyutping: 'wong', spellings: ['wong'], source: HK_SURNAMES },
  { jyutping: 'fung', spellings: ['fung'], source: HK_SURNAMES },
  { jyutping: 'mak', spellings: ['mak'], source: HK_SURNAMES },
];

const ROWS = new Map(ALIAS_ROWS.map((row) => [row.jyutping, row]));

// Jyutping initials → Hong Kong letters (longest first). z and c are both "ch" in most names.
const INITIALS: readonly (readonly [string, string])[] = [
  ['gw', 'kw'], ['kw', 'kw'], ['ng', 'ng'],
  ['b', 'p'], ['p', 'p'], ['m', 'm'], ['f', 'f'], ['d', 't'], ['t', 't'], ['n', 'n'], ['l', 'l'],
  ['g', 'k'], ['k', 'k'], ['h', 'h'], ['w', 'w'], ['z', 'ch'], ['c', 'ch'], ['s', 's'], ['j', 'y'],
];

// Jyutping finals → Hong Kong letters.
const FINALS: Readonly<Record<string, string>> = {
  aa: 'a', aai: 'ai', aau: 'au', aam: 'am', aan: 'an', aang: 'ang', aap: 'ap', aat: 'at', aak: 'ak',
  ai: 'ai', au: 'au', am: 'am', an: 'an', ang: 'ang', ap: 'ap', at: 'at', ak: 'ak',
  e: 'e', ei: 'ei', eu: 'eu', em: 'em', eng: 'eng', ep: 'ep', ek: 'ek',
  i: 'i', iu: 'iu', im: 'im', in: 'in', ing: 'ing', ip: 'ip', it: 'it', ik: 'ik',
  o: 'o', oi: 'oi', ou: 'o', on: 'on', ong: 'ong', ot: 'ot', ok: 'ok',
  u: 'oo', ui: 'ui', un: 'oon', ung: 'ung', ut: 'oot', uk: 'uk',
  oe: 'oe', oeng: 'eung', oek: 'euk', eoi: 'ui', eon: 'un', eot: 'ut',
  yu: 'ue', yun: 'uen', yut: 'uet', m: 'm', ng: 'ng',
};

/** The Hong Kong spellings of one toneless Jyutping syllable, the most common first; [] if unknown. */
export function hongKongSpellings(syllable: string): string[] {
  const row = ROWS.get(syllable);
  const ruled = ruleSpelling(syllable);
  const all = [...(row?.spellings ?? []), ...(ruled ? [ruled] : [])];
  return [...new Set(all)];
}

function ruleSpelling(syllable: string): string | null {
  // A syllable that is only a nasal ("m", "ng") is written as it is.
  if (syllable === 'm' || syllable === 'ng') return syllable;
  for (const [initial, letters] of INITIALS) {
    const final = syllable.startsWith(initial) ? FINALS[syllable.slice(initial.length)] : undefined;
    if (final) return `${letters}${final}`;
  }
  return FINALS[syllable] ?? null;
}
