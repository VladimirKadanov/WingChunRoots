// The home page's living line (journey review 2026-11-26, P1-4; ADR 0078): one line of a real
// public lineage, from its recorded root down to at most eight people, instead of a fictional one.
// The lineage is the one an archivist chose in the control panel (lineage.featured_on_home), or,
// when none is chosen, one of the public lineages by rotation, a different one each day (UTC).
//
// A cached public read like lineage.start: app_public_ro, v_public_* only, tagged explore-start,
// lineage:<id> and person:<id> of everyone drawn (plan §6.4), so a change to the choice, a link or
// a person drops it. The walk goes down one student at a time: the student with the most public
// students of their own in the same lineage (then the display-primary link, then the id), so the
// line reaches as far down as the record does without enumerating every route.

import { sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';

import { EXPLORE_START_TAG, lineageTag, personTag, tagCacheEntry } from '../cache';
import { getPublicDb } from '../db';
import { type HomeLineDto, toPublicHomeLine } from '../dto/home';

/** The most people the line draws (the home page's eight rows). */
export const HOME_LINE_MAX = 8;

interface LineageRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  root_id: string;
  featured: boolean;
}

interface StepRow extends Record<string, unknown> {
  id: string;
  status: 'verified' | 'in_arbitration';
  certainty: 'documented' | 'traditional' | 'disputed' | null;
  periods: { startsOn: string | null }[];
  students: number;
}

interface PersonRow extends Record<string, unknown> {
  id: string;
  slug: string;
  display_name: string;
  alt_names: { value: string; script: string | null; lang: string | null }[];
  city_name: string | null;
  life_status: string;
}

const EMPTY: HomeLineDto = { lineage: null, people: [], links: [] };

/** The day number (UTC) that picks the lineage of the rotation. */
export function rotationDay(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

async function cachedHomeLine(day: number): Promise<HomeLineDto> {
  'use cache';
  cacheLife('hours');
  const db = getPublicDb();
  const lineages = await db.execute<LineageRow>(sql`
    SELECT DISTINCT e.lineage_id::text AS id, e.lineage_slug AS slug, e.lineage_name AS name,
           e.lineage_root_person_id::text AS root_id, e.lineage_featured AS featured
      FROM v_public_edge e
     WHERE e.lineage_root_person_id IS NOT NULL AND e.teacher_person_id = e.lineage_root_person_id
     ORDER BY featured DESC, slug`);
  tagCacheEntry([EXPLORE_START_TAG, ...lineages.rows.map((l) => lineageTag(l.id))]);
  if (lineages.rows.length === 0) return toPublicHomeLine(EMPTY);
  const chosen = lineages.rows[0]!.featured ? lineages.rows[0]! : lineages.rows[day % lineages.rows.length]!;

  const ids = [chosen.root_id];
  const links: HomeLineDto['links'] = [];
  const years: (number | null)[] = [null];
  const students = new Map<string, number>();
  while (ids.length < HOME_LINE_MAX) {
    const current = ids[ids.length - 1]!;
    const next = await db.execute<StepRow>(sql`
      SELECT e.student_person_id::text AS id, e.status, e.certainty, e.periods,
             (SELECT count(*)::int FROM v_public_edge x WHERE x.teacher_person_id = e.student_person_id AND x.lineage_id = e.lineage_id) AS students
        FROM v_public_edge e
       WHERE e.teacher_person_id = ${current}::uuid AND e.lineage_id = ${chosen.id}::uuid
       ORDER BY students DESC, e.is_display_primary DESC, e.student_person_id
       LIMIT ${HOME_LINE_MAX + 1}`);
    const step = next.rows.find((r) => !ids.includes(r.id));
    if (!students.has(current)) students.set(current, next.rows.length);
    if (!step) break;
    ids.push(step.id);
    students.set(step.id, step.students);
    links.push({ status: step.status, certainty: step.certainty });
    const starts = step.periods.map((p) => (p.startsOn ? Number(p.startsOn.slice(0, 4)) : null)).filter((y): y is number => y !== null);
    years.push(starts.length > 0 ? Math.min(...starts) : null);
  }
  if (ids.length < 2) return toPublicHomeLine(EMPTY);

  const people = await db.execute<PersonRow>(sql`
    SELECT id::text AS id, slug, display_name, alt_names, city_name, life_status
      FROM v_public_person WHERE id = ANY(${`{${ids.join(',')}}`}::uuid[])`);
  const byId = new Map(people.rows.map((p) => [p.id, p]));
  tagCacheEntry(ids.map(personTag));
  const drawn: HomeLineDto['people'] = [];
  for (const [i, id] of ids.entries()) {
    const p = byId.get(id);
    if (!p) break;
    const other = (p.alt_names ?? []).find((n) => n.script && n.script !== 'Latn' && n.lang);
    drawn.push({
      id,
      slug: p.slug,
      displayName: p.display_name,
      original: other ? { text: other.value, lang: other.lang! } : null,
      city: p.city_name,
      startYear: years[i] ?? null,
      living: p.life_status === 'living',
      students: students.get(id) ?? 0,
    });
  }
  if (drawn.length < 2) return toPublicHomeLine(EMPTY);
  return toPublicHomeLine({ lineage: { id: chosen.id, slug: chosen.slug, name: chosen.name }, people: drawn, links: links.slice(0, drawn.length - 1) });
}

/** lineage.home: the home page's line, from the chosen lineage or today's in the rotation. */
export async function homeLine(now: Date = new Date()): Promise<HomeLineDto> {
  return cachedHomeLine(rotationDay(now));
}
