// The erasure ledger (src/server/erasure-ledger.ts): the lines, their settling, the torn line of a
// crash and the refusal when the folder cannot be written. Fictional ids only (D20).

import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { appendLedger, beginLedger, ErasureLedgerError, LEDGER_FILE, ledgerDir, readLedger, settleLedger } from './erasure-ledger';

const root = mkdtempSync(path.join(tmpdir(), 'wcr-ledger-unit-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
const folder = () => path.join(root, `ledger-${(counter += 1)}`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 10, minute));

describe('where the ledger lives', () => {
  it('is ERASURE_LEDGER_DIR when set, else erasures/ in the backup folder', () => {
    expect(ledgerDir({ ERASURE_LEDGER_DIR: '/var/lib/wcr/erasures' }, '/srv/app')).toBe(path.resolve('/var/lib/wcr/erasures'));
    expect(ledgerDir({ ERASURE_LEDGER_DIR: 'ledger' }, '/srv/app')).toBe(path.resolve('/srv/app', 'ledger'));
    expect(ledgerDir({ BACKUP_DIR: '/mnt/backups' }, '/srv/app')).toBe(path.join(path.resolve('/mnt/backups'), 'erasures'));
    expect(ledgerDir({}, '/srv/app')).toBe(path.join(path.resolve('/srv/app', 'backups'), 'erasures'));
    expect(ledgerDir({ ERASURE_LEDGER_DIR: '  ', BACKUP_DIR: '/mnt/backups' }, '/srv/app')).toBe(path.join(path.resolve('/mnt/backups'), 'erasures'));
  });
});

describe('appendLedger and readLedger', () => {
  it('writes one JSON line per entry, with ids, the operation and the time, and nothing else', async () => {
    const dir = folder();
    await appendLedger({ op: 'account.erase', id: id(1), state: 'begin' }, { dir, now: at(1) });
    await appendLedger({ op: 'account.erase', id: id(1), state: 'done' }, { dir, now: at(2) });
    const lines = readFileSync(path.join(dir, LEDGER_FILE), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ v: 1, at: at(1).toISOString(), op: 'account.erase', id: id(1), state: 'begin' });
    expect(Object.keys(JSON.parse(lines[1]!)).sort()).toEqual(['at', 'id', 'op', 'state', 'v']);
    expect(await readLedger({ dir })).toEqual({
      entries: [
        { v: 1, at: at(1).toISOString(), op: 'account.erase', id: id(1), state: 'begin' },
        { v: 1, at: at(2).toISOString(), op: 'account.erase', id: id(1), state: 'done' },
      ],
      unreadable: 0,
    });
  });

  it('keeps the file private to its owner', async () => {
    if (process.platform === 'win32') return;
    const dir = folder();
    await appendLedger({ op: 'trial.withdraw', id: id(2), state: 'begin' }, { dir });
    expect(statSync(path.join(dir, LEDGER_FILE)).mode & 0o077).toBe(0);
    expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it('reads a ledger that does not exist as an empty one', async () => {
    expect(await readLedger({ dir: folder() })).toEqual({ entries: [], unreadable: 0 });
  });

  it('starts a new line after a line torn by a crash, so the torn one cannot swallow the next', async () => {
    const dir = folder();
    await appendLedger({ op: 'account.erase', id: id(3), state: 'begin' }, { dir, now: at(1) });
    appendFileSync(path.join(dir, LEDGER_FILE), '{"v":1,"at":"2026-11-14T10:02:00.000Z","op":"account.er');
    await appendLedger({ op: 'account.erase', id: id(4), state: 'begin' }, { dir, now: at(3) });
    const read = await readLedger({ dir });
    expect(read.unreadable).toBe(1);
    expect(read.entries.map((e) => e.id)).toEqual([id(3), id(4)]);
  });

  it('skips and counts lines that are not an entry of this version', async () => {
    const dir = folder();
    const good = { v: 1, at: at(1).toISOString(), op: 'account.erase', id: id(5), state: 'done' };
    await appendLedger({ op: 'account.erase', id: id(5), state: 'begin' }, { dir, now: at(0) });
    appendFileSync(
      path.join(dir, LEDGER_FILE),
      [
        JSON.stringify(good),
        JSON.stringify({ ...good, v: 2 }),
        JSON.stringify({ ...good, op: 'something.else' }),
        JSON.stringify({ ...good, id: 'not-an-id' }),
        'not json',
        '',
      ].join('\n'),
    );
    const read = await readLedger({ dir });
    expect(read.entries).toHaveLength(2);
    expect(read.unreadable).toBe(4);
  });

  it('refuses, naming the folder and no person, when it cannot write (fail closed)', async () => {
    // A regular file where the folder should be: mkdir fails on every system, whoever runs the test.
    const blocker = path.join(root, 'not-a-folder');
    writeFileSync(blocker, 'x');
    const error = await appendLedger({ op: 'account.erase', id: id(6), state: 'begin' }, { dir: path.join(blocker, 'erasures') }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErasureLedgerError);
    expect((error as Error).message).toMatch(/The erasure ledger cannot be written \(\w+\) in .*erasures, so nothing was changed/);
    expect((error as Error).message).not.toContain(id(6));
    await expect(beginLedger('account.erase', id(6), { dir: path.join(blocker, 'erasures') })).rejects.toBeInstanceOf(ErasureLedgerError);
  });
});

describe('beginLedger', () => {
  it('writes begin, then done or aborted, and never throws once begin is down', async () => {
    const dir = folder();
    const finished = await beginLedger('account.erase', id(7), { dir });
    await finished.done();
    const failed = await beginLedger('trial.withdraw', id(8), { dir });
    await failed.aborted();
    const states = (await readLedger({ dir })).entries.map((e) => `${e.op}:${e.state}`);
    expect(states).toEqual(['account.erase:begin', 'account.erase:done', 'trial.withdraw:begin', 'trial.withdraw:aborted']);
  });
});

describe('settleLedger', () => {
  const entry = (n: number, op: 'account.erase' | 'trial.withdraw', state: 'begin' | 'done' | 'aborted', minute: number) =>
    ({ v: 1 as const, at: at(minute).toISOString(), op, id: id(n), state });

  it('repeats what was done, lists a bare begin as unconfirmed, and leaves out what was aborted', () => {
    const items = settleLedger([
      entry(1, 'account.erase', 'begin', 1),
      entry(1, 'account.erase', 'done', 2),
      entry(2, 'account.erase', 'begin', 3),
      entry(3, 'trial.withdraw', 'begin', 4),
      entry(3, 'trial.withdraw', 'aborted', 5),
      entry(4, 'trial.withdraw', 'begin', 6),
      entry(4, 'trial.withdraw', 'done', 7),
    ]);
    expect(items).toEqual([
      { op: 'account.erase', id: id(1), at: at(1).toISOString(), confirmed: true },
      { op: 'account.erase', id: id(2), at: at(3).toISOString(), confirmed: false },
      { op: 'trial.withdraw', id: id(4), at: at(6).toISOString(), confirmed: true },
    ]);
  });

  it('lets a later success win over an earlier attempt, and a done line win over anything', () => {
    expect(
      settleLedger([entry(1, 'account.erase', 'begin', 1), entry(1, 'account.erase', 'aborted', 2), entry(1, 'account.erase', 'begin', 3), entry(1, 'account.erase', 'done', 4)]),
    ).toEqual([{ op: 'account.erase', id: id(1), at: at(1).toISOString(), confirmed: true }]);
    expect(settleLedger([entry(1, 'account.erase', 'begin', 1), entry(1, 'account.erase', 'done', 2), entry(1, 'account.erase', 'aborted', 3)])).toHaveLength(1);
    // A crashed attempt, then a refusal: nothing to repeat.
    expect(settleLedger([entry(1, 'account.erase', 'begin', 1), entry(1, 'account.erase', 'begin', 2), entry(1, 'account.erase', 'aborted', 3)])).toEqual([]);
  });

  it('keeps the two operations of one id apart and orders by the first line written', () => {
    const items = settleLedger([entry(9, 'trial.withdraw', 'done', 5), entry(9, 'account.erase', 'done', 2)]);
    expect(items.map((i) => i.op)).toEqual(['account.erase', 'trial.withdraw']);
  });
});
