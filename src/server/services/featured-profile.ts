// The featured profile (owner decision 2026-11-18, docs/adr/0047-featured-profile.md): what the
// plans with `featured_profile` (Premium Student, Professional Sifu) add to a profile. This file
// holds its links and the search card; the longer biography is in profile.ts and the training
// timeline in passport.ts, each asking featuredIncluded() below.
//
//   people.links            public: the links of a public person whose plan includes them
//   profile.links           the account's own links, and whether the plan lets it change them
//   profile.setLinks        up to 5 links (a label and an https address), in order; audited
//   profile.removeLink      staff with a verified second factor, with a reason; the owner is told
//   featuredSearchCards()   the rank and school a search result shows (search.ts); never the order
//
// Paying never shows anyone: the links are read only for a person in v_public_person (consent to
// publication, ADR 0031; not taken down). On a lower plan they are kept and not shown (DEFAULT D08).
// The public answer is the same for every viewer, so it is cached; the plan can end by date, so
// the entry lives for minutes (as the school members page, ADR 0044). Audit rows carry counts and
// ids, never a label or an address.

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, personTag, tagCacheEntry } from '../cache';
import { getDb } from '../db';
import { type ProfileLinksDto, toPublicProfileLinks } from '../dto/public';
import { person, personLink } from '../db/schema';
import { PROFILE_LINK_LABEL_MAX, PROFILE_LINK_URL_MAX, PROFILE_LINKS_MAX } from '../db/schema/common';
import { SLUG_PATTERN } from '../db/schema/persons';
import { effectivePlan, effectivePlansOf, type Executor } from '../entitlements/access';
import { feature, type PlanCode } from '../entitlements/plans';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notify } from './notify';

const NO_PROFILE = 'You have no profile yet. Finish setting up your profile first.';
const NEEDS_PLAN = 'Links on your profile are part of Premium Student and Professional Sifu.';
const NO_LINK = 'No such link.';
const LABEL_MESSAGE = `Give the link a name of at most ${PROFILE_LINK_LABEL_MAX} characters.`;
const URL_MESSAGE = `Enter a full address that starts with https://, at most ${PROFILE_LINK_URL_MAX} characters.`;

/** Whether this plan includes the featured profile (the matrix decides, ADR 0047). */
export function featuredIncluded(plan: PlanCode | undefined): boolean {
  return plan !== undefined && feature('featured_profile').values[plan].included;
}

/** Whether the account's plan in force includes the featured profile. */
export async function accountFeatured(db: Executor, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { plan } = await effectivePlan({ kind: 'user', userId }, { db });
  return featuredIncluded(plan);
}

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
}

export const profileLinksInput = z.object({
  slug: z
    .string()
    .min(1, { error: 'Must be a profile address.' })
    .max(120, { error: 'Must be a profile address.' })
    .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' }),
});

export const setProfileLinksInput = z.object({
  links: z
    .array(z.object({ label: z.string().max(PROFILE_LINK_LABEL_MAX * 4), url: z.string().max(PROFILE_LINK_URL_MAX * 2) }))
    .max(PROFILE_LINKS_MAX, { error: `Add at most ${PROFILE_LINKS_MAX} links.` }),
});

export const removeProfileLinkInput = z.object({ id: z.uuid({ error: NO_LINK }), reason: z.string().max(2000) });

/** A label on one line, NFC. */
const oneLine = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

/** The address as stored: https only, no credentials, a host with a dot; null when it is none of these. */
export function cleanLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > PROFILE_LINK_URL_MAX || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.port) return null;
  const href = url.href;
  return href.length <= PROFILE_LINK_URL_MAX ? href : null;
}

async function linksOf(db: Executor, personId: string): Promise<ProfileLink[]> {
  return db
    .select({ id: personLink.id, label: personLink.label, url: personLink.url })
    .from(personLink)
    .where(eq(personLink.personId, personId))
    .orderBy(asc(personLink.position));
}

type LinkPersonRow = { id: string; user_id: string | null } & Record<string, unknown>;

async function cachedProfileLinks(slug: string): Promise<ProfileLinksDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const found = await db.execute<LinkPersonRow>(sql`
    SELECT p.id, pe.claimed_by_user_id AS user_id
      FROM v_public_person p
      JOIN person pe ON pe.id = p.id AND pe.deleted_at IS NULL
     WHERE p.slug = ${slug}
     LIMIT 1`);
  const row = found.rows[0];
  if (!row) return null;
  tagCacheEntry([personTag(row.id)]);
  if (!row.user_id) return toPublicProfileLinks({ links: [] });
  const plans = await effectivePlansOf(db, [row.user_id], new Date());
  if (!featuredIncluded(plans.get(row.user_id))) return toPublicProfileLinks({ links: [] });
  return toPublicProfileLinks({ links: await linksOf(db, row.id) });
}

/** people.links: the links of a public person whose plan includes them (none otherwise); NOT_FOUND for anyone not public. */
export async function profileLinks(_principal: Principal | null, raw: z.input<typeof profileLinksInput>): Promise<ProfileLinksDto> {
  const parsed = profileLinksInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such person.');
  const answer = await cachedProfileLinks(parsed.data.slug);
  if (!answer) throw new ServiceError('NOT_FOUND', 'No such person.');
  return answer;
}

async function ownPersonRow(db: Executor, userId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row ?? null;
}

export interface OwnProfileLinks {
  links: ProfileLink[];
  /** Whether the plan lets the account change them (kept, not shown, on a lower plan). */
  allowed: boolean;
  limit: number;
}

/** profile.links: the account's own links. */
export async function myProfileLinks(principal: Principal | null): Promise<OwnProfileLinks> {
  const p = requireUser(principal);
  const db = getDb();
  const own = await ownPersonRow(db, p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
  return { links: await linksOf(db, own.id), allowed: await accountFeatured(db, p.user.id), limit: PROFILE_LINKS_MAX };
}

/**
 * profile.setLinks: the account's own links, in the order given, replacing the ones saved; an
 * empty list removes them all. Refused at the plan with ENTITLEMENT_REQUIRED; a field error names
 * the row (`links.<n>.label` / `links.<n>.url`).
 */
export async function setProfileLinks(principal: Principal | null, raw: z.input<typeof setProfileLinksInput>, meta: RequestMeta): Promise<{ links: ProfileLink[] }> {
  const p = requireUser(principal);
  const parsed = setProfileLinksInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', `Add at most ${PROFILE_LINKS_MAX} links.`, { links: `Add at most ${PROFILE_LINKS_MAX} links.` });
  const fields: Record<string, string> = {};
  const clean = parsed.data.links.map((link, i) => {
    const label = oneLine(link.label);
    const url = cleanLinkUrl(link.url);
    if (label.length === 0 || label.length > PROFILE_LINK_LABEL_MAX) fields[`links.${i}.label`] = LABEL_MESSAGE;
    if (!url) fields[`links.${i}.url`] = URL_MESSAGE;
    return { label, url: url ?? '' };
  });
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const own = await ownPersonRow(tx, p.user.id);
    if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
    await tx.execute(sql`SELECT 1 FROM person WHERE id = ${own.id}::uuid FOR UPDATE`);
    if (!(await accountFeatured(tx, p.user.id))) throw new ServiceError('ENTITLEMENT_REQUIRED', NEEDS_PLAN);
    const before = await linksOf(tx, own.id);
    const same = before.length === clean.length && before.every((b, i) => b.label === clean[i]!.label && b.url === clean[i]!.url);
    if (!same) {
      await tx.delete(personLink).where(eq(personLink.personId, own.id));
      if (clean.length > 0) await tx.insert(personLink).values(clean.map((link, position) => ({ personId: own.id, position, label: link.label, url: link.url })));
      await writeAudit(tx, {
        action: 'person.links',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
        subjectType: 'person',
        subjectId: own.id,
        before: { links: before.length },
        after: { links: clean.length },
      });
    }
    return { personId: own.id, changed: !same, links: await linksOf(tx, own.id) };
  });
  if (result.changed) invalidatePublic([personTag(result.personId)], 'procedure');
  return { links: result.links };
}

/** profile.removeLink: staff with a verified second factor remove one link, with a reason the owner is sent. */
export async function removeProfileLink(principal: Principal | null, raw: z.input<typeof removeProfileLinkInput>, meta: RequestMeta): Promise<{ id: string; removed: boolean }> {
  const p = requireStaff2FA(principal);
  const parsed = removeProfileLinkInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_LINK);
  const reason = parsed.data.reason.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const message = 'Say why the link is removed: the reason is kept in the audit log and sent to its owner.';
  if (reason.length === 0 || reason.length > 1000) throw new ServiceError('BAD_REQUEST', message, { reason: message });
  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const [link] = await tx
      .select({ id: personLink.id, personId: personLink.personId, owner: person.claimedByUserId })
      .from(personLink)
      .innerJoin(person, eq(person.id, personLink.personId))
      .where(eq(personLink.id, parsed.data.id))
      .for('update');
    if (!link) throw new ServiceError('NOT_FOUND', NO_LINK);
    await tx.delete(personLink).where(eq(personLink.id, link.id));
    // The rest keep their order without a gap.
    await tx.execute(sql`
      UPDATE person_link l SET position = n.rn - 1, updated_at = now()
        FROM (SELECT id, row_number() OVER (ORDER BY position) AS rn FROM person_link WHERE person_id = ${link.personId}::uuid) n
       WHERE l.id = n.id AND l.position <> n.rn - 1`);
    await writeAudit(tx, {
      action: 'person.link_remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
      subjectType: 'person_link',
      subjectId: link.id,
      before: { personId: link.personId },
      after: null,
      reason,
    });
    if (link.owner && link.owner !== p.user.id) await notify(tx, link.owner, 'content.removed', { content: 'profile_link', reason }, { key: `content.removed:profile_link:${link.id}` });
    return link.personId;
  });
  invalidatePublic([personTag(outcome)], 'procedure');
  return { id: parsed.data.id, removed: true };
}

// --- The search card (ADR 0047) --------------------------------------------------------------------

export interface FeaturedSearchCard {
  /** The latest public rank of the passport, or null. */
  rank: string | null;
  /** A public school: the one the person teaches at, else the one of their latest training period. */
  school: { slug: string; name: string } | null;
}

interface CardRow extends Record<string, unknown> {
  id: string;
  user_id: string | null;
  rank: string | null;
  school_slug: string | null;
  school_name: string | null;
}

/**
 * The richer search card of the people among `personIds` whose plan includes the featured profile:
 * their current rank and school, from public records only (v_public_person, v_public_passport,
 * v_public_school, v_public_edge). The search order is not touched; anyone else gets nothing here.
 */
export async function featuredSearchCards(db: Executor, personIds: readonly string[]): Promise<Map<string, FeaturedSearchCard>> {
  const out = new Map<string, FeaturedSearchCard>();
  if (personIds.length === 0) return out;
  const ids = sql.join(
    [...new Set(personIds)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const people = await db.execute<{ id: string; user_id: string | null }>(sql`
    SELECT p.id, pe.claimed_by_user_id AS user_id
      FROM v_public_person p JOIN person pe ON pe.id = p.id AND pe.deleted_at IS NULL
     WHERE p.id IN (${ids}) AND pe.claimed_by_user_id IS NOT NULL`);
  const owners = people.rows.filter((r): r is { id: string; user_id: string } => r.user_id !== null);
  const plans = await effectivePlansOf(
    db,
    owners.map((r) => r.user_id),
    new Date(),
  );
  const featured = owners.filter((r) => featuredIncluded(plans.get(r.user_id))).map((r) => r.id);
  if (featured.length === 0) return out;
  const wanted = sql.join(
    featured.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<CardRow>(sql`
    SELECT p.id, NULL AS user_id,
           (SELECT r.title FROM v_public_passport r
             WHERE r.person_id = p.id AND r.kind = 'rank'
             ORDER BY r.on_date DESC NULLS LAST, r.created_at DESC LIMIT 1) AS rank,
           s.slug AS school_slug, s.name AS school_name
      FROM v_public_person p
      LEFT JOIN LATERAL (
        SELECT x.slug, x.name FROM (
          SELECT sc.slug, sc.name, 0 AS pick, NULL::date AS starts_on
            FROM v_public_school sc WHERE p.id = ANY (sc.instructor_person_ids)
          UNION ALL
          SELECT sc.slug, sc.name, CASE WHEN tp.ongoing THEN 1 ELSE 2 END, tp.starts_on
            FROM v_public_edge e
            JOIN training_period tp ON tp.relationship_id = e.id
            JOIN v_public_school sc ON sc.id = tp.school_id
           WHERE e.student_person_id = p.id
        ) x ORDER BY x.pick, x.starts_on DESC NULLS LAST, x.name LIMIT 1
      ) s ON true
     WHERE p.id IN (${wanted})`);
  for (const r of rows.rows) {
    out.set(r.id, { rank: r.rank, school: r.school_slug && r.school_name ? { slug: r.school_slug, name: r.school_name } : null });
  }
  return out;
}
