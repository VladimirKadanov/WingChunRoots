// The arguments and the local-only rule of `pnpm account:delete` (milestone M07, In scope 5 and 9).

import { describe, expect, it } from 'vitest';

import { accountDeleteArguments } from './account-delete';
import { assertLocalEnvironment } from './admin-create';

const CASE = '0199f2a4-3b6c-7d10-8e2f-1a2b3c4d5e6f';

describe('accountDeleteArguments', () => {
  it('reads --case <id>, --case=<id> and --cancel', () => {
    expect(accountDeleteArguments(['--case', CASE])).toEqual({ caseId: CASE, cancel: false });
    expect(accountDeleteArguments(['--', `--case=${CASE}`])).toEqual({ caseId: CASE, cancel: false });
    expect(accountDeleteArguments(['--case', ` ${CASE} `, '--cancel'])).toEqual({ caseId: CASE, cancel: true });
    expect(accountDeleteArguments(['--cancel', '--case', CASE])).toEqual({ caseId: CASE, cancel: true });
  });

  it('is null without a case id or with an unknown argument', () => {
    expect(accountDeleteArguments([])).toBeNull();
    expect(accountDeleteArguments(['--case'])).toBeNull();
    expect(accountDeleteArguments(['--case='])).toBeNull();
    expect(accountDeleteArguments(['--case', '--cancel'])).toBeNull();
    expect(accountDeleteArguments(['--cancel'])).toBeNull();
    expect(accountDeleteArguments([CASE])).toBeNull();
    expect(accountDeleteArguments(['--case', CASE, '--force'])).toBeNull();
  });
});

describe('assertLocalEnvironment for account:delete', () => {
  it('names the command it refuses', () => {
    const local = 'postgres://postgres:throwaway@127.0.0.1:5432/wingchunroots';
    expect(() => assertLocalEnvironment({ DATABASE_URL: local }, 'account:delete')).not.toThrow();
    expect(() => assertLocalEnvironment({ DATABASE_URL: local, NODE_ENV: 'production' }, 'account:delete')).toThrow(/account:delete/);
    expect(() => assertLocalEnvironment({ DATABASE_URL: 'postgres://postgres:throwaway@db.example.test:5432/wcr' }, 'account:delete')).toThrow(
      /account:delete works only with a database on this machine/,
    );
  });
});
