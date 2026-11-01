// The GeoNames extract (milestone M11, In scope 1; plan §6.2): the cities of `place`, from GeoNames
// (https://www.geonames.org/, CC BY 4.0). scripts/geonames-extract.ts reads the official dump files
// (a cities file such as cities1000.txt or allCountries.txt, and optionally alternateNamesV2.txt)
// and writes the compact, committed extract (GEONAMES_EXTRACT_PATH) that `pnpm geo:load` and
// `pnpm db:seed` load. Pure functions: parsing, selection and the extract's own text format.
//
// The English name (`name`, as GeoNames gives it) is the one shown; the alternate names in Chinese
// and Bulgarian (Cyrillic) serve the city search only. With alternateNamesV2.txt the language of
// each name is known (zh, zh-Hant, zh-Hans, yue, bg); with only the `alternatenames` column of a
// cities file it is not, so those names keep their script (Hani, Cyrl) and no language.

/** Where the committed extract lives (read by src/server/geo/places.ts). */
export const GEONAMES_EXTRACT_PATH = 'src/server/geo/data/geonames-places.tsv';

export const GEONAMES_ATTRIBUTION = 'GeoNames (https://www.geonames.org/), licensed under CC BY 4.0';

/**
 * The countries of the extract and the smallest population kept in each (DEFAULT, M11 In scope 1:
 * Bulgaria and the countries of the fictional demo schools of M01). Bulgaria, where the pilot
 * runs, and Hong Kong keep every populated place of 1,000 people or more; the others keep the
 * places of 15,000 or more, so the extract stays small (about 5,500 places). Other countries come
 * after the owner's decision (docs/plan/questions/M11.md).
 */
export const EXTRACT_COUNTRIES: Readonly<Record<string, number>> = {
  BG: 1000,
  GR: 15000,
  DE: 15000,
  GB: 15000,
  US: 15000,
  HK: 1000,
};

/** Populated places that are not a city a school could be in: sections, historical, abandoned, destroyed. */
const EXCLUDED_FEATURE_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
/** Alternate names per script and place: the search needs a few spellings, not every one. */
export const MAX_ALT_NAMES_PER_SCRIPT = 4;
/** The languages taken from alternateNamesV2.txt. */
const ALT_LANGUAGES = new Set(['zh', 'zh-Hant', 'zh-Hans', 'zh-TW', 'zh-CN', 'zh-HK', 'yue', 'bg']);

const HAN = /\p{Script=Han}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
/** Kana or Hangul: a Japanese or Korean name, not Chinese. */
const KANA_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_OR_DIGIT = /[\p{Script=Latin}0-9]/u;

export interface AltName {
  value: string;
  /** ISO 15924: Hani or Cyrl. */
  script: 'Hani' | 'Cyrl';
  /** ISO 639 (with a region or script) when the source names it, null otherwise. */
  lang: string | null;
}

export interface GeoNamesPlace {
  geonamesId: number;
  name: string;
  asciiName: string;
  lat: number;
  lng: number;
  featureCode: string;
  countryCode: string;
  admin1Code: string | null;
  population: number;
  timezone: string | null;
  alternateNames: AltName[];
}

/** One row of a GeoNames cities or allCountries file (19 tab-separated columns), or null. */
export interface CitiesRow extends Omit<GeoNamesPlace, 'alternateNames'> {
  featureClass: string;
  /** The `alternatenames` column: every name, without a language. */
  alternateNamesColumn: string;
}

export function parseCitiesLine(line: string): CitiesRow | null {
  const c = line.split('\t');
  if (c.length < 19) return null;
  const geonamesId = Number(c[0]);
  const lat = Number(c[4]);
  const lng = Number(c[5]);
  const population = Number(c[14] || '0');
  if (!Number.isInteger(geonamesId) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    geonamesId,
    name: c[1]!,
    asciiName: c[2]!,
    alternateNamesColumn: c[3]!,
    lat,
    lng,
    featureClass: c[6]!,
    featureCode: c[7]!,
    countryCode: c[8]!,
    admin1Code: c[10] || null,
    population: Number.isFinite(population) ? population : 0,
    timezone: c[17] || null,
  };
}

/** Whether a row of the dump belongs in the extract: a populated place of a listed country above its floor. */
export function inExtract(row: CitiesRow): boolean {
  const floor = EXTRACT_COUNTRIES[row.countryCode];
  if (floor === undefined) return false;
  if (row.featureClass !== 'P' || EXCLUDED_FEATURE_CODES.has(row.featureCode)) return false;
  return row.population >= floor;
}

/** A name fit for the extract's one-line format: no tabs, pipes or line breaks, trimmed. */
export function cleanName(value: string): string {
  return value.replace(/[\t\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function scriptOf(value: string): AltName['script'] | null {
  if (LATIN_OR_DIGIT.test(value) || KANA_HANGUL.test(value)) return null;
  if (HAN.test(value) && !CYRILLIC.test(value)) return 'Hani';
  if (CYRILLIC.test(value) && !HAN.test(value)) return 'Cyrl';
  return null;
}

/** Keeps at most MAX_ALT_NAMES_PER_SCRIPT distinct names of each script, in the order given. */
export function capAltNames(names: readonly AltName[]): AltName[] {
  const out: AltName[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const value = cleanName(n.value);
    if (!value || seen.has(value)) continue;
    if (out.filter((o) => o.script === n.script).length >= MAX_ALT_NAMES_PER_SCRIPT) continue;
    seen.add(value);
    out.push({ ...n, value });
  }
  return out;
}

/** The Chinese and Cyrillic names of the `alternatenames` column (no language known). */
export function altNamesFromColumn(column: string): AltName[] {
  const names: AltName[] = [];
  for (const raw of column.split(',')) {
    const value = cleanName(raw);
    const script = value ? scriptOf(value) : null;
    if (script) names.push({ value, script, lang: null });
  }
  return capAltNames(names);
}

/** One row of alternateNamesV2.txt that the extract keeps (a Chinese or Bulgarian name), or null. */
export interface AlternateNameRow {
  geonamesId: number;
  name: AltName;
  preferred: boolean;
}

export function parseAlternateNameLine(line: string): AlternateNameRow | null {
  // alternateNameId, geonameid, isolanguage, alternate name, isPreferredName, isShortName,
  // isColloquial, isHistoric, from, to
  const c = line.split('\t');
  if (c.length < 8) return null;
  const lang = c[2]!;
  if (!ALT_LANGUAGES.has(lang) || c[6] === '1' || c[7] === '1') return null;
  const value = cleanName(c[3]!);
  const script = value ? scriptOf(value) : null;
  const geonamesId = Number(c[1]);
  if (!script || !Number.isInteger(geonamesId)) return null;
  return { geonamesId, name: { value, script, lang }, preferred: c[4] === '1' };
}

/** A place of the extract from a dump row and, when known, its alternate names with languages. */
export function placeFromRow(row: CitiesRow, alternates?: readonly AlternateNameRow[]): GeoNamesPlace {
  const alternateNames = alternates
    ? capAltNames([...alternates].sort((a, b) => Number(b.preferred) - Number(a.preferred)).map((a) => a.name))
    : altNamesFromColumn(row.alternateNamesColumn);
  return {
    geonamesId: row.geonamesId,
    name: cleanName(row.name),
    asciiName: cleanName(row.asciiName),
    lat: row.lat,
    lng: row.lng,
    featureCode: row.featureCode,
    countryCode: row.countryCode,
    admin1Code: row.admin1Code,
    population: row.population,
    timezone: row.timezone,
    alternateNames,
  };
}

// --- The extract's own format --------------------------------------------------------------------
// UTF-8 text: `#` comment lines (source and licence), one header line, then one tab-separated line
// per place, sorted by country and GeoNames id so a regenerated extract diffs cleanly. Alternate
// names: `script:lang:value` joined by `|`, with an empty lang when the source gives none.

export const EXTRACT_COLUMNS = [
  'geonameid',
  'name',
  'asciiname',
  'latitude',
  'longitude',
  'feature_code',
  'country_code',
  'admin1_code',
  'population',
  'timezone',
  'alternate_names',
] as const;

export function sortPlaces(places: readonly GeoNamesPlace[]): GeoNamesPlace[] {
  return [...places].sort((a, b) => (a.countryCode === b.countryCode ? a.geonamesId - b.geonamesId : a.countryCode < b.countryCode ? -1 : 1));
}

export function serializeExtract(places: readonly GeoNamesPlace[], source: string): string {
  const lines = [
    `# ${GEONAMES_ATTRIBUTION}. Changes: populated places of ${Object.keys(EXTRACT_COUNTRIES).join(', ')} above a population floor, Chinese and Cyrillic alternate names only.`,
    `# Source: ${cleanName(source)}`,
    `# Written by scripts/geonames-extract.ts (pnpm geo:extract); loaded by pnpm geo:load and pnpm db:seed.`,
    EXTRACT_COLUMNS.join('\t'),
  ];
  for (const p of sortPlaces(places)) {
    lines.push(
      [
        p.geonamesId,
        p.name,
        p.asciiName,
        p.lat,
        p.lng,
        p.featureCode,
        p.countryCode,
        p.admin1Code ?? '',
        p.population,
        p.timezone ?? '',
        p.alternateNames.map((n) => `${n.script}:${n.lang ?? ''}:${n.value}`).join('|'),
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function parseExtract(text: string): GeoNamesPlace[] {
  const places: GeoNamesPlace[] = [];
  let header = false;
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    if (!header) {
      if (line !== EXTRACT_COLUMNS.join('\t')) throw new Error('geonames extract: unexpected header line');
      header = true;
      continue;
    }
    const c = line.split('\t');
    if (c.length !== EXTRACT_COLUMNS.length) throw new Error(`geonames extract: ${c.length} columns in a line, expected ${EXTRACT_COLUMNS.length}`);
    places.push({
      geonamesId: Number(c[0]),
      name: c[1]!,
      asciiName: c[2]!,
      lat: Number(c[3]),
      lng: Number(c[4]),
      featureCode: c[5]!,
      countryCode: c[6]!,
      admin1Code: c[7] || null,
      population: Number(c[8]),
      timezone: c[9] || null,
      alternateNames: c[10]
        ? c[10].split('|').map((part) => {
            const [script, lang, ...rest] = part.split(':');
            return { script: script as AltName['script'], lang: lang || null, value: rest.join(':') };
          })
        : [],
    });
  }
  if (!header) throw new Error('geonames extract: no header line');
  return places;
}
