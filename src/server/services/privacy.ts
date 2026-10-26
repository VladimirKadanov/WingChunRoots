// /account/privacy (milestone M07, In scope 5 and 7): the account's consents, withdrawing an
// optional one, and asking for the account to be deleted. Each change is an oRPC procedure
// (consent.withdraw, account.requestDeletion) that the page's Server Actions wrap (plan §6.8).
//
// Withdrawing a consent adds a consent_record row (the history is never rewritten) and an audit
// entry consent.withdraw. Withdrawing `publication` also takes the own profile out of public view.
//
// A deletion request opens a review_case of kind deletion_request, notifies every administrator
// and is audited as account.deletion_request. DEFAULT (not a D-number; docs/plan/questions/M07.md,
// question 1): when an administrator carries the request out, the account's data is deleted and the
// relationships that others verified stay as historical records until the legal review.

import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic } from '../cache';
import { getDb } from '../db';
import { authUser, consentRecord, notification, person, personBio, personName, reviewCase, teachingRelationship } from '../db/schema';
import type { Transaction } from '../jobs/outbox';
import { type ConsentKind, consentVersion, REQUIRED_SIGN_UP_CONSENTS } from '../legal/documents';
import { lockAccount } from './account-lock';
import { withdrawConsents } from './consent';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { neighbourTags, setOwnVisibility } from './profile';
import { isReferencedRowError } from './retention';

/** The consents an account may withdraw and keep its account: everything the sign-up does not require. */
export const OPTIONAL_CONSENTS = ['publication', 'privacy_ack'] as const satisfies readonly ConsentKind[];
export type OptionalConsent = (typeof OPTIONAL_CONSENTS)[number];

/** The order /account/privacy lists the consents in. */
const LISTED_CONSENTS: readonly ConsentKind[] = ['age_18_plus', 'terms', 'authenticity_declaration', 'privacy_ack', 'publication'];

/** Review cases that are still being worked on. */
const OPEN_CASE_STATUSES = ['open', 'in_review', 'needs_info'] as const;

export interface ConsentState {
  kind: ConsentKind;
  /** Required to keep the account (DEFAULT D10: adults only); only optional ones can be withdrawn here. */
  required: boolean;
  /** `granted` for the current document version, `withdrawn`, `outdated` (granted for an older version) or `never`. */
  state: 'granted' | 'withdrawn' | 'outdated' | 'never';
  /** When the latest record was made (ISO 8601), or null. */
  at: string | null;
  /** The document version of the latest record, or null. */
  version: string | null;
}

export interface DeletionRequestView {
  id: string;
  status: (typeof reviewCase.$inferSelect)['status'];
  openedAt: string;
}

export interface PrivacyOverview {
  consents: ConsentState[];
  /** The open deletion request, if any. */
  deletionRequest: DeletionRequestView | null;
  /** The own profile and whether it is public; null before onboarding. */
  profile: { slug: string; visibility: 'public' | 'involved_only' } | null;
}

async function openDeletionRequest(db: Parameters<typeof lockAccount>[0], userId: string): Promise<DeletionRequestView | null> {
  const [row] = await db
    .select({ id: reviewCase.id, status: reviewCase.status, openedAt: reviewCase.createdAt })
    .from(reviewCase)
    .where(and(eq(reviewCase.kind, 'deletion_request'), eq(reviewCase.openedByUserId, userId), inArray(reviewCase.status, OPEN_CASE_STATUSES)))
    .orderBy(desc(reviewCase.createdAt))
    .limit(1);
  return row ? { id: row.id, status: row.status, openedAt: row.openedAt.toISOString() } : null;
}

/** account.privacy: the account's consents, its open deletion request and whether its profile is public. */
export async function privacyOverview(principal: Principal | null): Promise<PrivacyOverview> {
  const p = requireUser(principal);
  const db = getDb();
  const records = await db
    .select({ kind: consentRecord.kind, action: consentRecord.action, version: consentRecord.documentVersion, at: consentRecord.occurredAt })
    .from(consentRecord)
    .where(eq(consentRecord.userId, p.user.id))
    .orderBy(desc(consentRecord.occurredAt), desc(consentRecord.id));
  const consents = LISTED_CONSENTS.map((kind): ConsentState => {
    const latest = records.find((r) => r.kind === kind);
    const state = !latest ? 'never' : latest.action === 'withdrawn' ? 'withdrawn' : latest.version === consentVersion(kind) ? 'granted' : 'outdated';
    return {
      kind,
      required: (REQUIRED_SIGN_UP_CONSENTS as readonly string[]).includes(kind),
      state,
      at: latest?.at.toISOString() ?? null,
      version: latest?.version ?? null,
    };
  });
  const [own] = await db
    .select({ slug: person.slug, visibility: person.visibility })
    .from(person)
    .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  return { consents, deletionRequest: await openDeletionRequest(db, p.user.id), profile: own ?? null };
}

// --- consent.withdraw ----------------------------------------------------------------------------

export const consentWithdrawInput = z.object({
  kinds: z.array(z.enum(OPTIONAL_CONSENTS, { error: 'Only an optional consent can be withdrawn here.' })).min(1).max(OPTIONAL_CONSENTS.length),
});

export interface ConsentWithdrawResult {
  /** The kinds recorded as withdrawn (those not currently given are left as they are). */
  withdrawn: OptionalConsent[];
  /** True when withdrawing `publication` took the own profile out of public view. */
  profileHidden: boolean;
}

/**
 * consent.withdraw: withdraws optional consents of the signed-in account. A required consent is
 * refused (400): it is withdrawn by deleting the account (account.requestDeletion).
 */
export async function consentWithdraw(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<ConsentWithdrawResult> {
  const p = requireUser(principal);
  const parsed = consentWithdrawInput.safeParse(raw);
  if (!parsed.success) {
    throw new ServiceError('BAD_REQUEST', 'Only an optional consent can be withdrawn here. To withdraw a required one, ask for your account to be deleted.', {
      kinds: 'Choose an optional consent.',
    });
  }
  const kinds = [...new Set(parsed.data.kinds)];
  const outcome = await getDb().transaction(async (tx) => {
    if (!(await lockAccount(tx, { id: p.user.id }))) throw new ServiceError('UNAUTHORIZED', 'Sign in to continue.');
    // One withdrawal, one audit entry, for every kind still granted (of any document version);
    // hiding the profile below then finds publication withdrawn and records nothing twice.
    const withdrawn = (await withdrawConsents(tx, p.user.id, p.user.role, kinds, meta)) as OptionalConsent[];
    let profileHidden = false;
    let personId: string | null = null;
    if (kinds.includes('publication')) {
      const [own] = await tx
        .select({ id: person.id, visibility: person.visibility, stewardship: person.stewardship })
        .from(person)
        .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)))
        .for('update');
      // Hides the profile (its consent is withdrawn above).
      if (own && own.stewardship === 'self') {
        profileHidden = await setOwnVisibility(tx, p, own, false, meta);
        personId = own.id;
        // The visibility change is a change to the person (plan §6.6): before and after, no names.
        if (profileHidden) {
          await writeAudit(tx, {
            action: 'person.update',
            actorUserId: p.user.id,
            actorRole: p.user.role,
            subjectType: 'person',
            subjectId: own.id,
            before: { visibility: own.visibility },
            after: { visibility: 'involved_only', via: 'consent.withdraw' },
            requestId: meta.requestId,
            ipHmac: meta.ipHmac,
          });
        }
      }
    }
    return { withdrawn, profileHidden, tags: profileHidden && personId ? await neighbourTags(tx, personId, { ancestors: true }) : [] };
  });
  // The person and the people and lineages next to it, as after a profile save.
  if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
  return { withdrawn: outcome.withdrawn, profileHidden: outcome.profileHidden };
}

// --- account.requestDeletion ---------------------------------------------------------------------

export const requestDeletionInput = z.object({
  /** The account confirms that it understands what deletion means. */
  confirm: z.literal(true, { error: 'Confirm that you want your account deleted.' }),
});

export interface DeletionRequestResult {
  request: DeletionRequestView;
  /** False when an open request already existed: nothing new was sent to the administrators. */
  created: boolean;
}

/**
 * account.requestDeletion: opens a deletion_request review case for the signed-in account and
 * notifies every administrator. One open request per account: asking again returns it.
 */
export async function requestAccountDeletion(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<DeletionRequestResult> {
  const p = requireUser(principal);
  const parsed = requestDeletionInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Confirm that you want your account deleted.', { confirm: 'Confirm that you want your account deleted.' });
  return getDb().transaction(async (tx) => {
    // The account's lock first (services/account-lock.ts): two requests at once open one case.
    if (!(await lockAccount(tx, { id: p.user.id }))) throw new ServiceError('UNAUTHORIZED', 'Sign in to continue.');
    const existing = await openDeletionRequest(tx, p.user.id);
    if (existing) return { request: existing, created: false };
    const [own] = await tx.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
    const [created] = await tx
      .insert(reviewCase)
      .values({ kind: 'deletion_request', status: 'open', personId: own?.id ?? null, openedByUserId: p.user.id })
      .returning({ id: reviewCase.id, status: reviewCase.status, openedAt: reviewCase.createdAt });
    const request = { id: created!.id, status: created!.status, openedAt: created!.openedAt.toISOString() };
    const admins = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.role, 'admin'));
    if (admins.length > 0) {
      // No name or address in the payload: the admin page looks the account up when it is read.
      await tx.insert(notification).values(admins.map((admin) => ({ userId: admin.id, template: 'account.deletion-requested', payload: { caseId: request.id } })));
    }
    await writeAudit(tx, {
      action: 'account.deletion_request',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: request.id,
      after: { kind: 'deletion_request', personId: own?.id ?? null, notifiedAdmins: admins.length },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { request, created: true };
  });
}

// --- Carrying out a deletion request (pnpm account:delete) ---------------------------------------
//
// Until the review tool of M10a, an administrator carries a request out on the machine that runs
// the pilot: `pnpm account:delete --case <id>` (src/server/auth/account-delete-cli.ts), or closes it
// without carrying it out with `--cancel` when the member changed their mind. DEFAULT
// (docs/plan/questions/M07.md, question 1), in one transaction:
//   - the profile keeps only its Latin display name: the other names (their search keys go with
//     them), the biographies, the city and the year are deleted; it becomes an unclaimed record
//     (stewardship = unclaimed) with no account, and stays public only when it was public and has a
//     verified relationship, the historical record that others confirmed;
//   - the account's consent records are deleted (as for an unconfirmed account, retention.ts) and
//     its review cases keep no link to it;
//   - the sign-in account goes, with its sessions, credentials, 2FA, notifications and requests
//     (ON DELETE CASCADE). Another row that still refers to the account (RESTRICT, such as a plan
//     an admin granted) stops it all with CONFLICT: nothing is deleted.
// The audit log keeps its rows (append-only; ids and dates, no names) and gains account.delete.
// The command runs in its own process, so it cannot drop the web server's public cache: the
// administrator restarts the web server afterwards (docs/guides/admin-guide.bg.md, section 13).

const DELETION_CASE_ID = z.uuid();

async function lockOpenDeletionCase(tx: Transaction, caseId: string): Promise<{ id: string; userId: string }> {
  if (!DELETION_CASE_ID.safeParse(caseId).success) throw new ServiceError('BAD_REQUEST', 'That is not the id of a case.');
  const find = () =>
    tx
      .select({ id: reviewCase.id, kind: reviewCase.kind, status: reviewCase.status, userId: reviewCase.openedByUserId })
      .from(reviewCase)
      .where(eq(reviewCase.id, caseId));
  const [seen] = await find();
  if (!seen || seen.kind !== 'deletion_request') throw new ServiceError('NOT_FOUND', 'No account deletion request has this id.');
  // The account's lock first, as requestAccountDeletion takes it, then the case.
  if (seen.userId) await lockAccount(tx, { id: seen.userId });
  const [found] = await find().for('update');
  if (!found || !found.userId || !(OPEN_CASE_STATUSES as readonly string[]).includes(found.status)) {
    throw new ServiceError('CONFLICT', 'This deletion request is already closed.');
  }
  return { id: found.id, userId: found.userId };
}

export interface DeletionCarriedOut {
  /** The profile that stays as an unclaimed record, or null when the account had none. */
  personId: string | null;
  /** Its visibility afterwards. */
  visibility: 'public' | 'involved_only' | null;
}

/**
 * Carries out an open deletion request (`pnpm account:delete --case <id>`). The caller (the CLI)
 * has already refused production and a database that is not on this machine.
 */
export async function carryOutDeletionFromCommandLine(caseId: string): Promise<DeletionCarriedOut> {
  try {
    return await getDb().transaction(async (tx) => {
      const request = await lockOpenDeletionCase(tx, caseId);
      const userId = request.userId;
      const [own] = await tx
        .select({ id: person.id, visibility: person.visibility })
        .from(person)
        .where(eq(person.claimedByUserId, userId))
        .for('update');
      let visibility: DeletionCarriedOut['visibility'] = null;
      let namesRemoved = 0;
      let biosRemoved = 0;
      if (own) {
        namesRemoved = (await tx.delete(personName).where(and(eq(personName.personId, own.id), eq(personName.isPrimary, false)))).rowCount ?? 0;
        biosRemoved = (await tx.delete(personBio).where(eq(personBio.personId, own.id))).rowCount ?? 0;
        const [verified] = await tx
          .select({ id: teachingRelationship.id })
          .from(teachingRelationship)
          .where(
            and(
              eq(teachingRelationship.status, 'verified'),
              or(eq(teachingRelationship.teacherPersonId, own.id), eq(teachingRelationship.studentPersonId, own.id)),
            ),
          )
          .limit(1);
        visibility = own.visibility === 'public' && verified ? 'public' : 'involved_only';
        await tx
          .update(person)
          .set({ claimedByUserId: null, stewardship: 'unclaimed', visibility, placeId: null, trainingStartYear: null, updatedAt: new Date() })
          .where(eq(person.id, own.id));
      }
      // Records the account added for other people keep no link to it.
      await tx.update(person).set({ createdByUserId: null }).where(eq(person.createdByUserId, userId));
      const consentsRemoved = (await tx.delete(consentRecord).where(eq(consentRecord.userId, userId))).rowCount ?? 0;
      const now = new Date();
      await tx
        .update(reviewCase)
        .set({ status: 'resolved', resolution: 'approved', resolutionReason: 'Carried out with pnpm account:delete.', resolvedAt: now, updatedAt: now })
        .where(eq(reviewCase.id, request.id));
      await tx.update(reviewCase).set({ openedByUserId: null }).where(eq(reviewCase.openedByUserId, userId));
      await writeAudit(tx, {
        action: 'account.delete',
        actorUserId: null,
        actorRole: null,
        subjectType: 'review_case',
        subjectId: request.id,
        before: { userId, personId: own?.id ?? null, visibility: own?.visibility ?? null },
        after: { personId: own?.id ?? null, stewardship: own ? 'unclaimed' : null, visibility, namesRemoved, biosRemoved, consentsRemoved },
        reason: 'pnpm account:delete (local environment)',
      });
      await tx.delete(authUser).where(eq(authUser.id, userId));
      return { personId: own?.id ?? null, visibility };
    });
  } catch (error) {
    if (!isReferencedRowError(error)) throw error;
    const constraint = (error as { constraint?: unknown; cause?: { constraint?: unknown } }).constraint ?? (error as { cause?: { constraint?: unknown } }).cause?.constraint;
    throw new ServiceError(
      'CONFLICT',
      `Another record still refers to the account${typeof constraint === 'string' ? ` (${constraint})` : ''}; nothing was deleted. This request waits for the review tool (M10a).`,
    );
  }
}

/**
 * Closes an open deletion request without carrying it out (`pnpm account:delete --case <id>
 * --cancel`), when the member says in reply to the confirmation e-mail that they changed their mind.
 */
export async function cancelDeletionFromCommandLine(caseId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const request = await lockOpenDeletionCase(tx, caseId);
    const now = new Date();
    await tx
      .update(reviewCase)
      .set({ status: 'dismissed', resolutionReason: 'The member withdrew the request.', resolvedAt: now, updatedAt: now })
      .where(eq(reviewCase.id, request.id));
    await writeAudit(tx, {
      action: 'account.deletion_cancel',
      actorUserId: null,
      actorRole: null,
      subjectType: 'review_case',
      subjectId: request.id,
      after: { status: 'dismissed' },
      reason: 'pnpm account:delete --cancel (local environment)',
    });
  });
}
