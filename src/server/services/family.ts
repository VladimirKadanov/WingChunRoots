// The kung fu family (owner decision 2026-11-18, docs/adr/0048-kung-fu-family.md): what the plans
// with `kung_fu_family` (Premium Student, Professional Sifu) add to the dashboard.
//
//   family.get        the account's own family: its teachers, the classmates under each of them
//                     (senior, junior or the same year, by when each began with that teacher) and
//                     the cousins (the students of the teachers' own training brothers and sisters),
//                     with an optional country filter; every person marked when the account follows
//                     them and when they joined in the last 7 days
//   follows.list      the people the account follows, with their current rank
//   follows.add       follow a public person (not yourself), at most FOLLOWS_MAX
//   follows.remove    stop following; on any plan, so a lower plan can still tidy the list
//   runFamilyDigest() the weekly digest (the job family.digest): counts only, never a name
//
// Privacy (plan §6.4): the family is built only from v_public_person and v_public_edge, so it shows
// exactly the people and relationships anyone can see on the lineage pages, never a private one; the
// account's own teachers come from its own relationships. Follows are private: nobody, the person
// followed included, ever sees who follows whom, nor how many; no audit row (they are not a change
// to the archive), and logs carry counts only. On a lower plan the follows are kept, the page and
// the digest stop (DEFAULT D08). Nothing here is cached: it is the account's own page.

import { and, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb, type Database } from '../db';
import { person, personFollow } from '../db/schema';
import { SLUG_PATTERN } from '../db/schema/persons';
import { effectivePlan, effectivePlansOf, type Executor } from '../entitlements/access';
import { feature, type PlanCode } from '../entitlements/plans';
import type { NameData } from '../templates/email/types';
import { ServiceError } from './errors';
import { notify, type NoticeProducer } from './notify';

/** DEFAULT ADR 0048: an account follows at most 500 people. */
export const FOLLOWS_MAX = 500;
/** "New" in the family and the digest: the last 7 days. */
export const FAMILY_NEW_DAYS = 7;
/** DEFAULT ADR 0048: at most 200 people per list on the page, the nearest first. */
const LIST_MAX = 200;

const NO_PROFILE = 'You have no profile yet. Finish setting up your profile first.';
const NEEDS_PLAN = 'Your kung fu family is part of Premium Student and Professional Sifu.';
const NO_PERSON = 'No such person.';

/** Whether this plan includes the kung fu family (the matrix decides, ADR 0048). */
export function familyIncluded(plan: PlanCode | undefined): boolean {
  return plan !== undefined && feature('kung_fu_family').values[plan].included;
}

async function accountFamily(db: Executor, userId: string): Promise<boolean> {
  const { plan } = await effectivePlan({ kind: 'user', userId }, { db });
  return familyIncluded(plan);
}

async function ownPersonId(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row?.id ?? null;
}

const slugField = z
  .string()
  .min(1, { error: 'Must be a profile address.' })
  .max(120, { error: 'Must be a profile address.' })
  .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' });

export const familyGetInput = z
  .object({
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, { error: 'Must be a two-letter country code.' })
      .optional(),
  })
  .default({});
export const followInput = z.object({ slug: slugField });

export interface FamilyPerson {
  slug: string;
  name: NameData;
  countryCode: string | null;
  /** True when the account follows this person. */
  followed: boolean;
  /** True when their relationship became public in the last FAMILY_NEW_DAYS days. */
  isNew: boolean;
}

/** Senior, junior or the same year as the account under the same teacher; null when a start is not known. */
export type Seniority = 'senior' | 'junior' | 'same_year' | null;

export interface FamilyClassmate extends FamilyPerson {
  /** The year they began with this teacher, when recorded. */
  startYear: number | null;
  seniority: Seniority;
}

export interface FamilyBranch {
  teacher: FamilyPerson;
  /** The year the account began with this teacher, when recorded. */
  ownStartYear: number | null;
  classmates: FamilyClassmate[];
}

export interface FamilyCousinGroup {
  /** The training brother or sister of the account's teacher whose students these are. */
  teacher: FamilyPerson;
  /** Which of the account's teachers they trained alongside. */
  via: { slug: string; name: NameData };
  cousins: FamilyPerson[];
}

export interface FamilyAnswer {
  /** Whether the plan includes the family page (kept, not shown, on a lower plan). */
  allowed: boolean;
  branches: FamilyBranch[];
  cousins: FamilyCousinGroup[];
  /** The countries of the people in the family, for the filter (codes, sorted). */
  countries: string[];
  country: string | null;
  follows: number;
  followsMax: number;
}

interface PersonRow extends Record<string, unknown> {
  id: string;
  slug: string;
  display_name: string;
  lang: string | null;
  country_code: string | null;
}

const LANG_OF = sql.raw(`(SELECT n.lang FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1)`);

const nameOf = (r: PersonRow): NameData => ({ value: r.display_name, lang: r.lang ?? 'und-Latn' });

function yearOf(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const year = Number.parseInt(text.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function seniorityOf(own: number | null, theirs: number | null): Seniority {
  if (own === null || theirs === null) return null;
  if (theirs < own) return 'senior';
  if (theirs > own) return 'junior';
  return 'same_year';
}

/** The ids the account follows, among these. */
async function followedAmong(db: Executor, userId: string, personIds: readonly string[]): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const ids = sql.join(
    [...new Set(personIds)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{ person_id: string }>(sql`SELECT person_id FROM person_follow WHERE follower_user_id = ${userId}::uuid AND person_id IN (${ids})`);
  return new Set(rows.rows.map((r) => r.person_id));
}

async function followCount(db: Executor, userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person_follow WHERE follower_user_id = ${userId}::uuid`);
  return rows.rows[0]?.n ?? 0;
}

/** family.get: the account's own kung fu family, as the public lineage shows it. */
export async function familyGet(principal: Principal | null, raw: z.input<typeof familyGetInput> = {}): Promise<FamilyAnswer> {
  const p = requireUser(principal);
  const parsed = familyGetInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Must be a two-letter country code.', { country: 'Must be a two-letter country code.' });
  const country = parsed.data.country ?? null;
  const db = getDb();
  const own = await ownPersonId(db, p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
  const follows = await followCount(db, p.user.id);
  const empty: FamilyAnswer = { allowed: false, branches: [], cousins: [], countries: [], country, follows, followsMax: FOLLOWS_MAX };
  if (!(await accountFamily(db, p.user.id))) return empty;

  // The account's teachers: its own verified relationships, to a teacher who is public.
  const teachers = await db.execute<PersonRow & { own_start: string | Date | null }>(sql`
    SELECT p.id, p.slug, p.display_name, ${LANG_OF} AS lang, p.country_code,
           (SELECT min(tp.starts_on) FROM training_period tp
             WHERE tp.relationship_id = r.id AND tp.starts_on IS NOT NULL AND tp.precision <> 'unknown') AS own_start
      FROM teaching_relationship r
      JOIN v_public_person p ON p.id = r.teacher_person_id
     WHERE r.student_person_id = ${own}::uuid AND r.status IN ('verified', 'in_arbitration')
     ORDER BY p.display_name, p.id`);
  if (teachers.rows.length === 0) return { ...empty, allowed: true };
  const teacherIds = teachers.rows.map((t) => t.id);
  const teacherList = sql.join(
    teacherIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const since = new Date(Date.now() - FAMILY_NEW_DAYS * 86_400_000);

  // Classmates: the other public students of each teacher.
  const classmates = await db.execute<PersonRow & { teacher_id: string; start: string | null; confirmed_at: string | Date | null }>(sql`
    SELECT e.teacher_person_id AS teacher_id, p.id, p.slug, p.display_name, ${LANG_OF} AS lang, p.country_code, e.confirmed_at,
           (SELECT min(x->>'startsOn') FROM jsonb_array_elements(e.periods) x
             WHERE x->>'startsOn' IS NOT NULL AND x->>'precision' <> 'unknown') AS start
      FROM v_public_edge e
      JOIN v_public_person p ON p.id = e.student_person_id
     WHERE e.teacher_person_id IN (${teacherList}) AND e.student_person_id <> ${own}::uuid
     ORDER BY start NULLS LAST, p.display_name, p.id`);

  // Cousins: the students of the teachers' training brothers and sisters (the other public students
  // of the teachers' own teachers), who are not the account's teachers, classmates or the account.
  const cousins = await db.execute<PersonRow & { uncle_id: string; uncle_slug: string; uncle_name: string; uncle_lang: string | null; uncle_country: string | null; via_id: string; confirmed_at: string | Date | null }>(sql`
    SELECT DISTINCT ON (u.id, p.id)
           u.id AS uncle_id, u.slug AS uncle_slug, u.display_name AS uncle_name,
           (SELECT n.lang FROM person_name n WHERE n.person_id = u.id AND n.is_primary LIMIT 1) AS uncle_lang, u.country_code AS uncle_country,
           mine.student_person_id AS via_id,
           p.id, p.slug, p.display_name, ${LANG_OF} AS lang, p.country_code, c.confirmed_at
      FROM v_public_edge mine
      JOIN v_public_edge sib ON sib.teacher_person_id = mine.teacher_person_id AND sib.student_person_id <> mine.student_person_id
      JOIN v_public_person u ON u.id = sib.student_person_id
      JOIN v_public_edge c ON c.teacher_person_id = u.id
      JOIN v_public_person p ON p.id = c.student_person_id
     WHERE mine.student_person_id IN (${teacherList})
       AND u.id NOT IN (${teacherList})
       AND p.id <> ${own}::uuid
       AND p.id NOT IN (${teacherList})
       AND NOT EXISTS (SELECT 1 FROM v_public_edge cm WHERE cm.student_person_id = p.id AND cm.teacher_person_id IN (${teacherList}))
     ORDER BY u.id, p.id, mine.student_person_id`);

  const everyone = [...teachers.rows.map((t) => t.id), ...classmates.rows.map((c) => c.id), ...cousins.rows.flatMap((c) => [c.id, c.uncle_id])];
  const followed = await followedAmong(db, p.user.id, everyone);
  const countries = new Set<string>();
  for (const r of [...classmates.rows, ...cousins.rows]) if (r.country_code) countries.add(r.country_code);
  const inCountry = (r: { country_code: string | null }) => country === null || r.country_code === country;
  const isNew = (at: string | Date | null) => at !== null && new Date(at).getTime() >= since.getTime();
  const personOf = (r: PersonRow, at: string | Date | null = null): FamilyPerson => ({
    slug: r.slug,
    name: nameOf(r),
    countryCode: r.country_code,
    followed: followed.has(r.id),
    isNew: isNew(at),
  });

  const branches: FamilyBranch[] = teachers.rows.map((t) => {
    const ownStartYear = yearOf(t.own_start);
    return {
      teacher: personOf(t),
      ownStartYear,
      classmates: classmates.rows
        .filter((c) => c.teacher_id === t.id && inCountry(c))
        .slice(0, LIST_MAX)
        .map((c) => {
          const startYear = yearOf(c.start);
          return { ...personOf(c, c.confirmed_at), startYear, seniority: seniorityOf(ownStartYear, startYear) };
        }),
    };
  });

  const teacherById = new Map(teachers.rows.map((t) => [t.id, t]));
  const groups = new Map<string, FamilyCousinGroup>();
  for (const r of cousins.rows) {
    if (!inCountry(r)) continue;
    let group = groups.get(r.uncle_id);
    if (!group) {
      const via = teacherById.get(r.via_id)!;
      group = {
        teacher: personOf({ id: r.uncle_id, slug: r.uncle_slug, display_name: r.uncle_name, lang: r.uncle_lang, country_code: r.uncle_country }),
        via: { slug: via.slug, name: nameOf(via) },
        cousins: [],
      };
      groups.set(r.uncle_id, group);
    }
    if (group.cousins.some((c) => c.slug === r.slug) || group.cousins.length >= LIST_MAX) continue;
    group.cousins.push(personOf(r, r.confirmed_at));
  }
  const cousinGroups = [...groups.values()]
    .filter((g) => g.cousins.length > 0)
    .sort((a, b) => a.teacher.name.value.localeCompare(b.teacher.name.value, 'en'))
    .map((g) => ({ ...g, cousins: g.cousins.sort((a, b) => a.name.value.localeCompare(b.name.value, 'en')) }));

  return { allowed: true, branches, cousins: cousinGroups, countries: [...countries].sort(), country, follows, followsMax: FOLLOWS_MAX };
}

// --- Follows --------------------------------------------------------------------------------------

export interface FollowedPerson {
  slug: string;
  name: NameData;
  /** Their current public rank, when they have one. */
  rank: string | null;
  /** True when a public rank of theirs was added in the last FAMILY_NEW_DAYS days. */
  newRank: boolean;
}

export interface FollowsAnswer {
  allowed: boolean;
  people: FollowedPerson[];
  max: number;
}

/** follows.list: the public people the account follows (a follow of someone no longer public is kept, not shown). */
export async function followsList(principal: Principal | null): Promise<FollowsAnswer> {
  const p = requireUser(principal);
  const db = getDb();
  const allowed = await accountFamily(db, p.user.id);
  const since = new Date(Date.now() - FAMILY_NEW_DAYS * 86_400_000);
  const rows = await db.execute<PersonRow & { rank: string | null; new_rank: boolean }>(sql`
    SELECT p.id, p.slug, p.display_name, ${LANG_OF} AS lang, p.country_code,
           (SELECT r.title FROM v_public_passport r WHERE r.person_id = p.id AND r.kind = 'rank'
             ORDER BY r.on_date DESC NULLS LAST, r.created_at DESC LIMIT 1) AS rank,
           EXISTS (SELECT 1 FROM v_public_passport r WHERE r.person_id = p.id AND r.kind = 'rank' AND r.created_at >= ${since}) AS new_rank
      FROM person_follow f
      JOIN v_public_person p ON p.id = f.person_id
     WHERE f.follower_user_id = ${p.user.id}::uuid
     ORDER BY p.display_name, p.id`);
  return { allowed, people: rows.rows.map((r) => ({ slug: r.slug, name: nameOf(r), rank: r.rank, newRank: r.new_rank === true })), max: FOLLOWS_MAX };
}

/** follows.add: follow a public person; NOT_FOUND for anyone not public, refused at the plan and at FOLLOWS_MAX. */
export async function followAdd(principal: Principal | null, raw: z.input<typeof followInput>): Promise<{ slug: string; followed: true }> {
  const p = requireUser(principal);
  const parsed = followInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_PERSON);
  const db = getDb();
  return db.transaction(async (tx) => {
    // One account at a time, so the limit holds under concurrent adds.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`person_follow:${p.user.id}`}, 0))`);
    const found = await tx.execute<{ id: string; slug: string }>(sql`SELECT id, slug FROM v_public_person WHERE slug = ${parsed.data.slug} LIMIT 1`);
    const target = found.rows[0];
    if (!target) throw new ServiceError('NOT_FOUND', NO_PERSON);
    if (!(await accountFamily(tx, p.user.id))) throw new ServiceError('ENTITLEMENT_REQUIRED', NEEDS_PLAN);
    const own = await ownPersonId(tx, p.user.id);
    if (own === target.id) throw new ServiceError('BAD_REQUEST', 'You cannot follow yourself.');
    const already = await followedAmong(tx, p.user.id, [target.id]);
    if (!already.has(target.id)) {
      if ((await followCount(tx, p.user.id)) >= FOLLOWS_MAX) throw new ServiceError('CONFLICT', `You can follow at most ${FOLLOWS_MAX} people. Unfollow someone first.`);
      await tx.insert(personFollow).values({ followerUserId: p.user.id, personId: target.id }).onConflictDoNothing();
    }
    return { slug: target.slug, followed: true as const };
  });
}

/** follows.remove: stop following, on any plan; answers the same whether or not the account followed them. */
export async function followRemove(principal: Principal | null, raw: z.input<typeof followInput>): Promise<{ slug: string; followed: false }> {
  const p = requireUser(principal);
  const parsed = followInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_PERSON);
  const db = getDb();
  await db.execute(sql`
    DELETE FROM person_follow f USING person pe
     WHERE f.person_id = pe.id AND pe.slug = ${parsed.data.slug} AND f.follower_user_id = ${p.user.id}::uuid`);
  return { slug: parsed.data.slug, followed: false };
}

/** Whether the account follows this public person, and whether its plan lets it follow (the person page's button). */
export async function followState(principal: Principal | null, slug: string): Promise<{ allowed: boolean; followed: boolean; self: boolean } | null> {
  if (!principal) return null;
  const db = getDb();
  const found = await db.execute<{ id: string }>(sql`SELECT id FROM v_public_person WHERE slug = ${slug} LIMIT 1`);
  const target = found.rows[0];
  if (!target) return null;
  const own = await ownPersonId(db, principal.user.id);
  const [allowed, followed] = await Promise.all([accountFamily(db, principal.user.id), followedAmong(db, principal.user.id, [target.id])]);
  return { allowed, followed: followed.has(target.id), self: own === target.id };
}

// --- The weekly digest (the job family.digest) ----------------------------------------------------

/** The ISO week of a date, as "2026-W47" (the key of one digest per account and week). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface FamilyDigestResult {
  accounts: number;
  notices: number;
}

/**
 * The weekly digest: to every account whose plan includes the family, how many public students
 * joined under its teachers in the last 7 days and how many of the people it follows have a new
 * public rank. Counts only; the names are on the family page, read when it is opened (so someone who
 * has since become private is never named). Nothing when both are zero. One notice per account and
 * ISO week (key family.digest:<week>), so a rerun sends nothing more.
 */
export async function runFamilyDigest(db: Database, now = new Date(), boss?: NoticeProducer): Promise<FamilyDigestResult> {
  const since = new Date(now.getTime() - FAMILY_NEW_DAYS * 86_400_000);
  const rows = await db.execute<{ user_id: string; joined: number; ranks: number }>(sql`
    WITH accounts AS (
      SELECT pe.claimed_by_user_id AS user_id, pe.id AS person_id
        FROM person pe
       WHERE pe.claimed_by_user_id IS NOT NULL AND pe.deleted_at IS NULL
         AND (EXISTS (SELECT 1 FROM teaching_relationship r WHERE r.student_person_id = pe.id AND r.status IN ('verified', 'in_arbitration'))
              OR EXISTS (SELECT 1 FROM person_follow f WHERE f.follower_user_id = pe.claimed_by_user_id))
    )
    SELECT a.user_id,
           (SELECT count(DISTINCT e.student_person_id)::int
              FROM teaching_relationship r
              JOIN v_public_person t ON t.id = r.teacher_person_id
              JOIN v_public_edge e ON e.teacher_person_id = t.id
             WHERE r.student_person_id = a.person_id AND r.status IN ('verified', 'in_arbitration')
               AND e.student_person_id <> a.person_id AND e.confirmed_at >= ${since} AND e.confirmed_at < ${now}) AS joined,
           (SELECT count(DISTINCT f.person_id)::int
              FROM person_follow f
              JOIN v_public_passport rk ON rk.person_id = f.person_id AND rk.kind = 'rank'
             WHERE f.follower_user_id = a.user_id AND rk.created_at >= ${since} AND rk.created_at < ${now}) AS ranks
      FROM accounts a`);
  const candidates = rows.rows.filter((r) => r.joined > 0 || r.ranks > 0);
  const result: FamilyDigestResult = { accounts: 0, notices: 0 };
  if (candidates.length === 0) return result;
  const plans = await effectivePlansOf(
    db,
    candidates.map((r) => r.user_id),
    now,
  );
  const week = isoWeek(now);
  for (const r of candidates) {
    if (!familyIncluded(plans.get(r.user_id))) continue;
    result.accounts += 1;
    const sent = await db.transaction((tx) => notify(tx, r.user_id, 'family.digest', { week, joined: r.joined, ranks: r.ranks }, { key: `family.digest:${week}`, boss }));
    if (sent.notified) result.notices += 1;
  }
  return result;
}
