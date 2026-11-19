// The Supporter badge (owner decision 2026-11-18, docs/adr/0049-supporter-badge.md): an optional
// badge on the public profile of a member whose plan includes `supporter_badge` (Premium Student,
// Professional Sifu).
//
//   profile.supporter      the account's own choice, and whether its plan lets it switch it on
//   profile.setSupporter   switch it on (on the plan) or off (on any plan); audited
//   people.supporter       public: whether a public person shows the badge
//
// The badge is off until the member switches it on (DEFAULT ADR 0049). It says the member supports
// WingChunRoots and nothing else: it changes nothing in search, the lineage, the reviews or any
// order, and it is a shape of its own, never the verification seal. Paying never shows anyone: it
// is read only for a person in v_public_person. On a lower plan the choice is kept and the badge is
// not shown (DEFAULT D08). The public answer is the same for every viewer, so it is cached for
// minutes (the plan can end by date), like the links of ADR 0047.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, personTag, tagCacheEntry } from '../cache';
import { getDb } from '../db';
import { person } from '../db/schema';
import { SLUG_PATTERN } from '../db/schema/persons';
import { type SupporterDto, toPublicSupporter } from '../dto/public';
import { effectivePlan, effectivePlansOf, type Executor } from '../entitlements/access';
import { feature, type PlanCode } from '../entitlements/plans';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

const NO_PROFILE = 'You have no profile yet. Finish setting up your profile first.';
const NEEDS_PLAN = 'The Supporter badge is part of Premium Student and Professional Sifu.';

/** Whether this plan includes the Supporter badge (the matrix decides, ADR 0049). */
export function supporterIncluded(plan: PlanCode | undefined): boolean {
  return plan !== undefined && feature('supporter_badge').values[plan].included;
}

async function accountSupporter(db: Executor, userId: string): Promise<boolean> {
  const { plan } = await effectivePlan({ kind: 'user', userId }, { db });
  return supporterIncluded(plan);
}

export const supporterSlugInput = z.object({
  slug: z
    .string()
    .min(1, { error: 'Must be a profile address.' })
    .max(120, { error: 'Must be a profile address.' })
    .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' }),
});
export const setSupporterInput = z.object({ show: z.boolean() });

async function cachedSupporter(slug: string): Promise<SupporterDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const found = await db.execute<{ id: string; user_id: string | null; supporter_badge: boolean }>(sql`
    SELECT p.id, pe.claimed_by_user_id AS user_id, pe.supporter_badge
      FROM v_public_person p
      JOIN person pe ON pe.id = p.id AND pe.deleted_at IS NULL
     WHERE p.slug = ${slug}
     LIMIT 1`);
  const row = found.rows[0];
  if (!row) return null;
  tagCacheEntry([personTag(row.id)]);
  if (!row.user_id || !row.supporter_badge) return toPublicSupporter({ supporter: false });
  const plans = await effectivePlansOf(db, [row.user_id], new Date());
  return toPublicSupporter({ supporter: supporterIncluded(plans.get(row.user_id)) });
}

/** people.supporter: whether a public person shows the Supporter badge; NOT_FOUND for anyone not public. */
export async function profileSupporter(_principal: Principal | null, raw: z.input<typeof supporterSlugInput>): Promise<SupporterDto> {
  const parsed = supporterSlugInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such person.');
  const answer = await cachedSupporter(parsed.data.slug);
  if (!answer) throw new ServiceError('NOT_FOUND', 'No such person.');
  return answer;
}

export interface OwnSupporter {
  /** The member's choice (kept on a lower plan). */
  show: boolean;
  /** Whether the plan includes the badge, so the profile shows it while the choice is on. */
  allowed: boolean;
}

async function ownPerson(db: Executor, userId: string): Promise<{ id: string; supporterBadge: boolean } | null> {
  const [row] = await db
    .select({ id: person.id, supporterBadge: person.supporterBadge })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row ?? null;
}

/** profile.supporter: the account's own choice. */
export async function mySupporter(principal: Principal | null): Promise<OwnSupporter> {
  const p = requireUser(principal);
  const db = getDb();
  const own = await ownPerson(db, p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
  return { show: own.supporterBadge, allowed: await accountSupporter(db, p.user.id) };
}

/** profile.setSupporter: on needs the plan (ENTITLEMENT_REQUIRED); off works on any plan. */
export async function setSupporter(principal: Principal | null, raw: z.input<typeof setSupporterInput>, meta: RequestMeta): Promise<OwnSupporter> {
  const p = requireUser(principal);
  const parsed = setSupporterInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose whether to show the badge.', { show: 'Choose whether to show the badge.' });
  const { show } = parsed.data;
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const own = await ownPerson(tx, p.user.id);
    if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
    const allowed = await accountSupporter(tx, p.user.id);
    if (show && !allowed) throw new ServiceError('ENTITLEMENT_REQUIRED', NEEDS_PLAN);
    if (own.supporterBadge !== show) {
      await tx.update(person).set({ supporterBadge: show, updatedAt: new Date() }).where(eq(person.id, own.id));
      await writeAudit(tx, {
        action: 'person.supporter_badge',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
        subjectType: 'person',
        subjectId: own.id,
        before: { show: own.supporterBadge },
        after: { show },
      });
    }
    return { personId: own.id, changed: own.supporterBadge !== show, answer: { show, allowed } };
  });
  if (result.changed) invalidatePublic([personTag(result.personId)], 'procedure');
  return result.answer;
}
