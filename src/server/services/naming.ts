// Naming requests (review 2026-11-13; owner decision 2026-11-27, docs/adr/0088-review-1113-leftovers.md):
// nobody is listed as an organization's member, an event's instructor or an examination's examiner,
// no organization is named as an entry's issuer, and no account becomes an organization's
// administrator without agreeing to it. The table and its states are described in
// src/server/db/schema/naming.ts.
//
//   naming.mine     the requests the signed-in account answers: about its own person, for the
//                   organizations it administers (an issuer), or to its own e-mail address (an admin
//                   invitation);
//   naming.answer   accept (applied at once) or decline (nothing is attached); audited;
//   naming.queue    for archivists and administrators (verified second factor): the requests about
//                   people without an account;
//   naming.review   approve or decline one of those, with an optional reason; audited.
//
// The writers that name someone call nameMember, nameInstructors, nameExaminer, nameIssuer or
// inviteAdmin inside their own transaction: the attachment is made at once when it needs nobody
// else's agreement (your own person, an organization you administer), otherwise a request is left
// and the named account is told (naming.requested). A request is never shown publicly.

import { and, eq, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { EVENTS_TAG, invalidatePublic, ORGANIZATIONS_TAG, personTag } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { eventInstructor, NAMING_ADMIN_INVITE_DAYS, type NamingKind, namingRequest, organizationAdmin, organizationMembership } from '../db/schema';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notify } from './notify';


export type EntryKind = 'rank' | 'exam' | 'skill';

/** What a writer was told: attached now, or a request that waits (for the person, or for review). */
export type NamingOutcome = 'attached' | 'pending' | 'in_review';

export const NAMING_KIND_LABELS: Record<NamingKind, string> = {
  organization_member: 'Member of an organization',
  event_instructor: 'Instructor at an event',
  exam_examiner: 'Examiner of an examination',
  entry_issuer: 'Issuer of a passport entry',
  organization_admin: 'Administrator of an organization',
};

/** The words the asking side reads next to a request that waits. */
export const WAITING_LABELS: Record<'pending' | 'in_review', string> = {
  pending: 'Waiting for them to accept',
  in_review: 'Waiting for the archive team (no account)',
};

// --- who answers ---------------------------------------------------------------------------------

interface PersonTarget {
  id: string;
  /** The account that answers for the person, or null (no account: the archive team decides). */
  accountId: string | null;
}

async function personTarget(db: Executor, personId: string): Promise<PersonTarget | null> {
  const { rows } = await db.execute<{ id: string; claimed_by_user_id: string | null }>(sql`
    SELECT p.id, CASE WHEN p.stewardship = 'self' THEN p.claimed_by_user_id END AS claimed_by_user_id
      FROM person p WHERE p.id = ${personId}::uuid AND p.deleted_at IS NULL`);
  const row = rows[0];
  return row ? { id: row.id, accountId: row.claimed_by_user_id } : null;
}

/** The active admins of an organization (the accounts that answer for it as an issuer). */
async function organizationAdmins(db: Executor, organizationId: string): Promise<string[]> {
  const { rows } = await db.execute<{ user_id: string }>(sql`
    SELECT a.user_id FROM organization_admin a WHERE a.organization_id = ${organizationId}::uuid AND a.revoked_at IS NULL`);
  return rows.map((r) => r.user_id);
}

async function administers(db: Executor, userId: string, organizationId: string): Promise<boolean> {
  const { rows } = await db.execute(sql`
    SELECT 1 AS one FROM organization_admin a
     WHERE a.user_id = ${userId}::uuid AND a.organization_id = ${organizationId}::uuid AND a.revoked_at IS NULL`);
  return rows.length > 0;
}

async function primaryName(db: Executor, personId: string): Promise<string> {
  const { rows } = await db.execute<{ value: string | null }>(sql`
    SELECT (SELECT n.value FROM person_name n WHERE n.person_id = ${personId}::uuid AND n.is_primary LIMIT 1) AS value`);
  return rows[0]?.value ?? 'Someone';
}

async function organizationName(db: Executor, organizationId: string): Promise<string> {
  const { rows } = await db.execute<{ name: string }>(sql`SELECT name FROM organization WHERE id = ${organizationId}::uuid`);
  return rows[0]?.name ?? 'An organization';
}

/** The notice to the account that answers; `context` is the organization's name or the event's title. */
async function tell(tx: Transaction, userId: string, requestId: string, kind: NamingKind, context: string): Promise<void> {
  await notify(tx, userId, 'naming.requested', { kind, context: context.slice(0, 200) }, { key: `naming.requested:${requestId}:${userId}` });
}

async function auditRequest(tx: Transaction, actorUserId: string, actorRole: string, requestId: string, kind: NamingKind, status: 'pending' | 'in_review', meta: RequestMeta): Promise<void> {
  await writeAudit(tx, {
    action: 'naming.request',
    actorUserId,
    actorRole: actorRole as Principal['user']['role'],
    subjectType: 'naming_request',
    subjectId: requestId,
    after: { kind, status },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
}

export interface Asker {
  userId: string;
  role: Principal['user']['role'];
  /** The asker's own person (attaching yourself needs nobody's agreement). */
  ownPersonId: string | null;
}

/** The asker of a principal: its account, role and own person. */
export async function askerOf(db: Executor, principal: Principal): Promise<Asker> {
  const { rows } = await db.execute<{ id: string }>(sql`SELECT id FROM person WHERE claimed_by_user_id = ${principal.user.id}::uuid AND deleted_at IS NULL LIMIT 1`);
  return { userId: principal.user.id, role: principal.user.role, ownPersonId: rows[0]?.id ?? null };
}

// --- the writers' side ---------------------------------------------------------------------------

/**
 * An organization's admin lists a person as a member: their own person at once; a person with an
 * account by a request they answer; a person without one by a request the archive team decides.
 */
export async function nameMember(
  tx: Transaction,
  asker: Asker,
  input: { organizationId: string; personId: string; role: string; startsOn: string | null },
  meta: RequestMeta,
): Promise<NamingOutcome> {
  const target = await personTarget(tx, input.personId);
  if (!target) throw new ServiceError('NOT_FOUND', 'No such person.');
  if (target.id === asker.ownPersonId || target.accountId === asker.userId) return 'attached';
  const status = target.accountId ? ('pending' as const) : ('in_review' as const);
  const [existing] = await tx
    .select({ id: namingRequest.id })
    .from(namingRequest)
    .where(and(eq(namingRequest.kind, 'organization_member'), eq(namingRequest.organizationId, input.organizationId), eq(namingRequest.personId, input.personId)))
    .for('update');
  if (existing) {
    await tx.update(namingRequest).set({ role: input.role, startsOn: input.startsOn, updatedAt: new Date() }).where(eq(namingRequest.id, existing.id));
    return status;
  }
  const id = uuidv7();
  await tx.insert(namingRequest).values({ id, kind: 'organization_member', status, personId: input.personId, organizationId: input.organizationId, role: input.role, startsOn: input.startsOn, askedByUserId: asker.userId });
  await auditRequest(tx, asker.userId, asker.role, id, 'organization_member', status, meta);
  if (target.accountId) await tell(tx, target.accountId, id, 'organization_member', await organizationName(tx, input.organizationId));
  return status;
}

/** The pending and in-review member requests of an organization, for its admins' list. */
export async function pendingMembers(db: Executor, organizationId: string): Promise<{ requestId: string; personId: string; slug: string; name: string; role: string; status: 'pending' | 'in_review' }[]> {
  const { rows } = await db.execute<{ id: string; person_id: string; slug: string; name: string | null; role: string; status: 'pending' | 'in_review' }>(sql`
    SELECT r.id, r.person_id, p.slug, (SELECT n.value FROM person_name n WHERE n.person_id = r.person_id AND n.is_primary LIMIT 1) AS name, r.role, r.status
      FROM naming_request r JOIN person p ON p.id = r.person_id
     WHERE r.kind = 'organization_member' AND r.organization_id = ${organizationId}::uuid
     ORDER BY r.created_at`);
  return rows.map((r) => ({ requestId: r.id, personId: r.person_id, slug: r.slug, name: r.name ?? r.slug, role: r.role, status: r.status }));
}

/** Withdraws a member request of the organization (its admin changed their mind). */
export async function withdrawMemberRequest(tx: Transaction, organizationId: string, requestId: string): Promise<boolean> {
  const gone = await tx
    .delete(namingRequest)
    .where(and(eq(namingRequest.id, requestId), eq(namingRequest.kind, 'organization_member'), eq(namingRequest.organizationId, organizationId)))
    .returning({ id: namingRequest.id });
  return gone.length > 0;
}

/**
 * The instructors of an event, as the organizer chose them (in order): those already listed stay,
 * the organizer's own person is listed at once, anyone else gets a request; whoever was dropped
 * goes, with their request.
 */
export async function nameInstructors(tx: Transaction, asker: Asker, eventId: string, eventTitle: string, ids: readonly string[], meta: RequestMeta): Promise<void> {
  const now = new Date();
  const listed = new Set((await tx.select({ personId: eventInstructor.personId }).from(eventInstructor).where(eq(eventInstructor.eventId, eventId))).map((r) => r.personId));
  const asked = new Set(
    (await tx.select({ personId: namingRequest.personId }).from(namingRequest).where(and(eq(namingRequest.kind, 'event_instructor'), eq(namingRequest.eventId, eventId)))).map((r) => r.personId!),
  );
  const wanted = new Set(ids);
  const dropListed = [...listed].filter((id) => !wanted.has(id));
  const dropAsked = [...asked].filter((id) => !wanted.has(id));
  if (dropListed.length > 0) await tx.delete(eventInstructor).where(and(eq(eventInstructor.eventId, eventId), inArray(eventInstructor.personId, dropListed)));
  if (dropAsked.length > 0) {
    await tx.delete(namingRequest).where(and(eq(namingRequest.kind, 'event_instructor'), eq(namingRequest.eventId, eventId), inArray(namingRequest.personId, dropAsked)));
  }
  for (const [position, personId] of ids.entries()) {
    if (listed.has(personId)) {
      await tx.update(eventInstructor).set({ position, updatedAt: now }).where(and(eq(eventInstructor.eventId, eventId), eq(eventInstructor.personId, personId)));
      continue;
    }
    if (asked.has(personId)) {
      await tx
        .update(namingRequest)
        .set({ position, updatedAt: now })
        .where(and(eq(namingRequest.kind, 'event_instructor'), eq(namingRequest.eventId, eventId), eq(namingRequest.personId, personId)));
      continue;
    }
    const target = await personTarget(tx, personId);
    if (!target) continue;
    if (target.id === asker.ownPersonId || target.accountId === asker.userId) {
      await tx.insert(eventInstructor).values({ eventId, personId, position, createdAt: now, updatedAt: now });
      continue;
    }
    const status = target.accountId ? ('pending' as const) : ('in_review' as const);
    const id = uuidv7();
    await tx.insert(namingRequest).values({ id, kind: 'event_instructor', status, personId, eventId, position, askedByUserId: asker.userId });
    await auditRequest(tx, asker.userId, asker.role, id, 'event_instructor', status, meta);
    if (target.accountId) await tell(tx, target.accountId, id, 'event_instructor', eventTitle);
  }
}

/** The instructors of an event that wait for an answer, for the organizer's form. */
export async function pendingInstructors(db: Executor, eventId: string): Promise<{ personId: string; position: number; status: 'pending' | 'in_review' }[]> {
  const rows = await db
    .select({ personId: namingRequest.personId, position: namingRequest.position, status: namingRequest.status })
    .from(namingRequest)
    .where(and(eq(namingRequest.kind, 'event_instructor'), eq(namingRequest.eventId, eventId)));
  return rows.map((r) => ({ personId: r.personId!, position: r.position ?? 0, status: r.status }));
}

/**
 * The examiner of an examination: what the entry stores now (the writer's own person, or the one
 * already accepted), and otherwise a request (the entry stores none until it is accepted).
 */
export async function nameExaminer(
  tx: Transaction,
  asker: Asker,
  examId: string,
  personId: string | null,
  current: string | null,
  meta: RequestMeta,
): Promise<string | null> {
  if (personId === current) return current;
  const where = and(eq(namingRequest.kind, 'exam_examiner'), eq(namingRequest.examId, examId));
  // The same person asked again: the request that waits stays as it is (no second notice).
  const [waiting] = await tx.select({ personId: namingRequest.personId }).from(namingRequest).where(where);
  if (waiting && personId && waiting.personId === personId) return current;
  await tx.delete(namingRequest).where(where);
  if (!personId) return null;
  const target = await personTarget(tx, personId);
  if (!target) return null;
  if (target.id === asker.ownPersonId || target.accountId === asker.userId) return personId;
  const status = target.accountId ? ('pending' as const) : ('in_review' as const);
  const id = uuidv7();
  await tx.insert(namingRequest).values({ id, kind: 'exam_examiner', status, personId, examId, askedByUserId: asker.userId });
  await auditRequest(tx, asker.userId, asker.role, id, 'exam_examiner', status, meta);
  if (target.accountId) {
    const { rows } = await tx.execute<{ person_id: string }>(sql`SELECT person_id FROM passport_exam WHERE id = ${examId}::uuid`);
    await tell(tx, target.accountId, id, 'exam_examiner', rows[0] ? await primaryName(tx, rows[0].person_id) : 'A student');
  }
  return null;
}

const ENTRY_COLUMN = { rank: 'rankId', exam: 'examId', skill: 'skillId' } as const;

/**
 * The issuing organization of a rank, exam or skill: stored at once when the writer administers it
 * (or it is the one already accepted), otherwise a request its admins answer (none stored until then).
 */
export async function nameIssuer(
  tx: Transaction,
  asker: Asker,
  entry: { kind: EntryKind; id: string },
  organizationId: string | null,
  current: string | null,
  meta: RequestMeta,
): Promise<string | null> {
  if (organizationId === current) return current;
  const column = namingRequest[ENTRY_COLUMN[entry.kind]];
  const where = and(eq(namingRequest.kind, 'entry_issuer'), eq(column, entry.id));
  const [waiting] = await tx.select({ organizationId: namingRequest.organizationId }).from(namingRequest).where(where);
  if (waiting && organizationId && waiting.organizationId === organizationId) return current;
  await tx.delete(namingRequest).where(where);
  if (!organizationId) return null;
  if (await administers(tx, asker.userId, organizationId)) return organizationId;
  const id = uuidv7();
  await tx.insert(namingRequest).values({ id, kind: 'entry_issuer', status: 'pending', organizationId, [ENTRY_COLUMN[entry.kind]]: entry.id, askedByUserId: asker.userId });
  await auditRequest(tx, asker.userId, asker.role, id, 'entry_issuer', 'pending', meta);
  const name = await organizationName(tx, organizationId);
  for (const admin of await organizationAdmins(tx, organizationId)) await tell(tx, admin, id, 'entry_issuer', name);
  return null;
}

/**
 * An organization's owner invites an account by e-mail address to be an administrator. The answer
 * is the same whether or not an account uses the address (no account oracle); an account that does
 * is told, and becomes an admin only when it accepts within NAMING_ADMIN_INVITE_DAYS.
 */
export async function inviteAdmin(tx: Transaction, asker: Asker, organizationId: string, email: string, role: 'admin', meta: RequestMeta): Promise<void> {
  const address = email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + NAMING_ADMIN_INVITE_DAYS * 86_400_000);
  const [existing] = await tx
    .select({ id: namingRequest.id })
    .from(namingRequest)
    .where(and(eq(namingRequest.kind, 'organization_admin'), eq(namingRequest.organizationId, organizationId), eq(namingRequest.email, address)))
    .for('update');
  const id = existing?.id ?? uuidv7();
  if (existing) await tx.update(namingRequest).set({ expiresAt, updatedAt: new Date() }).where(eq(namingRequest.id, id));
  else await tx.insert(namingRequest).values({ id, kind: 'organization_admin', status: 'pending', organizationId, email: address, role, expiresAt, askedByUserId: asker.userId });
  await auditRequest(tx, asker.userId, asker.role, id, 'organization_admin', 'pending', meta);
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT u.id FROM auth_user u
     WHERE lower(u.email) = ${address} AND u.email_verified AND NOT u.banned
       AND NOT EXISTS (SELECT 1 FROM organization_admin a WHERE a.organization_id = ${organizationId}::uuid AND a.user_id = u.id AND a.revoked_at IS NULL)`);
  const account = rows[0];
  if (account) await tell(tx, account.id, id, 'organization_admin', await organizationName(tx, organizationId));
}

/** The administrator invitations of an organization that wait (by address), for its owners. */
export async function pendingAdminInvites(db: Executor, organizationId: string): Promise<{ requestId: string; email: string; expiresAt: string }[]> {
  const rows = await db
    .select({ id: namingRequest.id, email: namingRequest.email, expiresAt: namingRequest.expiresAt })
    .from(namingRequest)
    .where(and(eq(namingRequest.kind, 'organization_admin'), eq(namingRequest.organizationId, organizationId), sql`${namingRequest.expiresAt} > now()`));
  return rows.map((r) => ({ requestId: r.id, email: r.email!, expiresAt: r.expiresAt!.toISOString() }));
}

/** Withdraws an administrator invitation of the organization. */
export async function withdrawAdminInvite(tx: Transaction, organizationId: string, requestId: string): Promise<boolean> {
  const gone = await tx
    .delete(namingRequest)
    .where(and(eq(namingRequest.id, requestId), eq(namingRequest.kind, 'organization_admin'), eq(namingRequest.organizationId, organizationId)))
    .returning({ id: namingRequest.id });
  return gone.length > 0;
}

// --- applying a request --------------------------------------------------------------------------

type RequestRow = typeof namingRequest.$inferSelect;

/** Makes the attachment a request asked for; returns the cache tags it touches. */
async function apply(tx: Transaction, row: RequestRow, decidedBy: string): Promise<string[]> {
  const now = new Date();
  switch (row.kind) {
    case 'organization_member': {
      const [org] = (await tx.execute<{ id: string }>(sql`SELECT id FROM organization WHERE id = ${row.organizationId}::uuid AND deleted_at IS NULL`)).rows;
      if (!org) return [];
      const [existing] = await tx
        .select({ id: organizationMembership.id })
        .from(organizationMembership)
        .where(and(eq(organizationMembership.organizationId, row.organizationId!), eq(organizationMembership.personId, row.personId!)))
        .for('update');
      const role = row.role as (typeof organizationMembership.$inferInsert)['role'];
      if (existing) await tx.update(organizationMembership).set({ role, startsOn: row.startsOn, endsOn: null, updatedAt: now }).where(eq(organizationMembership.id, existing.id));
      else await tx.insert(organizationMembership).values({ organizationId: row.organizationId!, personId: row.personId!, role, startsOn: row.startsOn });
      return [ORGANIZATIONS_TAG, personTag(row.personId!)];
    }
    case 'event_instructor': {
      const { rows } = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM event_instructor WHERE event_id = ${row.eventId}::uuid`);
      if ((rows[0]?.n ?? 0) >= 5) return [];
      await tx
        .insert(eventInstructor)
        .values({ eventId: row.eventId!, personId: row.personId!, position: row.position ?? 0, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
      return [EVENTS_TAG, personTag(row.personId!)];
    }
    case 'exam_examiner': {
      // The student's passport shows the examiner: both people's cached pages change.
      const { rows } = await tx.execute<{ person_id: string }>(sql`
        UPDATE passport_exam SET examiner_person_id = ${row.personId}::uuid, updated_at = now()
         WHERE id = ${row.examId}::uuid AND person_id <> ${row.personId}::uuid RETURNING person_id`);
      return [personTag(row.personId!), ...rows.map((r) => personTag(r.person_id))];
    }
    case 'entry_issuer': {
      const table = row.rankId ? 'passport_rank' : row.examId ? 'passport_exam' : 'passport_skill';
      const entryId = row.rankId ?? row.examId ?? row.skillId;
      const { rows } = await tx.execute<{ person_id: string }>(sql`
        UPDATE ${sql.identifier(table)} SET organization_id = ${row.organizationId}::uuid, updated_at = now() WHERE id = ${entryId}::uuid RETURNING person_id`);
      return [ORGANIZATIONS_TAG, ...rows.map((r) => personTag(r.person_id))];
    }
    case 'organization_admin': {
      // Answered only by the account the invitation names (mineWhere): that account becomes the admin.
      await tx
        .insert(organizationAdmin)
        .values({ organizationId: row.organizationId!, userId: decidedBy, role: (row.role ?? 'admin') as 'admin', grantedByUserId: row.askedByUserId ?? decidedBy })
        .onConflictDoNothing();
      return [ORGANIZATIONS_TAG];
    }
  }
}

// --- the answering side --------------------------------------------------------------------------

export interface NamingRequestView {
  id: string;
  kind: NamingKind;
  kindLabel: string;
  /** What it is about, in one line: the organization, the event, or the passport entry. */
  about: string;
  /** Who is named: the person's display name, or the organization's name. */
  named: string;
  /** The person's slug, when a person is named. */
  personSlug: string | null;
  status: 'pending' | 'in_review';
  createdAt: string;
}

const VIEW_COLUMNS = sql`
  r.id, r.kind, r.status, r.created_at, pe.slug AS person_slug,
  coalesce((SELECT n.value FROM person_name n WHERE n.person_id = r.person_id AND n.is_primary LIMIT 1),
           (SELECT o.name FROM organization o WHERE o.id = r.organization_id AND r.kind = 'entry_issuer')) AS named,
  CASE r.kind
    WHEN 'organization_member' THEN (SELECT o.name FROM organization o WHERE o.id = r.organization_id)
    WHEN 'organization_admin' THEN (SELECT o.name FROM organization o WHERE o.id = r.organization_id)
    WHEN 'event_instructor' THEN (SELECT e.title FROM event e WHERE e.id = r.event_id)
    WHEN 'exam_examiner' THEN (SELECT x.awarded_rank FROM passport_exam x WHERE x.id = r.exam_id)
    ELSE coalesce((SELECT k.rank FROM passport_rank k WHERE k.id = r.rank_id),
                  (SELECT x.awarded_rank FROM passport_exam x WHERE x.id = r.exam_id),
                  (SELECT s.name FROM passport_skill s WHERE s.id = r.skill_id))
  END AS about`;

type ViewRow = { id: string; kind: NamingKind; status: 'pending' | 'in_review'; created_at: Date | string; person_slug: string | null; named: string | null; about: string | null };

function toView(r: ViewRow): NamingRequestView {
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: NAMING_KIND_LABELS[r.kind],
    about: r.about ?? '',
    named: r.named ?? '',
    personSlug: r.person_slug,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** The requests `userId` may answer (status pending only). */
function mineWhere(userId: string) {
  return sql`r.status = 'pending' AND (
      (r.kind IN ('organization_member', 'event_instructor', 'exam_examiner')
        AND EXISTS (SELECT 1 FROM person p WHERE p.id = r.person_id AND p.stewardship = 'self' AND p.claimed_by_user_id = ${userId}::uuid AND p.deleted_at IS NULL))
   OR (r.kind = 'entry_issuer'
        AND EXISTS (SELECT 1 FROM organization_admin a WHERE a.organization_id = r.organization_id AND a.user_id = ${userId}::uuid AND a.revoked_at IS NULL))
   OR (r.kind = 'organization_admin' AND r.expires_at > now()
        AND EXISTS (SELECT 1 FROM auth_user u WHERE u.id = ${userId}::uuid AND lower(u.email) = r.email AND u.email_verified)))`;
}

/** naming.mine: the requests the signed-in account answers, oldest first. */
export async function namingMine(principal: Principal | null): Promise<{ requests: NamingRequestView[] }> {
  const p = requireUser(principal);
  const { rows } = await getDb().execute<ViewRow>(sql`
    SELECT ${VIEW_COLUMNS} FROM naming_request r LEFT JOIN person pe ON pe.id = r.person_id
     WHERE ${mineWhere(p.user.id)} ORDER BY r.created_at, r.id LIMIT 100`);
  return { requests: rows.map(toView) };
}

/** How many requests wait for the account (the dashboard's count). */
export async function namingWaitingCount(db: Executor, userId: string): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM naming_request r WHERE ${mineWhere(userId)}`);
  return rows[0]?.n ?? 0;
}

export const answerNamingInput = z.object({ id: z.uuid({ error: 'No such request.' }), accept: z.boolean() });
export const reviewNamingInput = z.object({
  id: z.uuid({ error: 'No such request.' }),
  approve: z.boolean(),
  reason: z.string().trim().max(500, { error: 'Use at most 500 characters.' }).optional(),
});

const notFound = () => new ServiceError('NOT_FOUND', 'This request is not there any more.');

/** naming.answer: the named account accepts (the attachment is made) or declines (nothing is). */
export async function answerNaming(principal: Principal | null, raw: z.input<typeof answerNamingInput>, meta: RequestMeta): Promise<{ status: 'accepted' | 'declined' }> {
  const p = requireUser(principal);
  const parsed = answerNamingInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const input = parsed.data;
  const tags = await getDb().transaction(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`SELECT r.id FROM naming_request r WHERE r.id = ${input.id}::uuid AND ${mineWhere(p.user.id)} FOR UPDATE`);
    if (!rows[0]) throw notFound();
    const [row] = await tx.select().from(namingRequest).where(eq(namingRequest.id, input.id));
    const touched = input.accept ? await apply(tx, row!, p.user.id) : [];
    await tx.delete(namingRequest).where(eq(namingRequest.id, input.id));
    await writeAudit(tx, {
      action: 'naming.answer',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'naming_request',
      subjectId: input.id,
      after: { kind: row!.kind, accepted: input.accept },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return touched;
  });
  if (tags.length > 0) invalidatePublic(tags, 'procedure');
  return { status: input.accept ? 'accepted' : 'declined' };
}

/** naming.queue: the requests about people without an account, for archivists and administrators. */
export async function namingQueue(principal: Principal | null): Promise<{ requests: (NamingRequestView & { askedBy: string | null })[] }> {
  requireStaff2FA(principal, ['archivist', 'admin']);
  const { rows } = await getDb().execute<ViewRow & { asked_by: string | null }>(sql`
    SELECT ${VIEW_COLUMNS},
           (SELECT coalesce((SELECT n.value FROM person p JOIN person_name n ON n.person_id = p.id AND n.is_primary
                              WHERE p.claimed_by_user_id = r.asked_by_user_id AND p.deleted_at IS NULL LIMIT 1), 'An account')) AS asked_by
      FROM naming_request r LEFT JOIN person pe ON pe.id = r.person_id
     WHERE r.status = 'in_review' ORDER BY r.created_at, r.id LIMIT 200`);
  return { requests: rows.map((r) => ({ ...toView(r), askedBy: r.asked_by })) };
}

/** naming.review: an archivist or administrator approves (applied) or declines a request in review. */
export async function reviewNaming(principal: Principal | null, raw: z.input<typeof reviewNamingInput>, meta: RequestMeta): Promise<{ status: 'approved' | 'declined' }> {
  const p = requireStaff2FA(principal, ['archivist', 'admin']);
  const parsed = reviewNamingInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const input = parsed.data;
  const tags = await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(namingRequest).where(and(eq(namingRequest.id, input.id), eq(namingRequest.status, 'in_review'))).for('update');
    if (!row) throw notFound();
    const touched = input.approve ? await apply(tx, row, p.user.id) : [];
    await tx.delete(namingRequest).where(eq(namingRequest.id, input.id));
    await writeAudit(tx, {
      action: 'naming.review',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'naming_request',
      subjectId: input.id,
      after: { kind: row.kind, approved: input.approve },
      reason: input.reason || null,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return touched;
  });
  if (tags.length > 0) invalidatePublic(tags, 'procedure');
  return { status: input.approve ? 'approved' : 'declined' };
}
