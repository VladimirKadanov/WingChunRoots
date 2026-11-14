// The arguments and the local-only rule of `pnpm erasures:replay` (review 2026-11).

import { describe, expect, it } from 'vitest';

import { assertErasuresReplayLocal, erasuresReplayArguments } from './erasures-replay';

describe('erasuresReplayArguments', () => {
  it('is a dry run by default, and reads --apply and --include-unconfirmed', () => {
    expect(erasuresReplayArguments([])).toEqual({ apply: false, includeUnconfirmed: false });
    expect(erasuresReplayArguments(['--apply'])).toEqual({ apply: true, includeUnconfirmed: false });
    expect(erasuresReplayArguments(['--', '--include-unconfirmed'])).toEqual({ apply: false, includeUnconfirmed: true });
    expect(erasuresReplayArguments(['--include-unconfirmed', '--apply'])).toEqual({ apply: true, includeUnconfirmed: true });
  });

  it('is null with an argument it does not know', () => {
    expect(erasuresReplayArguments(['--yes'])).toBeNull();
    expect(erasuresReplayArguments(['apply'])).toBeNull();
    expect(erasuresReplayArguments(['--apply', '--force'])).toBeNull();
  });
});

describe('assertErasuresReplayLocal', () => {
  it('names the command it refuses', () => {
    const local = 'postgres://postgres:throwaway@127.0.0.1:5432/wingchunroots';
    expect(() => assertErasuresReplayLocal({ DATABASE_URL: local })).not.toThrow();
    expect(() => assertErasuresReplayLocal({ DATABASE_URL: local, NODE_ENV: 'production' })).toThrow(/erasures:replay refuses to run with NODE_ENV=production/);
    expect(() => assertErasuresReplayLocal({ DATABASE_URL: 'postgres://postgres:throwaway@db.example.test:5432/wcr' })).toThrow(
      /erasures:replay works only with a database on this machine/,
    );
  });
});
