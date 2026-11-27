// The search query (milestone M07, In scope 3; docs/search.md): people by their keys
// (person_name_key) and schools and lineages by their names, with trigram similarity
// (pg_trgm `%`), word similarity (`<%`), a prefix match and, for Chinese characters, an exact or
// contained match, since a two- or three-character name gives too few trigrams to rank by.
//
// Privacy (plan §6.4): the keys come only through v_public_person_key (the keys of public people;
// migration m07_public_person_key), every person through v_public_person, every school through
// v_public_school, every organization through v_public_organization (approved ones only; ADR 0051)
// and every lineage through v_public_edge, so a record that is not public cannot
// match, whatever its keys say. The keys themselves never leave this file: a person is answered
// with its display name and the stored name (person_name) whose key matched.

import { sql } from 'drizzle-orm';

import type { Executor } from '../entitlements/access';
import type { EventHitDto, LineageHitDto, OrganizationHitDto, PersonHitDto, PlaceHitDto, SchoolHitDto, SearchNameDto } from '../dto/search';
import type { QueryForm } from './keys';

/** pg_trgm `%`: trigram similarity of a whole key (docs/search.md). */
export const SIMILARITY_THRESHOLD = 0.3;
/** pg_trgm `<%`: the query matches a word span of a key ("testov" in "ivan testov"). */
export const WORD_SIMILARITY_THRESHOLD = 0.5;
/** Trigram matching needs at least this many characters; shorter queries match by prefix only. */
export const MIN_TRIGRAM_LENGTH = 3;

/**
 * Ranking: an exact key, then a prefix of the whole key, then a prefix of a later word ("ng" in
 * "siu ming ng") or, for Chinese characters, one inside the other, then similarity (0..1); a primary
 * name and a verified person rank higher.
 */
export const RANK = { exact: 3, prefix: 2, wordPrefix: 1.5, hanContains: 1.5, primary: 0.15, verified: 0.1, asWritten: 0.01 } as const;

/** At most this many results per group: a common surname (13 demo "Testov"s) still fits in one answer. */
export const LIMITS = { people: 20, schools: 5, events: 5, organizations: 5, lineages: 5 } as const;

/** Role replay 2026-11-25 (P2-5): a school or an event in the city the query names, under an exact or prefix name. */
export const CITY_RANK = 2.5;

export interface SearchFilters {
  countryCode: string | null;
  lineageId: string | null;
}

/** The people of an answer, and whether more matched than LIMITS.people. */
export interface PeopleHits {
  people: PersonHitDto[];
  more: boolean;
}

/** A constant of this file in the SQL text (a bound parameter would be typed as an integer). */
const num = (n: number) => sql.raw(String(n));

/** `text%` for LIKE, with the LIKE wildcards in the text escaped. */
function prefixPattern(text: string): string {
  return `${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * The query forms as a table f(text, han, prefix, word_prefix): one bound row each, never text in
 * the SQL. `word_prefix` matches the form at the start of any word after the first (`% text%`
 * against ' ' || key).
 */
function formsTable(forms: readonly QueryForm[]) {
  const rows = forms.map((f) => sql`(${f.text}::text, ${f.han}::boolean, ${prefixPattern(f.text)}::text, ${`% ${prefixPattern(f.text)}`}::text)`);
  return sql`SELECT * FROM (VALUES ${sql.join(rows, sql`, `)}) AS f(text, han, prefix, word_prefix)`;
}

/** A read-only transaction with the pg_trgm thresholds of the search (first statement of the transaction). */
export async function setThresholds(tx: Executor): Promise<void> {
  await tx.execute(sql`SET TRANSACTION READ ONLY`);
  await tx.execute(sql.raw(`SET LOCAL pg_trgm.similarity_threshold = ${SIMILARITY_THRESHOLD}`));
  await tx.execute(sql.raw(`SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`));
}

interface PersonRow extends Record<string, unknown> {
  id: string;
  slug: string;
  display_name: string;
  display_lang: string;
  name_value: string;
  name_lang: string;
  name_script: string;
  name_is_primary: boolean;
  city_name: string | null;
  country_code: string | null;
  lineage_name: string | null;
  verified: boolean;
  invitable: boolean;
  record: 'claimed' | 'unclaimed' | 'historical';
  verified_instructor: boolean;
}

/**
 * People whose keys match a form. `query` is the query as the search read it (NFC, trimmed): when
 * two stored names of a person match equally (蘇晴嵐 and 苏晴岚 share one key), the one written as
 * typed is the match shown.
 */
export async function searchPeople(tx: Executor, forms: readonly QueryForm[], filters: SearchFilters, query = ''): Promise<PeopleHits> {
  const result = await tx.execute<PersonRow>(sql`
    WITH f AS (${formsTable(forms)}),
    -- The people of the lineage filter, read once: an EXISTS per candidate row ran the public
    -- edge view tens of thousands of times and passed the 2 s statement timeout.
    in_lineage AS MATERIALIZED (
      SELECT e.student_person_id AS person_id FROM v_public_edge e WHERE e.lineage_id = ${filters.lineageId}::uuid
      UNION
      SELECT e.teacher_person_id FROM v_public_edge e WHERE e.lineage_id = ${filters.lineageId}::uuid
    ),
    hits AS (
      SELECT k.person_id, k.person_name_id,
             MAX(CASE
                   WHEN k.key = f.text THEN ${num(RANK.exact)}
                   WHEN k.key LIKE f.prefix THEN ${num(RANK.prefix)} + similarity(k.key, f.text)
                   WHEN NOT f.han AND (' ' || k.key) LIKE f.word_prefix THEN ${num(RANK.wordPrefix)} + similarity(k.key, f.text)
                   WHEN f.han AND k.key_kind = 'han'
                        AND (strpos(k.key, f.text) > 0 OR (char_length(k.key) >= 2 AND strpos(f.text, k.key) > 0)) THEN ${num(RANK.hanContains)}
                   ELSE greatest(similarity(k.key, f.text), word_similarity(f.text, k.key))
                 END
                 -- A key of the name as written beats one generated from it, so the stored
                 -- Jyutping is the match shown rather than the characters it could be read from.
                 + CASE WHEN k.source = 'name' THEN ${num(RANK.asWritten)} ELSE 0 END) AS score
        FROM f
        JOIN v_public_person_key k
          ON k.key = f.text
          OR k.key LIKE f.prefix
          -- A later word of the key starts with the query: "ng" finds "siu ming ng" (two letters
          -- give no trigrams to compare).
          OR (NOT f.han AND (' ' || k.key) LIKE f.word_prefix)
          -- Chinese characters: the query inside a name ("晴" in "苏晴岚"), or a name of two or more
          -- characters inside the query (a name typed with a title after it).
          OR (f.han AND k.key_kind = 'han' AND (strpos(k.key, f.text) > 0 OR (char_length(k.key) >= 2 AND strpos(f.text, k.key) > 0)))
          OR (NOT f.han AND char_length(f.text) >= ${MIN_TRIGRAM_LENGTH} AND (k.key % f.text OR f.text <% k.key))
       GROUP BY k.person_id, k.person_name_id
    ),
    ranked AS (
      SELECT DISTINCT ON (p.id)
             p.id, p.slug, p.display_name, p.country_code, p.city_name,
             dn.lang AS display_lang,
             n.value AS name_value, n.lang AS name_lang, n.script AS name_script, n.is_primary AS name_is_primary,
             EXISTS (SELECT 1 FROM v_public_edge e
                      WHERE e.status = 'verified' AND (e.student_person_id = p.id OR e.teacher_person_id = p.id)) AS verified,
             (p.stewardship = 'unclaimed' AND p.kind = 'living' AND p.life_status <> 'deceased') AS invitable,
             -- Journey review P2-9 (ADR 0085): what tells people apart, instead of one badge for all.
             CASE WHEN p.kind = 'historical' OR p.life_status = 'deceased' THEN 'historical'
                  WHEN p.stewardship = 'self' THEN 'claimed'
                  ELSE 'unclaimed' END AS record,
             COALESCE(p.instructor_status = 'verified', false) AS verified_instructor,
             h.score + CASE WHEN n.is_primary THEN ${num(RANK.primary)} ELSE 0 END AS score
        FROM hits h
        JOIN v_public_person p ON p.id = h.person_id
        JOIN person_name n ON n.id = h.person_name_id AND n.person_id = p.id
        JOIN person_name dn ON dn.person_id = p.id AND dn.is_primary
       WHERE (${filters.countryCode}::text IS NULL OR p.country_code = ${filters.countryCode})
         AND (${filters.lineageId}::uuid IS NULL OR p.id IN (SELECT person_id FROM in_lineage))
       ORDER BY p.id, score DESC, (n.value = ${query}::text) DESC, n.is_primary DESC, n.sort_order
    )
    SELECT r.*,
           (SELECT e.lineage_name FROM v_public_edge e
             WHERE e.student_person_id = r.id OR e.teacher_person_id = r.id
             ORDER BY (e.student_person_id = r.id AND e.is_display_primary) DESC, (e.student_person_id = r.id) DESC, e.lineage_name
             LIMIT 1) AS lineage_name
      FROM ranked r
     ORDER BY r.score + CASE WHEN r.verified THEN ${num(RANK.verified)} ELSE 0 END DESC, r.display_name, r.id
     LIMIT ${LIMITS.people + 1}`);
  // One row past the limit says that more people match than the answer lists.
  const people = result.rows.slice(0, LIMITS.people).map((row) => {
    const displayName: SearchNameDto = { value: row.display_name, lang: row.display_lang, script: 'Latn' };
    const matched: SearchNameDto | null = row.name_is_primary ? null : { value: row.name_value, lang: row.name_lang, script: row.name_script };
    return {
      id: row.id,
      slug: row.slug,
      displayName,
      matched,
      city: row.city_name,
      countryCode: row.country_code,
      lineageName: row.lineage_name,
      verified: row.verified,
      invitable: row.invitable,
      record: row.record,
      verifiedInstructor: row.verified_instructor,
    };
  });
  return { people, more: result.rows.length > LIMITS.people };
}

/** Folded name text in SQL, the counterpart of foldLatin() for the Latin names of schools and lineages. */
const folded = (column: ReturnType<typeof sql.raw>) => sql`btrim(regexp_replace(lower(unaccent(${column})), '[^[:alnum:]]+', ' ', 'g'))`;

function nameMatches(column: ReturnType<typeof sql.raw>) {
  return sql`(
    ${folded(column)} LIKE f.prefix
    OR (char_length(f.text) >= 2 AND strpos(${folded(column)}, f.text) > 0)
    OR (char_length(f.text) >= ${MIN_TRIGRAM_LENGTH} AND (${folded(column)} % f.text OR f.text <% ${folded(column)})))`;
}

function nameScore(column: ReturnType<typeof sql.raw>) {
  return sql`MAX(CASE
    WHEN ${folded(column)} = f.text THEN ${num(RANK.exact)}
    WHEN ${folded(column)} LIKE f.prefix THEN ${num(RANK.prefix)} + similarity(${folded(column)}, f.text)
    ELSE greatest(similarity(${folded(column)}, f.text), word_similarity(f.text, ${folded(column)}))
  END)`;
}

interface SchoolRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  city_name: string;
  country_code: string;
  instructor_slug: string | null;
  instructor_name: string | null;
  instructor_lang: string | null;
}

export async function searchSchools(tx: Executor, forms: readonly QueryForm[], filters: SearchFilters): Promise<SchoolHitDto[]> {
  const latin = forms.filter((f) => !f.han);
  if (latin.length === 0) return [];
  const name = sql.raw('s.name');
  const result = await tx.execute<SchoolRow>(sql`
    WITH f AS (${formsTable(latin)}),
    hits AS (
      SELECT s.id, greatest(${nameScore(name)}, MAX(CASE WHEN ${folded(sql.raw('s.city_name'))} = f.text THEN ${num(CITY_RANK)} ELSE 0 END)) AS score
        FROM f JOIN v_public_school s ON ${nameMatches(name)} OR ${folded(sql.raw('s.city_name'))} = f.text
       WHERE (${filters.countryCode}::text IS NULL OR s.country_code = ${filters.countryCode})
         AND (${filters.lineageId}::uuid IS NULL OR EXISTS (
               SELECT 1 FROM v_public_edge e
                WHERE e.lineage_id = ${filters.lineageId}::uuid
                  AND (e.student_person_id = ANY (s.instructor_person_ids) OR e.teacher_person_id = ANY (s.instructor_person_ids))))
       GROUP BY s.id
    )
    SELECT s.id, s.slug, s.name, s.city_name, s.country_code,
           ip.slug AS instructor_slug, ip.display_name AS instructor_name, ipn.lang AS instructor_lang
      FROM hits h
      JOIN v_public_school s ON s.id = h.id
      LEFT JOIN LATERAL (
        SELECT p.id, p.slug, p.display_name FROM v_public_person p
         WHERE p.id = ANY (s.instructor_person_ids)
         ORDER BY array_position(s.instructor_person_ids, p.id) LIMIT 1) ip ON true
      LEFT JOIN person_name ipn ON ipn.person_id = ip.id AND ipn.is_primary
     ORDER BY h.score DESC, s.name, s.id
     LIMIT ${LIMITS.schools}`);
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city_name,
    countryCode: row.country_code,
    instructor:
      row.instructor_slug && row.instructor_name
        ? { slug: row.instructor_slug, displayName: { value: row.instructor_name, lang: row.instructor_lang ?? 'und-Latn', script: 'Latn' } }
        : null,
  }));
}

interface LineageRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  root_slug: string;
  root_name: string;
  root_lang: string;
}

export async function searchLineages(tx: Executor, forms: readonly QueryForm[], filters: SearchFilters): Promise<LineageHitDto[]> {
  const latin = forms.filter((f) => !f.han);
  if (latin.length === 0) return [];
  const name = sql.raw('l.lineage_name');
  const result = await tx.execute<LineageRow>(sql`
    WITH f AS (${formsTable(latin)}),
    l AS (
      SELECT DISTINCT e.lineage_id, e.lineage_slug, e.lineage_name, e.lineage_root_person_id FROM v_public_edge e
       WHERE e.lineage_root_person_id IS NOT NULL
    ),
    hits AS (
      SELECT l.lineage_id AS id, ${nameScore(name)} AS score
        FROM f JOIN l ON ${nameMatches(name)}
       WHERE (${filters.lineageId}::uuid IS NULL OR l.lineage_id = ${filters.lineageId}::uuid)
         AND (${filters.countryCode}::text IS NULL OR EXISTS (
               SELECT 1 FROM v_public_edge e JOIN v_public_person p ON p.id IN (e.student_person_id, e.teacher_person_id)
                WHERE e.lineage_id = l.lineage_id AND p.country_code = ${filters.countryCode}))
       GROUP BY l.lineage_id
    )
    SELECT l.lineage_id AS id, l.lineage_slug AS slug, l.lineage_name AS name,
           rp.slug AS root_slug, rp.display_name AS root_name, rn.lang AS root_lang
      FROM hits h
      JOIN l ON l.lineage_id = h.id
      JOIN v_public_person rp ON rp.id = l.lineage_root_person_id
      JOIN person_name rn ON rn.person_id = rp.id AND rn.is_primary
     ORDER BY h.score DESC, l.lineage_name, l.lineage_id
     LIMIT ${LIMITS.lineages}`);
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    root: { slug: row.root_slug, displayName: { value: row.root_name, lang: row.root_lang, script: 'Latn' } },
  }));
}

interface OrganizationRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  kind: OrganizationHitDto['kind'];
  country_code: string | null;
}

/**
 * ADR 0051: approved organizations by their name, as schools are. An organization belongs to no
 * lineage, so a search inside a lineage lists none; the country filter is the organization's own.
 */
export async function searchOrganizations(tx: Executor, forms: readonly QueryForm[], filters: SearchFilters): Promise<Omit<OrganizationHitDto, 'kindLabel'>[]> {
  const latin = forms.filter((f) => !f.han);
  if (latin.length === 0 || filters.lineageId !== null) return [];
  const name = sql.raw('o.name');
  const result = await tx.execute<OrganizationRow>(sql`
    WITH f AS (${formsTable(latin)}),
    hits AS (
      SELECT o.id, ${nameScore(name)} AS score
        FROM f JOIN v_public_organization o ON ${nameMatches(name)}
       WHERE (${filters.countryCode}::text IS NULL OR o.country_code = ${filters.countryCode})
       GROUP BY o.id
    )
    SELECT o.id, o.slug, o.name, o.kind, o.country_code
      FROM hits h
      JOIN v_public_organization o ON o.id = h.id
     ORDER BY h.score DESC, o.name, o.id
     LIMIT ${LIMITS.organizations}`);
  return result.rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, kind: row.kind, countryCode: row.country_code }));
}

interface EventRow extends Record<string, unknown> {
  id: string;
  slug: string;
  title: string;
  starts_at: Date | string;
  timezone: string;
  city_name: string | null;
  country_code: string | null;
  online: boolean;
}

/**
 * Role replay 2026-11-25 (P2-5): upcoming published events by their title, or by the city they
 * are in, soonest first among equal matches. Read through v_public_event (published and cancelled
 * events of public organizers only); a cancelled one is left out. An event belongs to no lineage,
 * so a search inside a lineage lists none; the country filter keeps in-person events there.
 */
export async function searchEvents(tx: Executor, forms: readonly QueryForm[], filters: SearchFilters): Promise<EventHitDto[]> {
  const latin = forms.filter((f) => !f.han);
  if (latin.length === 0 || filters.lineageId !== null) return [];
  const title = sql.raw('v.title');
  const city = folded(sql.raw('v.city_name'));
  const result = await tx.execute<EventRow>(sql`
    WITH f AS (${formsTable(latin)}),
    hits AS (
      SELECT v.id, greatest(${nameScore(title)}, MAX(CASE WHEN ${city} = f.text THEN ${num(CITY_RANK)} ELSE 0 END)) AS score
        FROM f JOIN v_public_event v ON ${nameMatches(title)} OR (NOT v.online AND ${city} = f.text)
       WHERE v.status = 'published' AND v.ends_at > now()
         AND (${filters.countryCode}::text IS NULL OR (NOT v.online AND v.country_code = ${filters.countryCode}))
       GROUP BY v.id
    )
    SELECT v.id, v.slug, v.title, v.starts_at, v.timezone, v.city_name, v.country_code, v.online
      FROM hits h
      JOIN v_public_event v ON v.id = h.id
     ORDER BY h.score DESC, v.starts_at, v.slug
     LIMIT ${LIMITS.events}`);
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    startsAt: new Date(row.starts_at).toISOString(),
    timezone: row.timezone,
    city: row.online ? null : row.city_name,
    countryCode: row.online ? null : row.country_code,
    online: row.online,
  }));
}

interface PlaceRow extends Record<string, unknown> {
  id: string;
  name: string;
  country_code: string;
  schools: number;
  events: number;
}

/**
 * Role replay 2026-11-25 (P2-5): the city the whole query names ("sofia", "София"), among the
 * places that have a public school or an upcoming in-person event, with how many of each: the
 * answer opens with "Schools in Sofia (2)" and "Events in Sofia (1)". The place with the most
 * wins a name several countries share; the country filter narrows it.
 */
export async function searchPlace(tx: Executor, forms: readonly QueryForm[], filters: SearchFilters): Promise<PlaceHitDto | null> {
  const latin = forms.filter((f) => !f.han);
  if (latin.length === 0 || filters.lineageId !== null) return null;
  const result = await tx.execute<PlaceRow>(sql`
    WITH f AS (${formsTable(latin)}),
    -- Only the public views (scripts/verify.d/M07.sh): the city of a listed school or of an upcoming
    -- in-person event, by the name the views carry.
    used AS (
      SELECT s.place_id, s.city_name, s.country_code FROM v_public_school s
      UNION
      SELECT v.place_id, v.city_name, v.country_code FROM v_public_event v
       WHERE v.status = 'published' AND NOT v.online AND v.ends_at > now() AND v.place_id IS NOT NULL AND v.city_name IS NOT NULL
    ),
    c AS (
      SELECT DISTINCT u.place_id AS id, u.city_name AS name, u.country_code
        FROM used u
        JOIN f ON ${folded(sql.raw('u.city_name'))} = f.text
       WHERE (${filters.countryCode}::text IS NULL OR u.country_code = ${filters.countryCode})
    )
    SELECT c.id, c.name, c.country_code,
           (SELECT count(*)::int FROM v_public_school s WHERE s.place_id = c.id) AS schools,
           (SELECT count(*)::int FROM v_public_event v
             WHERE v.place_id = c.id AND v.status = 'published' AND NOT v.online AND v.ends_at > now()) AS events
      FROM c
     ORDER BY (SELECT count(*) FROM v_public_school s WHERE s.place_id = c.id) DESC, c.name, c.id
     LIMIT 1`);
  const row = result.rows[0];
  if (!row || row.schools + row.events === 0) return null;
  return { id: row.id, name: row.name, countryCode: row.country_code, schools: row.schools, events: row.events };
}
