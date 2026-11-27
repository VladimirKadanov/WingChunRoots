// The archive editor's working views (owner request 2026-11-17, docs/adr/0035-control-panel.md): the
// screens an archivist spends hours in, built for thousands of records. Read-only; every change still
// goes through the procedures of archive-editor.ts.
//
//   archiveEditor.overview   every lineage with its root, people, generations, sourced share and last
//                            edit, searched and sorted, and the archive's figures
//   archiveEditor.people     every record (public or not), found by any spelling, filtered, 50 a page
//   archiveEditor.links      one lineage's links, filtered (status, missing source or years,
//                            generation, a teacher or student), sorted, 50 a page
//   archiveEditor.tree       one lineage as an outline: the root (or the people at the top) and the
//                            students of the branches the editor opened, never the whole lineage
//   archiveEditor.person     one person in one lineage: their teachers and students there, and the
//                            other lineages they are in
//
// Who: an archivist or an administrator whose session proved the second factor (ARCHIVE_EDITOR_ROLES).
// These views show records that are not public, so they are never cached ('use cache') and never
// leave the control panel. A link counts as active while it is verified or in arbitration. "Sourced"
// means a source is written with it, or the teacher approved it themselves; "years missing" means no
// training period has a start year. A generation is counted along active links from the lineage's
// root (generation 1); a person not connected to the root has none.

import { sql, type SQL } from 'drizzle-orm';
import * as z from 'zod';

import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import type { Executor } from '../entitlements/access';
import { queryForms } from '../search/keys';
import { archiveKeepsLink, type ArchiveRecordRef, listedLineages, refsOf, requireArchiveEditor } from './archive-editor';
import { ServiceError } from './errors';
import { cleanName } from './names';

export const ARCHIVE_GRID_PAGE_SIZE = 50;
/** At most this many students of one person are listed in the outline; the links grid has the rest. */
export const TREE_CHILDREN_LIMIT = 50;
/** At most this many branches are open at once (the `open` list of the outline's address). */
export const TREE_OPEN_LIMIT = 40;
/** The depth the generation count follows, well past any recorded lineage. */
const MAX_DEPTH = 80;

export const LINEAGE_SORTS = ['name', 'people', 'links', 'sourced', 'edited'] as const;
export const PEOPLE_FILTERS = ['everyone', 'historical', 'members', 'hidden', 'no_teacher', 'duplicates'] as const;
export const LINK_FILTERS = ['active', 'verified', 'in_arbitration', 'ended', 'no_source', 'no_years', 'all'] as const;
export const LINK_SORTS = ['generation', 'teacher', 'student', 'years', 'edited'] as const;

const NO_LINEAGE = 'No such lineage.';
const SLUG = /^[a-z0-9-]{1,200}$/;

const query = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((s) => (s ? s : undefined));
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const slug = z.string().trim().toLowerCase().max(200);

export const archiveOverviewInput = z.object({ q: query, sort: z.enum(LINEAGE_SORTS).default('name') }).default({ q: undefined, sort: 'name' });
export const archivePeopleInput = z
  .object({ q: query, show: z.enum(PEOPLE_FILTERS).default('everyone'), lineage: slug.optional(), page })
  .default({ q: undefined, show: 'everyone', page: 1 });
export const archiveLinksInput = z.object({
  slug,
  q: query,
  show: z.enum(LINK_FILTERS).default('active'),
  generation: z.coerce.number().int().min(1).max(MAX_DEPTH).optional(),
  sort: z.enum(LINK_SORTS).default('generation'),
  page,
  /** A link to show in full beside the grid (its side panel). */
  link: z.uuid().optional(),
});
export const archiveTreeInput = z.object({ slug, open: z.array(slug).max(TREE_OPEN_LIMIT).default([]) });
export const archivePersonInput = z.object({ slug, person: slug });

export type ArchiveOverviewInput = z.input<typeof archiveOverviewInput>;
export type ArchivePeopleInput = z.input<typeof archivePeopleInput>;
export type ArchiveLinksInput = z.input<typeof archiveLinksInput>;

// --- Views -------------------------------------------------------------------------------------

export interface ArchiveLineageRow {
  id: string;
  slug: string;
  name: string;
  root: ArchiveRecordRef | null;
  /** People on its active links. */
  people: number;
  /** Active links. */
  links: number;
  /** Generations below the root along active links, the root's own included; null without a root. */
  generations: number | null;
  /** Whole percent of the active links that are sourced; null without links. */
  sourced: number | null;
  /** Active links without a source or without years. */
  needsWork: number;
  /** The last change to the lineage or one of its links. */
  editedAt: string | null;
  listed: boolean;
}

export interface ArchiveOverview {
  figures: { lineages: number; people: number; links: number; needsWork: number };
  rows: ArchiveLineageRow[];
}

export interface ArchivePersonRow {
  record: ArchiveRecordRef;
  lineages: { slug: string; name: string }[];
  teachers: number;
  students: number;
  /** Another record has the same primary name. */
  duplicate: boolean;
}

export interface ArchivePeopleList {
  rows: ArchivePersonRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  /** The figures beside the filters. */
  counts: { noTeacher: number; duplicates: number };
  lineage: { slug: string; name: string } | null;
  lineages: { slug: string; name: string }[];
}

export interface ArchiveLinkRow {
  id: string;
  teacher: ArchiveRecordRef;
  student: ArchiveRecordRef;
  /** The teacher's generation (the student is the next); null when not connected to the root. */
  generation: number | null;
  status: 'verified' | 'in_arbitration' | 'revoked';
  shown: boolean;
  fromYear: number | null;
  toYear: number | null;
  source: string | null;
  path: 'committee_review' | 'teacher_approval';
  endable: boolean;
  /** Its years and source may be corrected here (the same links as endable: archiveKeepsLink). */
  editable: boolean;
  editedAt: string;
}

/** The header of a lineage's workspace: what every tab shows above its view. */
export interface ArchiveLineageHead {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  root: ArchiveRecordRef | null;
  listed: boolean;
  /** P1-4 (ADR 0078): the lineage the home page draws. */
  featuredOnHome: boolean;
  /** P2-10 (ADR 0086): the shared teachers before the branches split. */
  commonRoots: boolean;
  /** Active links, the people on them, and those without a source or years. */
  links: number;
  people: number;
  needsWork: number;
}

export interface ArchiveLinkList {
  lineage: ArchiveLineageHead;
  rows: ArchiveLinkRow[];
  /** The link asked for with `link`, or null. */
  selected: ArchiveLinkRow | null;
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  counts: Record<(typeof LINK_FILTERS)[number], number>;
  /** The deepest generation with a teacher, for the generation filter. */
  generations: number;
}

export interface ArchiveTreeNode {
  record: ArchiveRecordRef;
  generation: number;
  /** The link from the parent in the outline; null at the top. */
  link: { id: string; status: 'verified' | 'in_arbitration'; sourced: boolean; fromYear: number | null; toYear: number | null } | null;
  /** Active students in this lineage. */
  students: number;
  /** The students listed (at most TREE_CHILDREN_LIMIT), when the branch is open; null when closed. */
  children: ArchiveTreeNode[] | null;
}

export interface ArchiveTree {
  lineage: ArchiveLineageHead;
  /** The root, or the people at the top when the lineage has no root yet. */
  top: ArchiveTreeNode[];
  /** How many people are at the top in all (only when there is no root). */
  topTotal: number;
}

export interface ArchivePersonLink {
  id: string;
  other: ArchiveRecordRef;
  status: 'verified' | 'in_arbitration';
  sourced: boolean;
  fromYear: number | null;
  toYear: number | null;
  students: number;
}

export interface ArchivePersonView {
  record: ArchiveRecordRef;
  generation: number | null;
  teachers: ArchivePersonLink[];
  students: ArchivePersonLink[];
  studentsTotal: number;
  /** Other lineages with an active link of this person. */
  lineages: { slug: string; name: string }[];
  /** A source written on one of their links here, if any (the first few). */
  sources: string[];
}

// --- Helpers -----------------------------------------------------------------------------------

/** `%`, `_` and `\` typed into a search box match themselves. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const prefix = (text: string) => `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const yearOf = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const pagesOf = (total: number) => Math.max(1, Math.ceil(total / ARCHIVE_GRID_PAGE_SIZE));
const ids = (list: readonly string[]) =>
  sql.join(
    list.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * The people whose names match `q` in any spelling: a stored name containing it, a search key
 * (Latin letters without diacritics or tones, Jyutping, pinyin, Cyrillic in Latin letters, Chinese
 * characters folded to one form: src/server/search/keys.ts) starting with it or a later word of one
 * starting with it, or the record's address. Every record, public or not (staff only).
 */
export function matchingPeople(q: string): SQL {
  const text = cleanName(q);
  const parts: SQL[] = [sql`SELECT n.person_id FROM person_name n WHERE n.value ILIKE ${contains(text)}`, sql`SELECT p.id FROM person p WHERE p.slug = ${text.toLowerCase()}`];
  const forms = queryForms(text);
  if (forms.length > 0) {
    const rows = forms.map((f) => sql`(${f.text}::text, ${f.han}::boolean, ${prefix(f.text)}::text, ${`% ${prefix(f.text)}`}::text)`);
    parts.push(sql`SELECT k.person_id FROM person_name_key k
      JOIN (VALUES ${sql.join(rows, sql`, `)}) AS f(text, han, prefix, word_prefix)
        ON k.key LIKE f.prefix
        OR (NOT f.han AND (' ' || k.key) LIKE f.word_prefix)
        OR (f.han AND k.key_kind = 'han' AND strpos(k.key, f.text) > 0)`);
  }
  return sql.join(parts, sql` UNION `);
}

/** The active links of the given lineages and each person's generation from the lineage's root. */
function depthCte(lineageIds: SQL): SQL {
  return sql`
    act AS (
      SELECT r.id, r.lineage_id, r.teacher_person_id, r.student_person_id
        FROM teaching_relationship r
       WHERE r.lineage_id IN (${lineageIds}) AND r.status IN ('verified', 'in_arbitration')
    ),
    walk(lineage_id, person_id, depth) AS (
      SELECT l.id, l.root_person_id, 0 FROM lineage l WHERE l.id IN (${lineageIds}) AND l.root_person_id IS NOT NULL
      UNION
      SELECT w.lineage_id, a.student_person_id, w.depth + 1
        FROM walk w JOIN act a ON a.lineage_id = w.lineage_id AND a.teacher_person_id = w.person_id
       WHERE w.depth < ${sql.raw(String(MAX_DEPTH))}
    ),
    depth AS (SELECT lineage_id, person_id, min(depth) AS depth FROM walk GROUP BY lineage_id, person_id)`;
}

async function lineageBySlug(db: Executor, raw: string): Promise<{ id: string; slug: string; name: string; description: string | null; rootPersonId: string | null; featuredOnHome: boolean; commonRoots: boolean }> {
  if (!SLUG.test(raw)) throw new ServiceError('NOT_FOUND', NO_LINEAGE);
  const result = await db.execute<{ id: string; slug: string; name: string; description: string | null; root_person_id: string | null; featured_on_home: boolean; common_roots: boolean }>(sql`
    SELECT id::text, slug, name, description, root_person_id::text, featured_on_home, common_roots FROM lineage WHERE slug = ${raw} AND deleted_at IS NULL`);
  const row = result.rows[0];
  if (!row) throw new ServiceError('NOT_FOUND', NO_LINEAGE);
  return { id: row.id, slug: row.slug, name: row.name, description: row.description, rootPersonId: row.root_person_id, featuredOnHome: row.featured_on_home, commonRoots: row.common_roots };
}

/** The workspace header of a lineage: its root, whether the explorer lists it, and its figures. */
async function lineageHead(db: Executor, line: Awaited<ReturnType<typeof lineageBySlug>>): Promise<ArchiveLineageHead> {
  const facts = await db.execute<{ links: number; people: number; needs_work: number }>(sql`
    WITH act AS (
      SELECT r.id, r.teacher_person_id, r.student_person_id, r.source_note, r.verification_path FROM teaching_relationship r
       WHERE r.lineage_id = ${line.id}::uuid AND r.status IN ('verified', 'in_arbitration'))
    SELECT (SELECT count(*)::int FROM act) AS links,
           (SELECT count(DISTINCT p)::int FROM (SELECT teacher_person_id AS p FROM act UNION ALL SELECT student_person_id FROM act) x) AS people,
           (SELECT count(*)::int FROM act a WHERE NOT (a.source_note IS NOT NULL OR a.verification_path = 'teacher_approval')
               OR NOT EXISTS (SELECT 1 FROM training_period tp WHERE tp.relationship_id = a.id AND tp.starts_on IS NOT NULL)) AS needs_work`);
  const refs = line.rootPersonId ? await refsOf(db, [line.rootPersonId]) : new Map<string, ArchiveRecordRef>();
  const listed = await listedLineages(db, [line.id]);
  const f = facts.rows[0]!;
  return {
    id: line.id,
    slug: line.slug,
    name: line.name,
    description: line.description,
    root: line.rootPersonId ? (refs.get(line.rootPersonId) ?? null) : null,
    listed: listed.has(line.id),
    featuredOnHome: line.featuredOnHome,
    commonRoots: line.commonRoots,
    links: f.links,
    people: f.people,
    needsWork: f.needs_work,
  };
}

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the filters.');
  return parsed.data;
}

// --- Lineages ----------------------------------------------------------------------------------

/** archiveEditor.overview: every lineage with its figures, and the archive's totals. */
export async function archiveOverview(principal: Principal | null, raw: ArchiveOverviewInput = {}): Promise<ArchiveOverview> {
  requireArchiveEditor(principal);
  const input = parse(archiveOverviewInput, raw);
  const db = getDb();
  const order = {
    name: sql`lower(l.name), l.id`,
    people: sql`people DESC, lower(l.name), l.id`,
    links: sql`links DESC, lower(l.name), l.id`,
    // Least sourced first: the lineages that need work.
    sourced: sql`sourced_pct ASC NULLS LAST, lower(l.name), l.id`,
    edited: sql`edited_at DESC NULLS LAST, lower(l.name), l.id`,
  }[input.sort];
  const live = sql`SELECT id FROM lineage WHERE deleted_at IS NULL`;
  const result = await db.execute<{
    id: string;
    slug: string;
    name: string;
    root_person_id: string | null;
    people: number;
    links: number;
    generations: number | null;
    sourced_pct: number | null;
    needs_work: number;
    edited_at: string | null;
  }>(sql`
    WITH RECURSIVE ${depthCte(live)},
    facts AS (
      SELECT r.lineage_id,
             count(*)::int AS links,
             count(*) FILTER (WHERE r.source_note IS NOT NULL OR r.verification_path = 'teacher_approval')::int AS sourced,
             count(*) FILTER (WHERE NOT (r.source_note IS NOT NULL OR r.verification_path = 'teacher_approval')
                              OR NOT EXISTS (SELECT 1 FROM training_period tp WHERE tp.relationship_id = r.id AND tp.starts_on IS NOT NULL))::int AS needs_work,
             max(r.updated_at) AS edited_at
        FROM teaching_relationship r
       WHERE r.status IN ('verified', 'in_arbitration')
       GROUP BY r.lineage_id
    ),
    people AS (
      SELECT lineage_id, count(DISTINCT person_id)::int AS people
        FROM (SELECT lineage_id, teacher_person_id AS person_id FROM act UNION ALL SELECT lineage_id, student_person_id FROM act) x
       GROUP BY lineage_id
    ),
    gens AS (SELECT lineage_id, (max(depth) + 1)::int AS generations FROM depth GROUP BY lineage_id)
    SELECT l.id::text, l.slug, l.name, l.root_person_id::text,
           coalesce(pp.people, 0) AS people,
           coalesce(f.links, 0) AS links,
           g.generations,
           CASE WHEN coalesce(f.links, 0) = 0 THEN NULL ELSE floor(100.0 * f.sourced / f.links)::int END AS sourced_pct,
           coalesce(f.needs_work, 0) AS needs_work,
           greatest(l.updated_at, f.edited_at) AS edited_at
      FROM lineage l
      LEFT JOIN facts f ON f.lineage_id = l.id
      LEFT JOIN people pp ON pp.lineage_id = l.id
      LEFT JOIN gens g ON g.lineage_id = l.id
     WHERE l.deleted_at IS NULL
       AND (${input.q ?? null}::text IS NULL OR l.name ILIKE ${contains(input.q ?? '')} OR l.slug = ${(input.q ?? '').toLowerCase()})
     ORDER BY ${order}
     LIMIT 500`);
  const figures = await db.execute<{ lineages: number; people: number; links: number; needs_work: number }>(sql`
    SELECT (SELECT count(*)::int FROM lineage WHERE deleted_at IS NULL) AS lineages,
           (SELECT count(*)::int FROM person WHERE deleted_at IS NULL) AS people,
           (SELECT count(*)::int FROM teaching_relationship r JOIN lineage l ON l.id = r.lineage_id AND l.deleted_at IS NULL
             WHERE r.status IN ('verified', 'in_arbitration')) AS links,
           (SELECT count(*)::int FROM teaching_relationship r JOIN lineage l ON l.id = r.lineage_id AND l.deleted_at IS NULL
             WHERE r.status IN ('verified', 'in_arbitration')
               AND (NOT (r.source_note IS NOT NULL OR r.verification_path = 'teacher_approval')
                    OR NOT EXISTS (SELECT 1 FROM training_period tp WHERE tp.relationship_id = r.id AND tp.starts_on IS NOT NULL))) AS needs_work`);
  const rows = result.rows;
  const refs = await refsOf(db, rows.map((r) => r.root_person_id).filter((id): id is string => id !== null));
  const listed = await listedLineages(db, rows.map((r) => r.id));
  const f = figures.rows[0]!;
  return {
    figures: { lineages: f.lineages, people: f.people, links: f.links, needsWork: f.needs_work },
    rows: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      root: r.root_person_id ? (refs.get(r.root_person_id) ?? null) : null,
      people: r.people,
      links: r.links,
      generations: r.generations,
      sourced: r.sourced_pct,
      needsWork: r.needs_work,
      editedAt: iso(r.edited_at),
      listed: listed.has(r.id),
    })),
  };
}

// --- People ------------------------------------------------------------------------------------

/** archiveEditor.people: every record, found by any spelling, filtered, by name, 50 a page. */
export async function archivePeople(principal: Principal | null, raw: ArchivePeopleInput = {}): Promise<ArchivePeopleList> {
  requireArchiveEditor(principal);
  const input = parse(archivePeopleInput, raw);
  const db = getDb();
  const lineages = (
    await db.execute<{ id: string; slug: string; name: string }>(sql`SELECT id::text, slug, name FROM lineage WHERE deleted_at IS NULL ORDER BY lower(name), id LIMIT 500`)
  ).rows;
  const chosen = input.lineage ? (lineages.find((l) => l.slug === input.lineage) ?? null) : null;
  // An unknown lineage in the address matches nobody rather than everybody.
  const lineageFilter = input.lineage
    ? chosen
      ? sql`AND EXISTS (SELECT 1 FROM teaching_relationship a WHERE a.lineage_id = ${chosen.id}::uuid AND a.status IN ('verified', 'in_arbitration')
                         AND (a.teacher_person_id = p.id OR a.student_person_id = p.id))`
      : sql`AND false`
    : sql``;
  const show = {
    everyone: sql``,
    historical: sql`AND p.kind = 'historical'`,
    members: sql`AND p.stewardship = 'self'`,
    hidden: sql`AND (p.visibility <> 'public' OR p.taken_down_at IS NOT NULL)`,
    no_teacher: sql`AND NOT EXISTS (SELECT 1 FROM teaching_relationship a WHERE a.student_person_id = p.id AND a.status IN ('verified', 'in_arbitration'))`,
    duplicates: sql`AND p.id IN (SELECT person_id FROM dup)`,
  }[input.show];
  const q = input.q ? cleanName(input.q) : '';
  const search = q ? sql`AND p.id IN (${matchingPeople(q)})` : sql``;
  const offset = (input.page - 1) * ARCHIVE_GRID_PAGE_SIZE;
  // Journey review P2-10 (ADR 0086): a possible duplicate shares any spelling with another record,
  // in any script (Latin, Chinese, Cyrillic, Jyutping, pinyin), as written on at least one side.
  const dup = sql`dup AS (
      SELECT DISTINCT k.person_id FROM person_name_key k
        JOIN person_name_key o ON o.key = k.key AND o.person_id <> k.person_id AND (k.source = 'name' OR o.source = 'name')
        JOIN person op ON op.id = o.person_id AND op.deleted_at IS NULL)`;
  const result = await db.execute<{ id: string; total: number; duplicate: boolean }>(sql`
    WITH ${dup}
    SELECT p.id::text, count(*) OVER ()::int AS total, p.id IN (SELECT person_id FROM dup) AS duplicate
      FROM person p
      JOIN person_name pn ON pn.person_id = p.id AND pn.is_primary
     WHERE p.deleted_at IS NULL ${search} ${show} ${lineageFilter}
     ORDER BY lower(pn.value), p.id
     LIMIT ${ARCHIVE_GRID_PAGE_SIZE} OFFSET ${offset}`);
  const counts = await db.execute<{ no_teacher: number; duplicates: number }>(sql`
    WITH ${dup}
    SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM teaching_relationship a WHERE a.student_person_id = p.id AND a.status IN ('verified', 'in_arbitration'))
                              AND p.kind = 'historical')::int AS no_teacher,
           count(*) FILTER (WHERE p.id IN (SELECT person_id FROM dup))::int AS duplicates
      FROM person p JOIN person_name pn ON pn.person_id = p.id AND pn.is_primary
     WHERE p.deleted_at IS NULL`);
  const pageIds = result.rows.map((r) => r.id);
  const refs = await refsOf(db, pageIds);
  const facts = new Map<string, { teachers: number; students: number; lineages: { slug: string; name: string }[] }>();
  if (pageIds.length > 0) {
    const rows = await db.execute<{ person_id: string; teachers: number; students: number; lineages: { slug: string; name: string }[] | null }>(sql`
      SELECT p.id::text AS person_id,
             (SELECT count(*)::int FROM teaching_relationship a WHERE a.student_person_id = p.id AND a.status IN ('verified', 'in_arbitration')) AS teachers,
             (SELECT count(*)::int FROM teaching_relationship a WHERE a.teacher_person_id = p.id AND a.status IN ('verified', 'in_arbitration')) AS students,
             (SELECT json_agg(json_build_object('slug', l.slug, 'name', l.name) ORDER BY lower(l.name))
                FROM lineage l
               WHERE l.deleted_at IS NULL AND EXISTS (SELECT 1 FROM teaching_relationship a WHERE a.lineage_id = l.id AND a.status IN ('verified', 'in_arbitration')
                                                         AND (a.teacher_person_id = p.id OR a.student_person_id = p.id))) AS lineages
        FROM person p WHERE p.id IN (${ids(pageIds)})`);
    for (const r of rows.rows) facts.set(r.person_id, { teachers: r.teachers, students: r.students, lineages: r.lineages ?? [] });
  }
  const total = result.rows[0]?.total ?? 0;
  return {
    rows: result.rows
      .filter((r) => refs.has(r.id))
      .map((r) => {
        const f = facts.get(r.id) ?? { teachers: 0, students: 0, lineages: [] };
        return { record: refs.get(r.id)!, lineages: f.lineages, teachers: f.teachers, students: f.students, duplicate: r.duplicate };
      }),
    total,
    page: input.page,
    pages: pagesOf(total),
    pageSize: ARCHIVE_GRID_PAGE_SIZE,
    counts: { noTeacher: counts.rows[0]?.no_teacher ?? 0, duplicates: counts.rows[0]?.duplicates ?? 0 },
    lineage: chosen ? { slug: chosen.slug, name: chosen.name } : null,
    lineages: lineages.map((l) => ({ slug: l.slug, name: l.name })),
  };
}

// --- Links -------------------------------------------------------------------------------------

/** archiveEditor.links: one lineage's links, filtered and sorted, 50 a page. */
export async function archiveLinks(principal: Principal | null, raw: ArchiveLinksInput): Promise<ArchiveLinkList> {
  requireArchiveEditor(principal);
  const input = parse(archiveLinksInput, raw);
  const db = getDb();
  const line = await lineageBySlug(db, input.slug);
  const sourced = sql`(l.source_note IS NOT NULL OR l.verification_path = 'teacher_approval')`;
  const active = sql`l.status IN ('verified', 'in_arbitration')`;
  const show = {
    active: active,
    verified: sql`l.status = 'verified'`,
    in_arbitration: sql`l.status = 'in_arbitration'`,
    ended: sql`l.status = 'revoked'`,
    no_source: sql`${active} AND NOT ${sourced}`,
    no_years: sql`${active} AND l.starts_on IS NULL`,
    all: sql`true`,
  };
  const q = input.q ? cleanName(input.q) : '';
  const search = q ? sql`AND (l.teacher_person_id IN (SELECT * FROM hit) OR l.student_person_id IN (SELECT * FROM hit))` : sql``;
  const generation = input.generation ? sql`AND l.depth = ${input.generation - 1}` : sql``;
  const order = {
    generation: sql`l.depth ASC NULLS LAST, lower(l.teacher_name), lower(l.student_name), l.id`,
    teacher: sql`lower(l.teacher_name), lower(l.student_name), l.id`,
    student: sql`lower(l.student_name), lower(l.teacher_name), l.id`,
    years: sql`l.starts_on ASC NULLS LAST, lower(l.teacher_name), l.id`,
    edited: sql`l.updated_at DESC, l.id`,
  }[input.sort];
  const offset = (input.page - 1) * ARCHIVE_GRID_PAGE_SIZE;
  const links = sql`
    WITH RECURSIVE ${depthCte(sql`${line.id}::uuid`)},
    hit AS (${q ? matchingPeople(q) : sql`SELECT NULL::uuid`}),
    links AS (
      SELECT r.id, r.teacher_person_id, r.student_person_id, r.status, r.verification_path, r.source_note, r.updated_at,
             (SELECT min(tp.starts_on) FROM training_period tp WHERE tp.relationship_id = r.id) AS starts_on,
             (SELECT max(tp.ends_on) FROM training_period tp WHERE tp.relationship_id = r.id) AS ends_on,
             d.depth,
             tn.value AS teacher_name, sn.value AS student_name
        FROM teaching_relationship r
        LEFT JOIN depth d ON d.person_id = r.teacher_person_id
        LEFT JOIN person_name tn ON tn.person_id = r.teacher_person_id AND tn.is_primary
        LEFT JOIN person_name sn ON sn.person_id = r.student_person_id AND sn.is_primary
       WHERE r.lineage_id = ${line.id}::uuid AND r.status IN ('verified', 'in_arbitration', 'revoked')
    )`;
  type Row = {
    id: string;
    teacher_person_id: string;
    student_person_id: string;
    status: ArchiveLinkRow['status'];
    verification_path: ArchiveLinkRow['path'];
    source_note: string | null;
    updated_at: string;
    starts_on: string | null;
    ends_on: string | null;
    depth: number | null;
    total: number;
  };
  const select = (where: SQL, tail: SQL) =>
    db.execute<Row>(sql`${links}
    SELECT l.id::text, l.teacher_person_id::text, l.student_person_id::text, l.status, l.verification_path, l.source_note, l.updated_at,
           l.starts_on::text, l.ends_on::text, l.depth, count(*) OVER ()::int AS total
      FROM links l
     WHERE ${where} ${tail}`);
  const result = await select(sql`${show[input.show]} ${search} ${generation}`, sql`ORDER BY ${order} LIMIT ${ARCHIVE_GRID_PAGE_SIZE} OFFSET ${offset}`);
  // The link open in the side panel, whatever the filters and the page.
  const selected = input.link ? (await select(sql`l.id = ${input.link}::uuid`, sql``)).rows : [];
  const counted = await db.execute<Record<(typeof LINK_FILTERS)[number], number> & { generations: number | null }>(sql`${links}
    SELECT count(*) FILTER (WHERE ${show.active})::int AS active,
           count(*) FILTER (WHERE ${show.verified})::int AS verified,
           count(*) FILTER (WHERE ${show.in_arbitration})::int AS in_arbitration,
           count(*) FILTER (WHERE ${show.ended})::int AS ended,
           count(*) FILTER (WHERE ${show.no_source})::int AS no_source,
           count(*) FILTER (WHERE ${show.no_years})::int AS no_years,
           count(*)::int AS "all",
           (max(l.depth) FILTER (WHERE ${show.active}) + 1)::int AS generations
      FROM links l`);
  const refs = await refsOf(db, [...result.rows, ...selected].flatMap((r) => [r.teacher_person_id, r.student_person_id]));
  const total = result.rows[0]?.total ?? 0;
  const { generations, ...counts } = counted.rows[0]!;
  const view = (rows: Row[]): ArchiveLinkRow[] =>
    rows
      .filter((r) => refs.has(r.teacher_person_id) && refs.has(r.student_person_id))
      .map((r) => {
        const teacher = refs.get(r.teacher_person_id)!;
        const student = refs.get(r.student_person_id)!;
        return {
          id: r.id,
          teacher,
          student,
          generation: r.depth === null ? null : r.depth + 1,
          status: r.status,
          shown: r.status !== 'revoked' && teacher.shown && student.shown,
          fromYear: yearOf(r.starts_on),
          toYear: yearOf(r.ends_on),
          source: r.source_note,
          path: r.verification_path,
          endable: archiveKeepsLink({ status: r.status, path: r.verification_path, teacher, student }),
          editable: archiveKeepsLink({ status: r.status, path: r.verification_path, teacher, student }),
          editedAt: iso(r.updated_at)!,
        };
      });
  return {
    lineage: await lineageHead(db, line),
    rows: view(result.rows),
    selected: view(selected)[0] ?? null,
    total,
    page: input.page,
    pages: pagesOf(total),
    pageSize: ARCHIVE_GRID_PAGE_SIZE,
    counts,
    generations: generations ?? 0,
  };
}

// --- Tree --------------------------------------------------------------------------------------

interface ChildRow extends Record<string, unknown> {
  link_id: string;
  teacher_person_id: string;
  student_person_id: string;
  status: 'verified' | 'in_arbitration';
  sourced: boolean;
  starts_on: string | null;
  ends_on: string | null;
}

/** The active students of `teachers` in the lineage, at most TREE_CHILDREN_LIMIT each, by name. */
async function childrenOf(db: Executor, lineageId: string, teachers: readonly string[]): Promise<ChildRow[]> {
  if (teachers.length === 0) return [];
  const result = await db.execute<ChildRow>(sql`
    SELECT link_id, teacher_person_id, student_person_id, status, sourced, starts_on, ends_on FROM (
      SELECT r.id::text AS link_id, r.teacher_person_id::text, r.student_person_id::text, r.status,
             (r.source_note IS NOT NULL OR r.verification_path = 'teacher_approval') AS sourced,
             (SELECT min(tp.starts_on)::text FROM training_period tp WHERE tp.relationship_id = r.id) AS starts_on,
             (SELECT max(tp.ends_on)::text FROM training_period tp WHERE tp.relationship_id = r.id) AS ends_on,
             row_number() OVER (PARTITION BY r.teacher_person_id ORDER BY lower(n.value), r.student_person_id) AS place
        FROM teaching_relationship r
        LEFT JOIN person_name n ON n.person_id = r.student_person_id AND n.is_primary
       WHERE r.lineage_id = ${lineageId}::uuid AND r.status IN ('verified', 'in_arbitration') AND r.teacher_person_id IN (${ids(teachers)})
    ) x WHERE place <= ${TREE_CHILDREN_LIMIT}
    ORDER BY teacher_person_id, place`);
  return result.rows;
}

/** How many active students each person has in the lineage. */
async function studentCounts(db: Executor, lineageId: string, people: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (people.length === 0) return out;
  const result = await db.execute<{ id: string; n: number }>(sql`
    SELECT r.teacher_person_id::text AS id, count(*)::int AS n FROM teaching_relationship r
     WHERE r.lineage_id = ${lineageId}::uuid AND r.status IN ('verified', 'in_arbitration') AND r.teacher_person_id IN (${ids(people)})
     GROUP BY r.teacher_person_id`);
  for (const r of result.rows) out.set(r.id, r.n);
  return out;
}

/**
 * archiveEditor.tree: the root (or, without one, the people at the top: teachers of the lineage who
 * have no teacher in it) and the students of each open branch, level by level. Only the branches in
 * `open` are read, so a lineage of any size answers in a few small queries.
 */
export async function archiveTree(principal: Principal | null, raw: z.input<typeof archiveTreeInput>): Promise<ArchiveTree> {
  requireArchiveEditor(principal);
  const input = parse(archiveTreeInput, raw);
  const db = getDb();
  const line = await lineageBySlug(db, input.slug);
  let topIds: string[];
  let topTotal: number;
  if (line.rootPersonId) {
    topIds = [line.rootPersonId];
    topTotal = 1;
  } else {
    const tops = await db.execute<{ id: string; total: number }>(sql`
      SELECT r.teacher_person_id::text AS id, count(*) OVER ()::int AS total
        FROM teaching_relationship r
        LEFT JOIN person_name n ON n.person_id = r.teacher_person_id AND n.is_primary
       WHERE r.lineage_id = ${line.id}::uuid AND r.status IN ('verified', 'in_arbitration')
         AND NOT EXISTS (SELECT 1 FROM teaching_relationship u WHERE u.lineage_id = r.lineage_id AND u.student_person_id = r.teacher_person_id
                           AND u.status IN ('verified', 'in_arbitration'))
       GROUP BY r.teacher_person_id, n.value
       ORDER BY lower(n.value), r.teacher_person_id
       LIMIT ${TREE_CHILDREN_LIMIT}`);
    topIds = tops.rows.map((r) => r.id);
    topTotal = tops.rows[0]?.total ?? 0;
  }
  const openSlugs = new Set(input.open);

  // Level by level: the open people of this level, then their students.
  const slugOf = new Map<string, string>();
  const refs = await refsOf(db, topIds);
  for (const [id, ref] of refs) slugOf.set(id, ref.slug);
  const childRows = new Map<string, ChildRow[]>();
  const seen = new Set<string>(topIds);
  let level = topIds.filter((id) => openSlugs.has(slugOf.get(id) ?? ''));
  for (let depth = 0; level.length > 0 && depth < MAX_DEPTH; depth += 1) {
    const rows = await childrenOf(db, line.id, level);
    const fresh = [...new Set(rows.map((r) => r.student_person_id))].filter((id) => !refs.has(id));
    for (const [id, ref] of await refsOf(db, fresh)) {
      refs.set(id, ref);
      slugOf.set(id, ref.slug);
    }
    for (const r of rows) childRows.set(r.teacher_person_id, [...(childRows.get(r.teacher_person_id) ?? []), r]);
    const next: string[] = [];
    for (const r of rows) {
      if (seen.has(r.student_person_id)) continue;
      seen.add(r.student_person_id);
      if (openSlugs.has(slugOf.get(r.student_person_id) ?? '')) next.push(r.student_person_id);
    }
    level = next;
  }
  const counts = await studentCounts(db, line.id, [...refs.keys()]);

  const build = (personId: string, generation: number, link: ChildRow | null, path: Set<string>): ArchiveTreeNode | null => {
    const record = refs.get(personId);
    if (!record) return null;
    const own = childRows.get(personId);
    const inner = new Set(path).add(personId);
    return {
      record,
      generation,
      link: link ? { id: link.link_id, status: link.status, sourced: link.sourced, fromYear: yearOf(link.starts_on), toYear: yearOf(link.ends_on) } : null,
      students: counts.get(personId) ?? 0,
      children:
        own && !path.has(personId)
          ? own.map((c) => build(c.student_person_id, generation + 1, c, inner)).filter((n): n is ArchiveTreeNode => n !== null)
          : null,
    };
  };
  return {
    lineage: await lineageHead(db, line),
    top: topIds.map((id) => build(id, 1, null, new Set())).filter((n): n is ArchiveTreeNode => n !== null),
    topTotal,
  };
}

/** archiveEditor.person: one person in one lineage, for the outline's side panel. */
export async function archivePerson(principal: Principal | null, raw: z.input<typeof archivePersonInput>): Promise<ArchivePersonView> {
  requireArchiveEditor(principal);
  const input = parse(archivePersonInput, raw);
  const db = getDb();
  const line = await lineageBySlug(db, input.slug);
  const found = await db.execute<{ id: string }>(sql`SELECT id::text FROM person WHERE slug = ${input.person} AND deleted_at IS NULL`);
  const personId = found.rows[0]?.id;
  if (!personId) throw new ServiceError('NOT_FOUND', 'No record has this address.');
  const links = await db.execute<ChildRow & { source_note: string | null }>(sql`
    SELECT r.id::text AS link_id, r.teacher_person_id::text, r.student_person_id::text, r.status, r.source_note,
           (r.source_note IS NOT NULL OR r.verification_path = 'teacher_approval') AS sourced,
           (SELECT min(tp.starts_on)::text FROM training_period tp WHERE tp.relationship_id = r.id) AS starts_on,
           (SELECT max(tp.ends_on)::text FROM training_period tp WHERE tp.relationship_id = r.id) AS ends_on
      FROM teaching_relationship r
      LEFT JOIN person_name n ON n.person_id = CASE WHEN r.teacher_person_id = ${personId}::uuid THEN r.student_person_id ELSE r.teacher_person_id END AND n.is_primary
     WHERE r.lineage_id = ${line.id}::uuid AND r.status IN ('verified', 'in_arbitration')
       AND (r.teacher_person_id = ${personId}::uuid OR r.student_person_id = ${personId}::uuid)
     ORDER BY lower(n.value), r.id
     LIMIT 500`);
  const depth = await db.execute<{ depth: number }>(sql`
    WITH RECURSIVE ${depthCte(sql`${line.id}::uuid`)}
    SELECT depth FROM depth WHERE person_id = ${personId}::uuid`);
  const others = await db.execute<{ slug: string; name: string }>(sql`
    SELECT l.slug, l.name FROM lineage l
     WHERE l.deleted_at IS NULL AND l.id <> ${line.id}::uuid
       AND EXISTS (SELECT 1 FROM teaching_relationship a WHERE a.lineage_id = l.id AND a.status IN ('verified', 'in_arbitration')
                     AND (a.teacher_person_id = ${personId}::uuid OR a.student_person_id = ${personId}::uuid))
     ORDER BY lower(l.name) LIMIT 50`);
  const rows = links.rows;
  const refs = await refsOf(db, [personId, ...rows.flatMap((r) => [r.teacher_person_id, r.student_person_id])]);
  const studentRows = rows.filter((r) => r.teacher_person_id === personId);
  const counts = await studentCounts(db, line.id, studentRows.map((r) => r.student_person_id));
  const view = (r: ChildRow, otherId: string): ArchivePersonLink | null => {
    const other = refs.get(otherId);
    if (!other) return null;
    return { id: r.link_id, other, status: r.status, sourced: r.sourced, fromYear: yearOf(r.starts_on), toYear: yearOf(r.ends_on), students: counts.get(otherId) ?? 0 };
  };
  const record = refs.get(personId);
  if (!record) throw new ServiceError('NOT_FOUND', 'No record has this address.');
  const students = studentRows.slice(0, 100).map((r) => view(r, r.student_person_id)).filter((v): v is ArchivePersonLink => v !== null);
  return {
    record,
    generation: depth.rows[0] ? depth.rows[0].depth + 1 : null,
    teachers: rows
      .filter((r) => r.student_person_id === personId)
      .map((r) => view(r, r.teacher_person_id))
      .filter((v): v is ArchivePersonLink => v !== null),
    students,
    studentsTotal: studentRows.length,
    lineages: others.rows,
    sources: [...new Set(rows.map((r) => r.source_note).filter((s): s is string => s !== null))].slice(0, 5),
  };
}
