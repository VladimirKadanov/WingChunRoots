// Quotas that are safe under concurrent requests (milestone M08; plan §6.5). withQuota() takes a
// transaction-level advisory lock for (feature, subject), then counts and decides in the same
// transaction, then runs the write it guards. Ten approvals at once for a Free Sifu with four
// students give exactly one success (quota.int.test.ts): the second transaction waits on the
// lock until the first commits, and its count, a new statement under READ COMMITTED, sees it.
//
// The lock key is 64 bits of SHA-256 over the feature and the subject, so two subjects collide
// only by a 2^-64 accident, and never with a key taken from a 32-bit hash such as the global
// `pg_advisory_xact_lock(hashtext('teaching_relationship.verify'))` of plan §6.3: those are
// sign-extended int4 values (upper 32 bits all 0 or all 1), which quotaLockKey() never returns.
// M09's approvals take that global lock first, then this one (one order everywhere, no deadlock).

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Database } from '../db';
import { alreadyCounted, type EntitlementSubject, requireEntitlement } from './access';
import type { EntitlementDecision } from './effective';
import type { FeatureKey } from './plans';

/** An open transaction: an advisory xact lock outside one would end with its own statement. */
export type QuotaTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The 64-bit advisory lock key of (feature, subject). */
export function quotaLockKey(subject: EntitlementSubject, key: FeatureKey): bigint {
  const digest = createHash('sha256').update(`wingchunroots:quota:v1:${key}:${subject.kind}:${subject.userId}`).digest();
  let high = digest.readInt32BE(0);
  // Keep clear of the int4 key space: upper half neither 0x00000000 nor 0xFFFFFFFF.
  if (high === 0 || high === -1) high ^= 0x4000_0000;
  return (BigInt(high) << 32n) | BigInt(digest.readUInt32BE(4));
}

/** Takes the quota lock of (feature, subject) until the transaction ends. */
export async function lockQuota(tx: QuotaTransaction, subject: EntitlementSubject, key: FeatureKey): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${quotaLockKey(subject, key).toString()}::bigint)`);
}

export type QuotaOutcome<T> = { ok: true; value: T; decision: Extract<EntitlementDecision, { ok: true }> } | Extract<EntitlementDecision, { ok: false }>;

export interface QuotaOptions {
  now?: Date;
  /**
   * The counted unit the write adds (for approve_students, the student's person id). A unit that
   * already counts adds nothing, so its write runs even at the limit: a second link of a student
   * who is already approved (D06 counts distinct students).
   */
  unit?: string;
}

/**
 * Locks, checks and, when the plan allows one more, runs `write` in the same transaction. A
 * refusal returns the machine-readable decision and writes nothing.
 */
export async function withQuota<T>(
  tx: QuotaTransaction,
  subject: EntitlementSubject,
  key: FeatureKey,
  write: () => Promise<T>,
  options: QuotaOptions = {},
): Promise<QuotaOutcome<T>> {
  await lockQuota(tx, subject, key);
  const decision = await requireEntitlement(subject, key, { db: tx, now: options.now });
  if (decision.ok) return { ok: true, value: await write(), decision };
  // Only a used-up allowance can be passed this way; a plan without the feature never is.
  if (decision.code === 'quota' && options.unit !== undefined && (await alreadyCounted(tx, subject, key, options.unit))) {
    const { plan, limit, current } = decision;
    return { ok: true, value: await write(), decision: { ok: true, plan, limit, current } };
  }
  return decision;
}
