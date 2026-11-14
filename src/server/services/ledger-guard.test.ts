// The refusals the services show when the erasure ledger cannot be written (services/ledger-guard.ts):
// a ServiceError an administrator's form or a member's page can show, never a bare "Internal server error".
// Fictional ids only (D20).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { readLedger } from '../erasure-ledger';
import { ServiceError } from './errors';
import { beginLedgerOrRefuse, LEDGER_MEMBER_MESSAGE, requireLedgerWritable } from './ledger-guard';

const root = mkdtempSync(path.join(tmpdir(), 'wcr-ledger-guard-'));
const saved = process.env.ERASURE_LEDGER_DIR;
const id = '00000000-0000-4000-8000-000000000001';

beforeAll(() => {
  writeFileSync(path.join(root, 'not-a-folder'), 'x');
});
afterEach(() => {
  if (saved === undefined) delete process.env.ERASURE_LEDGER_DIR;
  else process.env.ERASURE_LEDGER_DIR = saved;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const blocked = () => {
  process.env.ERASURE_LEDGER_DIR = path.join(root, 'not-a-folder', 'erasures');
};

describe('beginLedgerOrRefuse', () => {
  it('tells an operator the folder and the system error, and a member neither', async () => {
    blocked();
    const operator = await beginLedgerOrRefuse('account.erase', id, 'operator').catch((e: unknown) => e);
    expect(operator).toBeInstanceOf(ServiceError);
    expect(operator).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect((operator as Error).message).toMatch(/cannot be written \(\w+\) in .*erasures, so nothing was changed.*ERASURE_LEDGER_DIR/);
    expect((operator as Error).message).not.toContain(id);

    const member = await beginLedgerOrRefuse('trial.withdraw', id, 'member').catch((e: unknown) => e);
    expect(member).toBeInstanceOf(ServiceError);
    expect(member).toMatchObject({ code: 'CONFLICT', message: LEDGER_MEMBER_MESSAGE });
    expect((member as Error).message).not.toMatch(/erasures|ERASURE_LEDGER_DIR|\//);
  });

  it('writes the begin line when it can, and returns the handle', async () => {
    process.env.ERASURE_LEDGER_DIR = path.join(root, 'ok');
    const handle = await beginLedgerOrRefuse('account.erase', id, 'operator');
    await handle.done();
    const read = await readLedger({ dir: path.join(root, 'ok') });
    expect(read.entries.map((e) => `${e.op}:${e.state}`)).toEqual(['account.erase:begin', 'account.erase:done']);
  });
});

describe('requireLedgerWritable', () => {
  it('refuses early, with the same message, and writes nothing when it can', async () => {
    blocked();
    await expect(requireLedgerWritable('account.erase', 'operator')).rejects.toMatchObject({ code: 'CONFLICT' });

    process.env.ERASURE_LEDGER_DIR = path.join(root, 'ok-too');
    await expect(requireLedgerWritable('account.erase', 'operator')).resolves.toBeUndefined();
    // Only the folder was made: no line.
    expect((await readLedger({ dir: path.join(root, 'ok-too') })).entries).toEqual([]);
  });
});
