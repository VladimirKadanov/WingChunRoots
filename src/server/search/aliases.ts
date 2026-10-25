// Hong Kong spellings of Cantonese syllables (milestone M07, In scope 2): many people write their
// name the way the Hong Kong government registry spelled it ("Cheung", "Kwok", "Tse"), not in
// Jyutping ("zoeng", "gwok", "ze"). Search therefore also keys a Jyutping name by its Hong Kong
// spelling, so "Cheung" finds a name stored as Jyutping or in Chinese characters.
//
// Two layers: a rule table that maps Jyutping initials and finals to the usual Hong Kong letters,
// and hand-kept rows (ALIAS_ROWS) for the spellings the rules miss. Each row names its source; the
// rows are romanization conventions, not data about any person. docs/search.md lists the limits.
//
// A third table, SURNAME_READINGS, gives the Cantonese reading of surnames that to-jyutping reads
// by their everyday reading (曾 is zang1 as a surname, "Tsang"; to-jyutping says cang4).

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
  // The surname readings of SURNAME_READINGS below.
  { jyutping: 'zang', spellings: ['tsang', 'chang'], source: HK_SURNAMES },
  { jyutping: 'au', spellings: ['au', 'ou'], source: HK_SURNAMES },
  { jyutping: 'sin', spellings: ['sin', 'shin'], source: HK_SURNAMES },
];

/** Where the surname readings come from (the `source` of their keys is alias:surname-reading). */
export const SURNAME_READINGS_SOURCE = 'Cantonese surname readings (Jyutping), where to-jyutping gives the everyday reading first';

/**
 * Surnames that Cantonese reads differently from the same character in other words, which
 * to-jyutping reads by its first (everyday) reading: 曾 is zang1 as a surname ("Tsang"), not cang4.
 * Keyed by the characters a Chinese name starts with (Traditional and Simplified), with the toned
 * Jyutping of each character; every reading is one of to-jyutping's own candidates (keys.test.ts).
 */
export const SURNAME_READINGS: Readonly<Record<string, readonly string[]>> = {
  曾: ['zang1'],
  區: ['au1'],
  区: ['au1'],
  單: ['sin6'],
  单: ['sin6'],
  解: ['haai6'],
  翟: ['zaak6'],
  繆: ['miu6'],
  缪: ['miu6'],
  仇: ['kau4'],
  長孫: ['coeng4', 'syun1'],
  长孙: ['coeng4', 'syun1'],
  尉遲: ['wat1', 'ci4'],
  尉迟: ['wat1', 'ci4'],
};

/** The surname at the start of a Chinese name and its Jyutping, or null when SURNAME_READINGS has none. */
export function surnameReading(han: string): { surname: string; jyutping: readonly string[] } | null {
  const chars = [...han];
  for (const length of [2, 1]) {
    const surname = chars.slice(0, length).join('');
    const jyutping = chars.length > length ? SURNAME_READINGS[surname] : undefined;
    if (jyutping) return { surname, jyutping };
  }
  return null;
}

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
