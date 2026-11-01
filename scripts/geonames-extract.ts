// pnpm geo:extract --cities <cities1000.txt|allCountries.txt> [--alternate-names <alternateNamesV2.txt>]
//                  [--source "<what and when>"] [--out src/server/geo/data/geonames-places.tsv]
//
// Writes the committed GeoNames extract of `place` (milestone M11, In scope 1) from the official
// GeoNames dump files, which the owner downloads from https://download.geonames.org/export/dump/
// (cities1000.zip or allCountries.zip, and alternateNamesV2.zip for the languages of the alternate
// names). The countries and their population floors are in src/server/geo/geonames.ts. Both files
// are read line by line, so allCountries.txt (about 1.6 GB) works as well as cities1000.txt.
// Deterministic: the same input files give the same extract.

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  type AlternateNameRow,
  type CitiesRow,
  GEONAMES_EXTRACT_PATH,
  inExtract,
  parseAlternateNameLine,
  parseCitiesLine,
  placeFromRow,
  serializeExtract,
} from '../src/server/geo/geonames';

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function* lines(file: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cities = option(args, '--cities');
  if (!cities) {
    console.error('usage: pnpm geo:extract --cities <cities1000.txt|allCountries.txt> [--alternate-names <alternateNamesV2.txt>] [--source "<text>"] [--out <file>]');
    process.exit(2);
  }
  const alternateNames = option(args, '--alternate-names');
  const out = option(args, '--out') ?? GEONAMES_EXTRACT_PATH;

  const rows: CitiesRow[] = [];
  let latest = '';
  for await (const line of lines(cities)) {
    const row = parseCitiesLine(line);
    if (row && inExtract(row)) {
      rows.push(row);
      const modified = line.split('\t')[18] ?? '';
      if (modified > latest) latest = modified;
    }
  }
  let alternates: Map<number, AlternateNameRow[]> | null = null;
  if (alternateNames) {
    const wanted = new Set(rows.map((r) => r.geonamesId));
    alternates = new Map();
    for await (const line of lines(alternateNames)) {
      const alt = parseAlternateNameLine(line);
      if (!alt || !wanted.has(alt.geonamesId)) continue;
      const list = alternates.get(alt.geonamesId) ?? [];
      list.push(alt);
      alternates.set(alt.geonamesId, list);
    }
  }
  const places = rows.map((row) => placeFromRow(row, alternates ? (alternates.get(row.geonamesId) ?? []) : undefined));
  const source =
    option(args, '--source') ??
    `${cities.split(/[\\/]/).pop()}${alternateNames ? ` and ${alternateNames.split(/[\\/]/).pop()}` : ' (alternate names from its alternatenames column, without languages)'}, rows modified up to ${latest || 'unknown'}`;
  writeFileSync(out, serializeExtract(places, source));
  const byCountry = new Map<string, number>();
  for (const p of places) byCountry.set(p.countryCode, (byCountry.get(p.countryCode) ?? 0) + 1);
  console.log(`geo:extract: ${places.length} places written to ${out} (${[...byCountry].map(([c, n]) => `${c} ${n}`).join(', ')})`);
}

main().catch((error: unknown) => {
  console.error(`geo:extract: ${(error as Error).message}`);
  process.exit(1);
});
