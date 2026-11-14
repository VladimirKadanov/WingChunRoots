// The erasure ledger (review 2026-11, docs/adr/0032-retention-and-withdrawal.md, Q6 of
// docs/plan/questions/review-2026-11-retention.md).
//
// A backup restored after an erasure brings the erased person back: the dump was taken before. The
// ledger is the record that survives a restore, because it lives OUTSIDE the database: an
// append-only file of one JSON line per erasure, written before the erasure is made and checked
// after it is done. After a restore `pnpm erasures:replay` reads it and repeats every erasure the
// restored database does not show (src/server/services/erasure-replay.ts).
//
// What a line holds: the operation, the id of the account (or trial lesson request) and the time.
// Never a name, an address or an IP address: a bare id means nothing without the database, and the
// ledger must not keep what the erasure took away.
//
//   {"v":1,"at":"2026-11-14T10:00:00.000Z","op":"account.erase","id":"<uuid>","state":"begin"}
//
// The states of one erasure, in the order they are written:
//   begin    written INSIDE the erasure's transaction, after every refusal and before the first change.
//            If it cannot be written the erasure is refused and nothing changes (fail closed): an
//            erasure that no restore can repeat is worse than a delayed one.
//   done     written after the commit.
//   aborted  written when the transaction failed after `begin`.
// A `begin` with neither a `done` nor an `aborted` is UNCONFIRMED: the process stopped between the
// commit and the last line, or the last line could not be written. Replay lists it and repeats it
// only when it is told to.
//
// Time-based purges (src/server/services/retention-records.ts) need no ledger: the daily job
// repeats them on the restored database by itself.
//
// Where: ERASURE_LEDGER_DIR, else `erasures/` inside the backup folder (BACKUP_DIR), so the ledger
// travels with the archives it corrects and is covered by the same off-site copy. A line is a single
// O_APPEND write of well under a page, flushed with fsync; the folder is 0700 and the file 0600.

import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

import * as z from 'zod';

import { backupDir } from './backups';
import { logger } from './log';

type Env = Record<string, string | undefined>;

export const LEDGER_FILE = 'ledger.ndjson';

export const LEDGER_OPERATIONS = ['account.erase', 'trial.withdraw'] as const;
export type LedgerOperation = (typeof LEDGER_OPERATIONS)[number];
export const LEDGER_STATES = ['begin', 'done', 'aborted'] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

const entrySchema = z.object({
  v: z.literal(1),
  at: z.iso.datetime(),
  op: z.enum(LEDGER_OPERATIONS),
  id: z.uuid(),
  state: z.enum(LEDGER_STATES),
});
export type LedgerEntry = z.infer<typeof entrySchema>;

/** The ledger could not be written or read. The message names the folder and the system error code, never a person. */
export class ErasureLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErasureLedgerError';
  }
}

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown error';

/**
 * The folder of the ledger. DEFAULT review-2026-11: ERASURE_LEDGER_DIR, else `erasures/` in the backup
 * folder: next to the archives it corrects, covered by the same off-site copy, and a place the web
 * process may write (docker-compose.yml mounts it read-write at /erasures).
 */
export function ledgerDir(env: Env = process.env, cwd: string = process.cwd()): string {
  const set = env.ERASURE_LEDGER_DIR?.trim();
  return set ? path.resolve(cwd, set) : path.join(backupDir(env, cwd), 'erasures');
}

export interface LedgerOptions {
  /** The ledger folder (default: ledgerDir()). */
  dir?: string;
  /** The time written (default: now). */
  now?: Date;
}

/** Appends one line and flushes it to disk. Throws ErasureLedgerError when it cannot. */
export async function appendLedger(entry: { op: LedgerOperation; id: string; state: LedgerState }, options: LedgerOptions = {}): Promise<void> {
  const dir = options.dir ?? ledgerDir();
  const line = JSON.stringify({ v: 1, at: (options.now ?? new Date()).toISOString(), op: entry.op, id: entry.id, state: entry.state } satisfies LedgerEntry);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const handle = await open(path.join(dir, LEDGER_FILE), 'a+', 0o600);
    try {
      const { size } = await handle.stat();
      // A line torn by a crash has no newline: start a new line, so the torn one cannot swallow this one.
      let prefix = '';
      if (size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, size - 1);
        if (last[0] !== 0x0a) prefix = '\n';
      }
      await handle.write(`${prefix}${line}\n`);
      await handle.sync();
      if (size === 0) await syncFolder(dir);
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new ErasureLedgerError(
      `The erasure ledger cannot be written (${errorCode(error)}) in ${dir}, so nothing was changed. Check ERASURE_LEDGER_DIR and the folder's permissions (docs/operations/backup-and-restore.md).`,
    );
  }
}

/** Makes the new file's directory entry durable; best effort (a folder cannot be opened on every system). */
async function syncFolder(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // The line itself is already on disk.
  }
}

export interface LedgerRead {
  entries: LedgerEntry[];
  /** Lines that are not an entry of this version (a torn line after a crash, or a newer format). Skipped, counted. */
  unreadable: number;
}

/** Every entry of the ledger in the order written; an absent file is an empty ledger. */
export async function readLedger(options: Pick<LedgerOptions, 'dir'> = {}): Promise<LedgerRead> {
  const dir = options.dir ?? ledgerDir();
  let text: string;
  try {
    text = await readFile(path.join(dir, LEDGER_FILE), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { entries: [], unreadable: 0 };
    throw new ErasureLedgerError(`The erasure ledger cannot be read (${errorCode(error)}) in ${dir}.`);
  }
  const entries: LedgerEntry[] = [];
  let unreadable = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    const parsed = entrySchema.safeParse(json);
    if (parsed.success) entries.push(parsed.data);
    else unreadable += 1;
  }
  return { entries, unreadable };
}

export interface LedgerItem {
  op: LedgerOperation;
  id: string;
  /** When its first line was written (ISO 8601): the order of replay. */
  at: string;
  /** `done` was written; false: only `begin` (unconfirmed). */
  confirmed: boolean;
}

/**
 * The erasures to repeat after a restore, oldest first: one item per operation and id.
 *   - any `done` line: confirmed;
 *   - otherwise, a last line of `aborted`: it was not made, so it is left out;
 *   - otherwise a last line of `begin`: unconfirmed.
 */
export function settleLedger(entries: readonly LedgerEntry[]): LedgerItem[] {
  const byKey = new Map<string, { op: LedgerOperation; id: string; at: string; done: boolean; last: LedgerState }>();
  for (const entry of entries) {
    const key = `${entry.op}:${entry.id}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { op: entry.op, id: entry.id, at: entry.at, done: entry.state === 'done', last: entry.state });
    } else {
      seen.done ||= entry.state === 'done';
      seen.last = entry.state;
    }
  }
  const items: LedgerItem[] = [];
  for (const seen of byKey.values()) {
    if (seen.done) items.push({ op: seen.op, id: seen.id, at: seen.at, confirmed: true });
    else if (seen.last === 'begin') items.push({ op: seen.op, id: seen.id, at: seen.at, confirmed: false });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** What a caller does after `begin`: `done` once the change is committed, `aborted` when it failed. Neither throws. */
export interface LedgerHandle {
  done(): Promise<void>;
  aborted(): Promise<void>;
}

/**
 * Writes `begin` and returns the handle for the rest. Throws ErasureLedgerError (fail closed) when
 * `begin` cannot be written: the caller is inside its transaction, which rolls back.
 */
export async function beginLedger(op: LedgerOperation, id: string, options: Pick<LedgerOptions, 'dir'> = {}): Promise<LedgerHandle> {
  await appendLedger({ op, id, state: 'begin' }, options);
  const close = (state: 'done' | 'aborted') => async () => {
    try {
      await appendLedger({ op, id, state }, options);
    } catch (error) {
      // The change is already made (done) or was never made (aborted): the caller must not hear a failure.
      // Ids only. A bare `begin` is listed by pnpm erasures:replay as unconfirmed.
      logger().error(`[erasure-ledger] the "${state}" line of ${op} ${id} could not be written: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return { done: close('done'), aborted: close('aborted') };
}
