// The replay of the erasure ledger after a restore (review 2026-11,
// docs/adr/0032-retention-and-withdrawal.md; src/server/erasure-ledger.ts). A backup brings back an
// account or a trial lesson request that was erased or withdrawn after the dump was taken. This
// reads the ledger, looks at what the restored database shows for each entry, and repeats the ones
// that are still there, with the same code that made them:
//
//   account.erase    eraseAccount() (services/account-erasure.ts), by account id, without a new ledger line;
//   trial.withdraw   the same scrub of the request as trial.withdraw (SCRUBBED_TRIAL_FIELDS).
//
// It is safe to run twice and on a database that already shows the erasure: an entry whose subject is
// gone or already erased is reported and left alone. Without `apply` it changes nothing (a dry run).
// Entries that are not `done` (unconfirmed) are listed, and repeated only with `includeUnconfirmed`.
// Nothing here prints or stores a name or an address; the report holds ids, operations and outcomes.
//
// The command is `pnpm erasures:replay` (src/server/erasures-replay-cli.ts): local only, run before
// anyone uses a restored database (docs/operations/backup-and-restore.md).

import { eq } from 'drizzle-orm';

import { writeAudit } from '../audit';
import { isErasedEmail } from '../auth/suspension';
import { getDb } from '../db';
import { authUser, trialInquiry } from '../db/schema';
import { type LedgerItem, type LedgerOperation, readLedger, settleLedger } from '../erasure-ledger';
import type { ObjectStore } from '../storage';
import { eraseAccount } from './account-erasure';
import { isServiceError } from './errors';
import { SCRUBBED_TRIAL_FIELDS } from './trial-lessons';

/** The reason written to the audit log of every repeated erasure. */
export const REPLAY_REASON = 'Repeated from the erasure ledger after a restore (pnpm erasures:replay).';

/**
 * What the restored database shows for an entry:
 *   present  the account or the open request is there: it is to be erased;
 *   absent   no such row (created after the dump, or deleted since): nothing to do;
 *   already  erased or withdrawn already (the dump was taken after it, or a replay ran before);
 *   blocked  it cannot be repeated as it stands (a staff role, a request someone has answered);
 */
export type ReplayState = 'present' | 'absent' | 'already' | 'blocked';

/** What the run did with an entry. */
export type ReplayAction =
  | 'erased'
  | 'would-erase'
  | 'nothing'
  /** present, but only `begin` was written and `includeUnconfirmed` was not given. */
  | 'skipped-unconfirmed'
  | 'blocked'
  | 'failed';

export interface ReplayLine {
  op: LedgerOperation;
  id: string;
  confirmed: boolean;
  state: ReplayState;
  action: ReplayAction;
  /** A refusal's message (no personal data), for `blocked` and `failed`. */
  note?: string;
}

export interface ReplayOptions {
  /** False (the default): look and report, change nothing. */
  apply?: boolean;
  /** Also repeat entries that have only a `begin` line. */
  includeUnconfirmed?: boolean;
  /** The ledger folder (default: ledgerDir()). */
  dir?: string;
  evidenceStore?: ObjectStore;
}

export interface ReplayReport {
  apply: boolean;
  lines: ReplayLine[];
  /** Ledger lines that could not be read as an entry (skipped). */
  unreadable: number;
  /** Public cache tags to drop; the command line cannot, so it says to restart the web server. */
  tags: string[];
}

async function inspectAccount(id: string): Promise<{ state: ReplayState; note?: string }> {
  const [account] = await getDb().select({ email: authUser.email, role: authUser.role }).from(authUser).where(eq(authUser.id, id));
  if (!account) return { state: 'absent' };
  if (isErasedEmail(account.email)) return { state: 'already' };
  if (account.role !== 'user') return { state: 'blocked', note: 'The account has a staff role: take the role away first, then run this again.' };
  return { state: 'present' };
}

async function inspectTrial(id: string): Promise<{ state: ReplayState; note?: string }> {
  const [row] = await getDb().select({ status: trialInquiry.status, scrubbedAt: trialInquiry.scrubbedAt }).from(trialInquiry).where(eq(trialInquiry.id, id));
  if (!row) return { state: 'absent' };
  if (row.scrubbedAt !== null) return { state: 'already' };
  if (row.status === 'open') return { state: 'present' };
  // Only an open request can be withdrawn, and a request only moves forward, so the dump cannot show one the school
  // has answered. Nothing is changed: a person must look.
  return { state: 'blocked', note: `The request is ${row.status} in this database, so it cannot be withdrawn here.` };
}

async function withdrawTrialAgain(id: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ status: trialInquiry.status, schoolId: trialInquiry.schoolId }).from(trialInquiry).where(eq(trialInquiry.id, id)).for('update');
    if (!row || row.status !== 'open') return false;
    const now = new Date();
    await tx
      .update(trialInquiry)
      .set({ ...SCRUBBED_TRIAL_FIELDS, status: 'withdrawn', closedAt: now, scrubbedAt: now, updatedAt: now })
      .where(eq(trialInquiry.id, id));
    await writeAudit(tx, {
      action: 'trial.withdraw',
      actorUserId: null,
      actorRole: 'system',
      subjectType: 'trial_inquiry',
      subjectId: id,
      before: { status: 'open' },
      after: { status: 'withdrawn', schoolId: row.schoolId },
      reason: REPLAY_REASON,
    });
    return true;
  });
}

async function replayOne(item: LedgerItem, options: ReplayOptions, tags: string[]): Promise<ReplayLine> {
  const seen = item.op === 'account.erase' ? await inspectAccount(item.id) : await inspectTrial(item.id);
  const line: ReplayLine = { op: item.op, id: item.id, confirmed: item.confirmed, state: seen.state, action: 'nothing' };
  if (seen.state === 'blocked') return { ...line, action: 'blocked', note: seen.note };
  if (seen.state !== 'present') return line;
  if (!item.confirmed && !options.includeUnconfirmed) return { ...line, action: 'skipped-unconfirmed' };
  if (!options.apply) return { ...line, action: 'would-erase' };
  try {
    if (item.op === 'account.erase') {
      const outcome = await eraseAccount({ actor: null, by: { userId: item.id }, reason: REPLAY_REASON, skipLedger: true }, options.evidenceStore);
      tags.push(...outcome.tags);
    } else if (!(await withdrawTrialAgain(item.id))) {
      return { ...line, action: 'blocked', note: 'The request is no longer open.' };
    }
    return { ...line, action: 'erased' };
  } catch (error) {
    // A refusal of the service carries a message without personal data; anything else is reported by its class only.
    if (isServiceError(error)) return { ...line, action: 'blocked', note: error.message };
    return { ...line, action: 'failed', note: error instanceof Error ? error.name : 'unknown error' };
  }
}

/**
 * Reads the ledger and repeats, oldest first, every erasure the database still shows. A failure of one
 * entry does not stop the others; the report says which.
 */
export async function replayErasures(options: ReplayOptions = {}): Promise<ReplayReport> {
  const { entries, unreadable } = await readLedger({ dir: options.dir });
  const lines: ReplayLine[] = [];
  const tags: string[] = [];
  for (const item of settleLedger(entries)) lines.push(await replayOne(item, options, tags));
  return { apply: options.apply === true, lines, unreadable, tags: [...new Set(tags)] };
}

/** The counts the command prints. */
export function summariseReplay(report: ReplayReport): Record<ReplayAction, number> & { total: number } {
  const counts = { erased: 0, 'would-erase': 0, nothing: 0, 'skipped-unconfirmed': 0, blocked: 0, failed: 0 } satisfies Record<ReplayAction, number>;
  for (const line of report.lines) counts[line.action] += 1;
  return { ...counts, total: report.lines.length };
}
