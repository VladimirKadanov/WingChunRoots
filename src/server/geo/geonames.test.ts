// The GeoNames extract (M11, In scope 1): the parser of the official dump, the extract's own
// format and the committed extract itself.

import { describe, expect, it } from 'vitest';

import {
  altNamesFromColumn,
  capAltNames,
  EXTRACT_COLUMNS,
  EXTRACT_COUNTRIES,
  GEONAMES_ATTRIBUTION,
  type GeoNamesPlace,
  inExtract,
  MAX_ALT_NAMES_PER_SCRIPT,
  parseAlternateNameLine,
  parseCitiesLine,
  parseExtract,
  placeFromRow,
  serializeExtract,
} from './geonames';
import { placeIdFor, placeSearchText, readExtract } from './places';

/** A line of the official cities file: 19 tab-separated columns. */
function citiesLine(over: Partial<Record<number, string>> = {}): string {
  const cols = [
    '727011', 'Sofia', 'Sofia', 'Sofiya,Sofia,София,索菲亞,ソフィア', '42.69751', '23.32415', 'P', 'PPLC', 'BG', '',
    '42', '', '', '', '1152556', '', '550', 'Europe/Sofia', '2019-09-05',
  ];
  for (const [i, v] of Object.entries(over)) cols[Number(i)] = v!;
  return cols.join('\t');
}

describe('parseCitiesLine and inExtract', () => {
  it('reads the 19 columns of the official format', () => {
    const row = parseCitiesLine(citiesLine());
    expect(row).toMatchObject({
      geonamesId: 727011,
      name: 'Sofia',
      lat: 42.69751,
      lng: 23.32415,
      featureClass: 'P',
      featureCode: 'PPLC',
      countryCode: 'BG',
      admin1Code: '42',
      population: 1152556,
      timezone: 'Europe/Sofia',
    });
  });

  it('refuses a short or malformed line', () => {
    expect(parseCitiesLine('727011\tSofia')).toBeNull();
    expect(parseCitiesLine(citiesLine({ 4: 'north' }))).toBeNull();
  });

  it('keeps populated places of the listed countries above their floor only', () => {
    expect(inExtract(parseCitiesLine(citiesLine())!)).toBe(true);
    expect(inExtract(parseCitiesLine(citiesLine({ 8: 'FR' }))!)).toBe(false);
    expect(inExtract(parseCitiesLine(citiesLine({ 6: 'A', 7: 'ADM1' }))!)).toBe(false);
    expect(inExtract(parseCitiesLine(citiesLine({ 7: 'PPLX' }))!)).toBe(false);
    expect(inExtract(parseCitiesLine(citiesLine({ 8: 'GR', 14: String(EXTRACT_COUNTRIES.GR! - 1) }))!)).toBe(false);
    expect(inExtract(parseCitiesLine(citiesLine({ 8: 'GR', 14: String(EXTRACT_COUNTRIES.GR!) }))!)).toBe(true);
  });
});

describe('alternate names', () => {
  it('keeps the Chinese and Cyrillic names of the column, not Latin, Japanese or Korean ones', () => {
    expect(altNamesFromColumn('Sofiya,Sofia,София,索菲亞,ソフィア,소피아')).toEqual([
      { value: 'София', script: 'Cyrl', lang: null },
      { value: '索菲亞', script: 'Hani', lang: null },
    ]);
  });

  it('keeps at most four distinct names of each script, cleaned', () => {
    const many = ['甲', '乙', '丙', '丁', '戊'].map((value) => ({ value, script: 'Hani' as const, lang: 'zh' }));
    const capped = capAltNames([...many, { value: ' Со\tфия ', script: 'Cyrl', lang: 'bg' }, { value: '甲', script: 'Hani', lang: null }]);
    expect(capped.filter((n) => n.script === 'Hani')).toHaveLength(MAX_ALT_NAMES_PER_SCRIPT);
    expect(capped.find((n) => n.script === 'Cyrl')?.value).toBe('Со фия');
  });

  it('reads a Chinese or Bulgarian row of alternateNamesV2 and skips colloquial, historic and other languages', () => {
    expect(parseAlternateNameLine('1\t727011\tbg\tСофия\t1\t\t\t\t\t')).toEqual({
      geonamesId: 727011,
      name: { value: 'София', script: 'Cyrl', lang: 'bg' },
      preferred: true,
    });
    expect(parseAlternateNameLine('2\t727011\tzh-Hant\t索菲亞\t\t\t\t\t\t')?.name).toEqual({ value: '索菲亞', script: 'Hani', lang: 'zh-Hant' });
    expect(parseAlternateNameLine('3\t727011\tru\tСофия\t\t\t\t\t\t')).toBeNull();
    expect(parseAlternateNameLine('4\t727011\tbg\tСредец\t\t\t\t1\t\t')).toBeNull();
    expect(parseAlternateNameLine('5\t727011\tbg\tСофийско\t\t\t1\t\t\t')).toBeNull();
    expect(parseAlternateNameLine('6\t727011\tbg\tSofia\t\t\t\t\t\t')).toBeNull();
  });

  it('puts preferred names first when the languages are known', () => {
    const row = parseCitiesLine(citiesLine())!;
    const place = placeFromRow(row, [
      { geonamesId: 727011, name: { value: '索菲亚', script: 'Hani', lang: 'zh-Hans' }, preferred: false },
      { geonamesId: 727011, name: { value: '索菲亞', script: 'Hani', lang: 'zh-Hant' }, preferred: true },
    ]);
    expect(place.alternateNames.map((n) => n.value)).toEqual(['索菲亞', '索菲亚']);
  });
});

describe('the extract format', () => {
  const places: GeoNamesPlace[] = [
    { ...placeFromRow(parseCitiesLine(citiesLine())!), alternateNames: [{ value: 'София', script: 'Cyrl', lang: 'bg' }, { value: '索菲亞', script: 'Hani', lang: null }] },
    placeFromRow(parseCitiesLine(citiesLine({ 0: '1819609', 1: 'Kowloon', 2: 'Kowloon', 3: '九龍', 8: 'HK', 10: '', 17: '' }))!),
  ];

  it('round-trips through serializeExtract and parseExtract, with the licence in the header', () => {
    const text = serializeExtract(places, 'a test dump');
    expect(text.split('\n')[0]).toContain(GEONAMES_ATTRIBUTION);
    expect(text).toContain('# Source: a test dump');
    const back = parseExtract(text);
    expect(back.map((p) => p.countryCode)).toEqual(['BG', 'HK']);
    expect(back).toEqual(expect.arrayContaining(places));
    expect(back.find((p) => p.geonamesId === 1819609)).toMatchObject({ admin1Code: null, timezone: null });
  });

  it('refuses an unknown header or a short line', () => {
    expect(() => parseExtract('name\tid\n')).toThrow(/header/);
    expect(() => parseExtract(`${EXTRACT_COLUMNS.join('\t')}\n1\tx\n`)).toThrow(/columns/);
  });
});

describe('the committed extract', () => {
  const extract = readExtract();

  it('holds every listed country, each place once, with a licence header', () => {
    const counts = new Map<string, number>();
    for (const p of extract) counts.set(p.countryCode, (counts.get(p.countryCode) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(Object.keys(EXTRACT_COUNTRIES).sort());
    expect(new Set(extract.map((p) => p.geonamesId)).size).toBe(extract.length);
    for (const p of extract) {
      expect(p.population).toBeGreaterThanOrEqual(EXTRACT_COUNTRIES[p.countryCode]!);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lng)).toBeLessThanOrEqual(180);
    }
  });

  it('finds a city by its Cyrillic and Chinese names', () => {
    const sofia = extract.find((p) => p.geonamesId === 727011)!;
    expect(sofia.name).toBe('Sofia');
    const text = placeSearchText(sofia).split('\n');
    expect(text).toContain('sofia');
    expect(text).toContain('софия');
    // Han names are folded to Simplified, as the people search folds a query.
    expect(text).toContain('索菲亚');
  });
});

describe('placeIdFor', () => {
  it('gives the same version 8 UUID for the same GeoNames id, and different ones for others', () => {
    expect(placeIdFor(727011)).toBe(placeIdFor(727011));
    expect(placeIdFor(727011)).not.toBe(placeIdFor(728193));
    expect(placeIdFor(727011)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
