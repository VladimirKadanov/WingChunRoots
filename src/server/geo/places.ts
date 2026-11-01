// The cities of `place` (milestone M11, In scope 1; plan §6.2): loading the committed GeoNames
// extract (./geonames.ts) and the city search of the school form. The English name is shown; the
// alternate names (Chinese and Bulgarian, where GeoNames has them) only make a city findable:
// `search_text` holds every name of the place folded the way the people search folds a query
// (queryForms, src/server/search/keys.ts), one per line, under a trigram index.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { Executor } from '../entitlements/access';
import { queryForms } from '../search/keys';
import { GEONAMES_EXTRACT_PATH, type GeoNamesPlace, parseExtract } from './geonames';

/** Places written per INSERT. */
const CHUNK = 500;

/**
 * A place's id, derived from its GeoNames id (a version 8 UUID from SHA-256), so loading the
 * extract twice, or on another machine, gives the same ids (db:seed's content hash; a dump moved
 * between databases).
 */
export function placeIdFor(geonamesId: number): string {
  const bytes = createHash('sha256').update(`wingchunroots:geonames:${geonamesId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Every folded form of every name of a place, one per line (the column search_text). */
export function placeSearchText(place: Pick<GeoNamesPlace, 'name' | 'asciiName' | 'alternateNames'>): string {
  const forms = new Set<string>();
  for (const name of [place.name, place.asciiName, ...place.alternateNames.map((n) => n.value)]) {
    for (const form of queryForms(name)) forms.add(form.text);
  }
  return [...forms].join('\n');
}

/** The committed extract, parsed. `root` is the repository (the working directory by default). */
export function readExtract(root: string = process.cwd()): GeoNamesPlace[] {
  return parseExtract(readFileSync(path.join(root, GEONAMES_EXTRACT_PATH), 'utf8'));
}

export interface LoadResult {
  places: number;
  written: number;
}

/**
 * Writes the places into `place`: new ones are inserted with the id of placeIdFor(), existing
 * ones (by GeoNames id) are updated where anything differs. A corrected centroid moves the
 * city_only schools of that city with it (the trigger place_centroid_to_city_only_schools).
 * `at` is the time written into created_at and updated_at (db:seed passes a fixed one).
 */
export async function loadPlaces(db: Executor | NodePgDatabase, places: readonly GeoNamesPlace[], at: Date = new Date()): Promise<LoadResult> {
  let written = 0;
  for (let i = 0; i < places.length; i += CHUNK) {
    const chunk = places.slice(i, i + CHUNK);
    const rows = chunk.map(
      (p) =>
        sql`(${placeIdFor(p.geonamesId)}::uuid, ${p.geonamesId}::int, ${p.name}, ${p.asciiName}, ${p.countryCode}, ${p.admin1Code}, ${p.featureCode},
             ${p.population}::int, ${p.timezone}, ${`SRID=4326;POINT(${p.lng} ${p.lat})`}::geography,
             ${JSON.stringify(p.alternateNames)}::jsonb, ${placeSearchText(p)}, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)`,
    );
    const result = await db.execute(sql`
      INSERT INTO place AS p (id, geonames_id, name, ascii_name, country_code, admin1_code, feature_code, population, timezone, centroid,
                              alternate_names, search_text, created_at, updated_at)
      VALUES ${sql.join(rows, sql`, `)}
      ON CONFLICT (geonames_id) DO UPDATE SET
        name = EXCLUDED.name, ascii_name = EXCLUDED.ascii_name, country_code = EXCLUDED.country_code,
        admin1_code = EXCLUDED.admin1_code, feature_code = EXCLUDED.feature_code, population = EXCLUDED.population,
        timezone = EXCLUDED.timezone, centroid = EXCLUDED.centroid, alternate_names = EXCLUDED.alternate_names,
        search_text = EXCLUDED.search_text, updated_at = EXCLUDED.updated_at
      WHERE (p.name, p.ascii_name, p.country_code, p.admin1_code, p.feature_code, p.population, p.timezone,
             ST_AsText(p.centroid::geometry), p.alternate_names, p.search_text)
            IS DISTINCT FROM
            (EXCLUDED.name, EXCLUDED.ascii_name, EXCLUDED.country_code, EXCLUDED.admin1_code, EXCLUDED.feature_code,
             EXCLUDED.population, EXCLUDED.timezone, ST_AsText(EXCLUDED.centroid::geometry), EXCLUDED.alternate_names, EXCLUDED.search_text)`);
    written += result.rowCount ?? 0;
  }
  return { places: places.length, written };
}

export interface PlaceHit {
  id: string;
  name: string;
  countryCode: string;
}

export const PLACE_SEARCH_LIMIT = 8;

/** LIKE pattern text: the folded forms carry no wildcard, but the escape keeps it so. */
const likeText = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Cities whose name, in any of its spellings, matches the query: a whole name first, then the
 * start of a name, then anywhere in a name; the larger city first within each. Optional country.
 */
export async function searchPlaces(db: Executor, query: string, countryCode: string | null = null, limit = PLACE_SEARCH_LIMIT): Promise<PlaceHit[]> {
  const forms = queryForms(query).map((f) => f.text).filter((t) => t.length > 0);
  if (forms.length === 0) return [];
  const score = sql.join(
    forms.map(
      (f) => sql`CASE
        WHEN (E'\n' || p.search_text || E'\n') LIKE ${`%\n${likeText(f)}\n%`} THEN 3
        WHEN (E'\n' || p.search_text) LIKE ${`%\n${likeText(f)}%`} THEN 2
        WHEN p.search_text LIKE ${`%${likeText(f)}%`} THEN 1
        ELSE 0 END`,
    ),
    sql`, `,
  );
  const result = await db.execute<{ id: string; name: string; country_code: string }>(sql`
    SELECT p.id, p.name, p.country_code
      FROM place p, LATERAL (SELECT greatest(${score}) AS rank) r
     WHERE (${sql.join(forms.map((f) => sql`p.search_text LIKE ${`%${likeText(f)}%`}`), sql` OR `)})
       AND r.rank > 0 AND (${countryCode}::text IS NULL OR p.country_code = ${countryCode})
     ORDER BY r.rank DESC, p.population DESC NULLS LAST, p.name, p.id
     LIMIT ${limit}`);
  return result.rows.map((r) => ({ id: r.id, name: r.name, countryCode: r.country_code }));
}

/**
 * The smallest city the onboarding and profile city lists show. The extract holds over 5,000
 * cities; a select of all of them is unusable on a phone, so those lists show the large cities
 * and the person's own city (questions/M11.md, question 3). Schools pick any city by search.
 */
export const LISTED_PLACE_MIN_POPULATION = 300_000;

/** The cities of the onboarding and profile lists: the large ones, plus `currentPlaceId` if set. */
export async function listedPlaces(db: Executor, currentPlaceId: string | null = null): Promise<PlaceHit[]> {
  const result = await db.execute<{ id: string; name: string; country_code: string }>(sql`
    SELECT p.id, p.name, p.country_code
      FROM place p
     WHERE p.population >= ${LISTED_PLACE_MIN_POPULATION} OR p.id = ${currentPlaceId}::uuid
     ORDER BY p.country_code, p.name, p.id`);
  return result.rows.map((r) => ({ id: r.id, name: r.name, countryCode: r.country_code }));
}
