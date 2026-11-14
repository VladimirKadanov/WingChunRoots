// The erasure ledger and its replay (review 2026-11, docs/adr/0032-retention-and-withdrawal.md),
// against a migrated throwaway database and a ledger folder of the test's own.
//
// Two halves: the real services write the ledger (an erasure and a withdrawal write `begin` before
// the change and `done` after it, a refusal writes nothing, and a ledger that cannot be written
// refuses the change and leaves everything as it was); and `replayErasures` brings a database that
// still shows what the ledger says was erased back to the erased state. A restore is simulated by
// writing the ledger lines for rows that are still live: the restored database is exactly that.
// Fictional data only (D20).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { isErasedEmail } from '../auth/suspension';
import { getDb } from '../db';
import { withClient } from '../db/admin';
import { auditLog, authUser, person, trialInquiry } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { appendLedger, ErasureLedgerError, readLedger, settleLedger } from '../erasure-ledger';
import { createObjectStore, type ObjectStore } from '../storage';
import { eraseAccount } from './account-erasure';
import { REPLAY_REASON, replayErasures, summariseReplay } from './erasure-replay';
import { member, meta, staff } from './relationships.test-support';
import { withdrawTrial } from './trial-lessons';

vi.mock('next/cache', () => ({ cacheTag: () => undefined, cacheLife: () => undefined, revalidateTag: () => undefined, updateTag: () => undefined }));

let testDb: TestDatabase | undefined;
const root = mkdtempSync(path.join(tmpdir(), 'wcr-replay-int-'));
const ledgerFolder = path.join(root, 'erasures');
const storeRoot = path.join(root, 'store');
let store: ObjectStore;
let schoolId: string;
let ownerId: string;
const savedLedgerEnv = process.env.ERASURE_LEDGER_DIR;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  store = createObjectStore({ driver: 'filesystem', dir: storeRoot });
  process.env.ERASURE_LEDGER_DIR = ledgerFolder;
  await withClient(testDb.url, async (c) => {
    ownerId = (await c.query<{ id: string }>(`INSERT INTO auth_user (email, email_verified) VALUES ('demo-replay-owner@example.test', true) RETURNING id::text`)).rows[0]!.id;
    const city = (
      await c.query<{ id: string }>(
        `INSERT INTO place (geonames_id, name, ascii_name, country_code, centroid) VALUES (999002, 'Demo City', 'Demo City', 'BG', ST_SetSRID(ST_MakePoint(23.3, 42.7), 4326)::geography) RETURNING id::text`,
      )
    ).rows[0]!.id;
    schoolId = (
      await c.query<{ id: string }>(
        `INSERT INTO school (slug, name, place_id, public_point, status, created_by_user_id)
         VALUES ('demo-replay-school', 'Demo Replay School', $1, (SELECT centroid FROM place WHERE id = $1), 'active', $2) RETURNING id::text`,
        [city, ownerId],
      )
    ).rows[0]!.id;
  });
});

afterAll(async () => {
  if (savedLedgerEnv === undefined) delete process.env.ERASURE_LEDGER_DIR;
  else process.env.ERASURE_LEDGER_DIR = savedLedgerEnv;
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

/** An inquiry of `senderId` at the test school, open unless `status` says otherwise. */
async function inquiry(senderId: string, status: 'open' | 'answered' = 'open'): Promise<string> {
  return withClient(testDb!.url, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO trial_inquiry (school_id, sender_user_id, sender_name, contact_method, contact_value, preferred_times, message, status, closed_at)
       VALUES ($1, $2, 'Demo Sender', 'email', 'demo-replay-sender@example.test', 'evenings', 'A fictional request.', $3, ${status === 'open' ? 'NULL' : 'now()'}) RETURNING id::text`,
      [schoolId, senderId, status],
    );
    return rows[0]!.id;
  });
}

const accountState = async (userId: string): Promise<'live' | 'tombstone' | 'deleted'> => {
  const [row] = await getDb().select({ email: authUser.email }).from(authUser).where(eq(authUser.id, userId));
  return !row ? 'deleted' : isErasedEmail(row.email) ? 'tombstone' : 'live';
};
const inquiryRow = async (id: string) => (await getDb().select().from(trialInquiry).where(eq(trialInquiry.id, id)))[0]!;
const ledgerLines = async () => (await readLedger({ dir: ledgerFolder })).entries;
const linesOf = async (id: string) => (await ledgerLines()).filter((e) => e.id === id).map((e) => `${e.op}:${e.state}`);

describe('the services write the ledger', () => {
  it('an erasure writes begin before the change and done after it, and a request that is refused writes nothing', async () => {
    const victim = await member('ledger-erase');
    const outcome = await eraseAccount({ actor: null, by: { userId: victim.account.id }, reason: 'A fictional request.' }, store);
    expect(outcome.userId).toBe(victim.account.id);
    expect(await accountState(victim.account.id)).not.toBe('live');
    expect(await linesOf(victim.account.id)).toEqual(['account.erase:begin', 'account.erase:done']);
    // Ids, an operation and a time: nothing else (an address or a name would show here).
    const raw = JSON.stringify((await ledgerLines()).filter((e) => e.id === victim.account.id));
    expect(raw).not.toContain(victim.account.email);
    expect(raw).not.toContain('Demo');

    // Refused before anything changes (a staff role; an unknown account): no line.
    const admin = await staff('ledger-erase-admin', 'admin');
    await expect(eraseAccount({ actor: null, by: { userId: admin.account.id }, reason: 'A fictional request.' }, store)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(eraseAccount({ actor: null, by: { userId: '00000000-0000-4000-8000-00000000aaaa' }, reason: 'A fictional request.' }, store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await linesOf(admin.account.id)).toEqual([]);
    expect(await linesOf('00000000-0000-4000-8000-00000000aaaa')).toEqual([]);
    // Already erased: the second call is refused and adds no line.
    if ((await accountState(victim.account.id)) === 'tombstone') {
      await expect(eraseAccount({ actor: null, by: { userId: victim.account.id }, reason: 'A fictional request.' }, store)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await linesOf(victim.account.id)).toEqual(['account.erase:begin', 'account.erase:done']);
    }
  });

  it('refuses the erasure, and changes nothing, when the ledger cannot be written', async () => {
    const victim = await member('ledger-closed');
    const blocker = path.join(root, 'a-file-not-a-folder');
    writeFileSync(blocker, 'x');
    process.env.ERASURE_LEDGER_DIR = path.join(blocker, 'erasures');
    try {
      const error = await eraseAccount({ actor: null, by: { userId: victim.account.id }, reason: 'A fictional request.' }, store).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErasureLedgerError);
      expect((error as Error).message).toContain('so nothing was changed');
    } finally {
      process.env.ERASURE_LEDGER_DIR = ledgerFolder;
    }
    // The account, its profile and its sign-in data are as they were; no audit row of an erasure.
    expect(await accountState(victim.account.id)).toBe('live');
    const [kept] = await getDb().select({ claimedBy: person.claimedByUserId }).from(person).where(eq(person.id, victim.personId));
    expect(kept!.claimedBy).toBe(victim.account.id);
    expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, victim.account.id)))).toEqual([]);
    expect(await linesOf(victim.account.id)).toEqual([]);
  });

  it('a withdrawal writes begin and done; a request that cannot be withdrawn, or a ledger that cannot be written, leaves it open', async () => {
    const sender = await member('ledger-trial');
    const sent = await inquiry(sender.account.id);
    const answeredSender = await member('ledger-trial-answered');
    const answered = await inquiry(answeredSender.account.id, 'answered');
    const blockedSender = await member('ledger-trial-blocked');
    const blocked = await inquiry(blockedSender.account.id);

    const blocker = path.join(root, 'a-file-not-a-folder-2');
    writeFileSync(blocker, 'x');
    process.env.ERASURE_LEDGER_DIR = path.join(blocker, 'erasures');
    try {
      const error = await withdrawTrial(blockedSender.principal, { inquiryId: blocked }, meta).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErasureLedgerError);
    } finally {
      process.env.ERASURE_LEDGER_DIR = ledgerFolder;
    }
    expect(await inquiryRow(blocked)).toMatchObject({ status: 'open', senderName: 'Demo Sender', scrubbedAt: null });
    expect(await linesOf(blocked)).toEqual([]);

    // Not the sender's, or not open any more: refused, no line.
    await expect(withdrawTrial(sender.principal, { inquiryId: answered }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(withdrawTrial(answeredSender.principal, { inquiryId: answered }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await linesOf(answered)).toEqual([]);

    await withdrawTrial(sender.principal, { inquiryId: sent }, meta);
    expect(await linesOf(sent)).toEqual(['trial.withdraw:begin', 'trial.withdraw:done']);
    // A second press is a replay of the first: no new line.
    await withdrawTrial(sender.principal, { inquiryId: sent }, meta);
    expect(await linesOf(sent)).toEqual(['trial.withdraw:begin', 'trial.withdraw:done']);
  });
});

describe('replayErasures', () => {
  it('brings a restored database back to the erased state, safely, and twice over', async () => {
    // The restored database still shows these as live, while the ledger says they were erased.
    const confirmed = await member('replay-confirmed');
    const unconfirmed = await member('replay-unconfirmed');
    const staffed = await staff('replay-staff', 'admin');
    const aborted = await member('replay-aborted');
    const absent = '00000000-0000-4000-8000-00000000bbbb';
    const openRequest = await inquiry((await member('replay-trial-sender')).account.id);
    const answeredRequest = await inquiry((await member('replay-trial-answered')).account.id, 'answered');
    // The real flows' own lines (an account erased and a request withdrawn before the dump) read as "already".
    const erasedBefore = await member('replay-already');
    await eraseAccount({ actor: null, by: { userId: erasedBefore.account.id }, reason: 'A fictional request.' }, store);
    const sender = await member('replay-trial-already');
    const withdrawnBefore = await inquiry(sender.account.id);
    await withdrawTrial(sender.principal, { inquiryId: withdrawnBefore }, meta);

    const write = async (op: 'account.erase' | 'trial.withdraw', id: string, ...states: ('begin' | 'done' | 'aborted')[]) => {
      for (const state of states) await appendLedger({ op, id, state });
    };
    await write('account.erase', confirmed.account.id, 'begin', 'done');
    await write('account.erase', unconfirmed.account.id, 'begin');
    await write('account.erase', staffed.account.id, 'begin', 'done');
    await write('account.erase', aborted.account.id, 'begin', 'aborted');
    await write('account.erase', absent, 'begin', 'done');
    await write('trial.withdraw', openRequest, 'begin', 'done');
    await write('trial.withdraw', answeredRequest, 'begin', 'done');
    const linesBefore = (await ledgerLines()).length;

    // 1. A dry run reports and changes nothing.
    const dry = await replayErasures({ dir: ledgerFolder });
    expect(dry.apply).toBe(false);
    const byId = (report: typeof dry, id: string) => report.lines.find((l) => l.id === id)!;
    expect(byId(dry, confirmed.account.id)).toMatchObject({ state: 'present', action: 'would-erase', confirmed: true });
    expect(byId(dry, unconfirmed.account.id)).toMatchObject({ state: 'present', action: 'skipped-unconfirmed', confirmed: false });
    expect(byId(dry, staffed.account.id)).toMatchObject({ state: 'blocked', action: 'blocked' });
    expect(byId(dry, absent)).toMatchObject({ state: 'absent', action: 'nothing' });
    expect(byId(dry, erasedBefore.account.id)).toMatchObject({ state: expect.stringMatching(/^(already|absent)$/), action: 'nothing' });
    expect(byId(dry, openRequest)).toMatchObject({ state: 'present', action: 'would-erase' });
    expect(byId(dry, answeredRequest)).toMatchObject({ state: 'blocked', action: 'blocked' });
    expect(byId(dry, withdrawnBefore)).toMatchObject({ state: 'already', action: 'nothing' });
    // An aborted erasure is not repeated: it is not even listed.
    expect(dry.lines.find((l) => l.id === aborted.account.id)).toBeUndefined();
    expect(await accountState(confirmed.account.id)).toBe('live');
    expect((await inquiryRow(openRequest)).status).toBe('open');

    // 2. Apply: the confirmed ones are carried out; the unconfirmed one waits; the blocked ones stay as they are.
    const applied = await replayErasures({ dir: ledgerFolder, apply: true, evidenceStore: store });
    expect(byId(applied, confirmed.account.id)).toMatchObject({ action: 'erased' });
    expect(byId(applied, openRequest)).toMatchObject({ action: 'erased' });
    expect(summariseReplay(applied)).toMatchObject({ erased: 2, 'skipped-unconfirmed': 1, blocked: 2, failed: 0 });
    expect(await accountState(confirmed.account.id)).not.toBe('live');
    expect(await accountState(unconfirmed.account.id)).toBe('live');
    expect(await accountState(staffed.account.id)).toBe('live');
    expect(await accountState(aborted.account.id)).toBe('live');
    expect(await inquiryRow(openRequest)).toMatchObject({ status: 'withdrawn', senderName: null, contactValue: null, preferredTimes: null, message: null });
    expect((await inquiryRow(openRequest)).scrubbedAt).not.toBeNull();
    expect(await inquiryRow(answeredRequest)).toMatchObject({ status: 'answered', senderName: 'Demo Sender' });
    // The audit log says it was repeated, by whom (the system, no administrator) and why, with ids only.
    const [erasedAudit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, confirmed.account.id)));
    expect(erasedAudit).toMatchObject({ actorUserId: null, reason: REPLAY_REASON });
    const [withdrawnAudit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'trial.withdraw'), eq(auditLog.subjectId, openRequest)));
    expect(withdrawnAudit).toMatchObject({ actorUserId: null, actorRole: 'system', reason: REPLAY_REASON, after: { status: 'withdrawn', schoolId } });
    // Replay writes no ledger line of its own.
    expect((await ledgerLines()).length).toBe(linesBefore);

    // 3. Only with --include-unconfirmed does the unconfirmed one go.
    const withUnconfirmed = await replayErasures({ dir: ledgerFolder, apply: true, includeUnconfirmed: true, evidenceStore: store });
    expect(byId(withUnconfirmed, unconfirmed.account.id)).toMatchObject({ action: 'erased' });
    expect(await accountState(unconfirmed.account.id)).not.toBe('live');

    // 4. Run again: nothing is left to do, and nothing throws.
    const again = await replayErasures({ dir: ledgerFolder, apply: true, includeUnconfirmed: true, evidenceStore: store });
    expect(summariseReplay(again)).toMatchObject({ erased: 0, 'would-erase': 0, 'skipped-unconfirmed': 0, blocked: 2, failed: 0 });
    expect(settleLedger((await ledgerLines())).length).toBe(again.lines.length);
  });

  it('reports a ledger line it cannot read and an empty ledger without failing', async () => {
    const empty = await replayErasures({ dir: path.join(root, 'no-such-folder') });
    expect(empty).toMatchObject({ lines: [], unreadable: 0, apply: false });
    const torn = path.join(root, 'torn');
    await appendLedger({ op: 'account.erase', id: '00000000-0000-4000-8000-00000000cccc', state: 'done' }, { dir: torn });
    writeFileSync(path.join(torn, 'ledger.ndjson'), '{"v":1,"at":"2026-11-14T10:00:00.000Z","op":"acc', { flag: 'a' });
    const report = await replayErasures({ dir: torn });
    expect(report.unreadable).toBe(1);
    expect(report.lines).toHaveLength(1);
  });
});
