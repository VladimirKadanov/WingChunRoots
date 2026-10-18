// Consents (milestone M02, In scope 4; plan §6.2): every tick is a consent_record row with the
// version of the document it refers to, and an audit entry `consent.grant`. The latest row of a
// kind decides: a grant for an older version of the document no longer counts once the document
// has a new version, so the account is asked again.

import { and, desc, eq } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { type Database, getDb } from '../db';
import { consentRecord } from '../db/schema';
import type { Transaction } from '../jobs/outbox';
import {
  type ConsentKind,
  consentVersion,
  REQUIRED_SIGN_UP_CONSENTS,
  SIGN_UP_CONSENTS,
  type SignUpConsent,
} from '../legal/documents';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

export { REQUIRED_SIGN_UP_CONSENTS, SIGN_UP_CONSENTS, type SignUpConsent };

/** Thrown for a request that lacks a required consent; the API maps it to 400 CONSENT_REQUIRED. */
export class ConsentRequiredError extends ServiceError {
  constructor(readonly missing: readonly ConsentKind[]) {
    super(
      'CONSENT_REQUIRED',
      'Confirm that you are 18 or older and accept the terms and the authenticity declaration.',
      Object.fromEntries(missing.map((kind) => [kind, 'This confirmation is required.'])),
    );
    this.name = 'ConsentRequiredError';
  }
}

/**
 * The sign-up ticks from an untrusted value (`{ terms: true, ... }`): only the four known kinds,
 * and only `true` counts as a tick. Throws ConsentRequiredError without every required tick.
 */
export function parseSignUpConsents(value: unknown): SignUpConsent[] {
  const given = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ticked = SIGN_UP_CONSENTS.filter((kind) => given[kind] === true);
  const missing = REQUIRED_SIGN_UP_CONSENTS.filter((kind) => !ticked.includes(kind));
  if (missing.length > 0) throw new ConsentRequiredError(missing);
  return ticked;
}

/**
 * Records `kinds` as granted for their current document versions, with one audit entry. Kinds
 * already granted for the current version are not recorded twice. Returns the kinds recorded.
 */
export async function grantConsents(
  tx: Database | Transaction,
  userId: string,
  actorRole: string | null,
  kinds: readonly ConsentKind[],
  meta: RequestMeta,
): Promise<ConsentKind[]> {
  const current = await currentConsents(tx, userId);
  const fresh = [...new Set(kinds)].filter((kind) => !current.has(kind));
  if (fresh.length === 0) return [];
  const occurredAt = new Date();
  await tx.insert(consentRecord).values(
    fresh.map((kind) => ({ userId, kind, documentVersion: consentVersion(kind), action: 'granted' as const, occurredAt })),
  );
  await writeAudit(tx, {
    action: 'consent.grant',
    actorUserId: userId,
    actorRole,
    subjectType: 'user',
    subjectId: userId,
    after: { kinds: fresh, versions: Object.fromEntries(fresh.map((kind) => [kind, consentVersion(kind)])) },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  return fresh;
}

/** The kinds whose latest record is a grant of the current document version. */
export async function currentConsents(db: Database | Transaction, userId: string): Promise<Set<ConsentKind>> {
  const rows = await db
    .select({ kind: consentRecord.kind, documentVersion: consentRecord.documentVersion, action: consentRecord.action })
    .from(consentRecord)
    .where(eq(consentRecord.userId, userId))
    .orderBy(desc(consentRecord.occurredAt), desc(consentRecord.id));
  const seen = new Set<ConsentKind>();
  const current = new Set<ConsentKind>();
  for (const row of rows) {
    if (seen.has(row.kind)) continue;
    seen.add(row.kind);
    if (row.action === 'granted' && row.documentVersion === consentVersion(row.kind)) current.add(row.kind);
  }
  return current;
}

/** The required sign-up consents that the account has not granted for the current versions. */
export async function missingRequiredConsents(db: Database | Transaction, userId: string): Promise<SignUpConsent[]> {
  const current = await currentConsents(db, userId);
  return REQUIRED_SIGN_UP_CONSENTS.filter((kind) => !current.has(kind));
}

/** Whether the account has a grant of `kind` for the current version (tests, onboarding). */
export async function hasConsent(db: Database | Transaction, userId: string, kind: ConsentKind): Promise<boolean> {
  const [row] = await db
    .select({ documentVersion: consentRecord.documentVersion, action: consentRecord.action })
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, kind)))
    .orderBy(desc(consentRecord.occurredAt), desc(consentRecord.id))
    .limit(1);
  return row?.action === 'granted' && row.documentVersion === consentVersion(kind);
}

export const recordConsentsInput = z.object({
  kinds: z.array(z.enum(SIGN_UP_CONSENTS)).min(1).max(SIGN_UP_CONSENTS.length),
});

/**
 * consent.record: the signed-in account gives the sign-up consents again, for example after a
 * document got a new version or for an account created without the sign-up form. Returns the
 * kinds that were recorded (those already current are not recorded twice).
 */
export async function recordConsents(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<{ recorded: ConsentKind[] }> {
  const p = requireUser(principal);
  const parsed = recordConsentsInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose at least one of the confirmations.');
  const recorded = await getDb().transaction((tx) => grantConsents(tx, p.user.id, p.user.role, parsed.data.kinds, meta));
  return { recorded };
}
