// The decision logic of the data check of db:seed and db:reset (review 2026-11-13, ops.md H2): no
// database in it, only the counts and the environment. The checks against a real database are in
// wipe-guard.int.test.ts.

import { describe, expect, it } from 'vitest';

import { ALLOW_WIPE_VARIABLE, DEMO_SLUG_TABLES, describeFindings, hasNonDemoData, type NonDemoFindings, wipeVerdict } from './wipe-guard';

const NOTHING: NonDemoFindings = { bySlug: { person: 0, school: 0, organization: 0, lineage: 0, event: 0 }, accounts: 0 };
const with_ = (patch: Partial<NonDemoFindings['bySlug']> & { accounts?: number }): NonDemoFindings => {
  const { accounts, ...bySlug } = patch;
  return { bySlug: { ...NOTHING.bySlug, ...bySlug }, accounts: accounts ?? 0 };
};
const TARGET = 'postgres://postgres:***@127.0.0.1:5432/wingchunroots';

describe('wipeVerdict', () => {
  it('lets a database with nothing in it, or only demo data, be wiped', () => {
    expect(wipeVerdict('db:seed', TARGET, NOTHING, {})).toEqual({ allowed: true, via: 'demo-only' });
    expect(wipeVerdict('db:reset', TARGET, NOTHING, { [ALLOW_WIPE_VARIABLE]: '' })).toEqual({ allowed: true, via: 'demo-only' });
  });

  it('refuses a person whose slug is not demo-, whichever command asks', () => {
    for (const command of ['db:seed', 'db:reset']) {
      const verdict = wipeVerdict(command, TARGET, with_({ person: 1 }), {});
      expect(verdict.allowed).toBe(false);
      if (verdict.allowed) throw new Error('unreachable');
      expect(verdict.message).toContain(`${command} refuses ${TARGET}`);
      expect(verdict.message).toContain('1 person whose slug does not start with demo-');
    }
  });

  it('refuses an account outside the reserved .test domain, and says how many', () => {
    const verdict = wipeVerdict('db:seed', TARGET, with_({ accounts: 3 }), {});
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.message).toContain('3 accounts whose address is not in the reserved .test domain');
  });

  it('refuses a school, an organization, a lineage or an event that is not demo data', () => {
    for (const table of DEMO_SLUG_TABLES) {
      expect(wipeVerdict('db:seed', TARGET, with_({ [table]: 2 }), {}).allowed, table).toBe(false);
    }
  });

  it('names the variable, the backup advice and the separate-database rule in the refusal, and no personal data', () => {
    const verdict = wipeVerdict('db:reset', TARGET, with_({ person: 2, accounts: 1 }), {});
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.message).toContain('WCR_ALLOW_WIPE=1');
    expect(verdict.message).toContain('separate database');
    expect(verdict.message).toContain('drops every application table');
    // Counts and words only: no quoted value, no address.
    expect(verdict.message.replace(TARGET, '')).not.toMatch(/@|'|"/);
  });

  it('says "empties" for db:seed and "drops" for db:reset', () => {
    const seed = wipeVerdict('db:seed', TARGET, with_({ person: 1 }), {});
    const reset = wipeVerdict('db:reset', TARGET, with_({ person: 1 }), {});
    if (seed.allowed || reset.allowed) throw new Error('unreachable');
    expect(seed.message).toContain('empties every application table');
    expect(reset.message).toContain('drops every application table');
  });

  it('allows the wipe only with WCR_ALLOW_WIPE exactly "1"', () => {
    const findings = with_({ person: 5, accounts: 2 });
    expect(wipeVerdict('db:seed', TARGET, findings, { [ALLOW_WIPE_VARIABLE]: '1' })).toEqual({ allowed: true, via: ALLOW_WIPE_VARIABLE });
    for (const value of ['', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', 'on', undefined]) {
      expect(wipeVerdict('db:seed', TARGET, findings, { [ALLOW_WIPE_VARIABLE]: value }).allowed, String(value)).toBe(false);
    }
  });

  it('does not let the variable make a demo-only database look wiped by override', () => {
    expect(wipeVerdict('db:seed', TARGET, NOTHING, { [ALLOW_WIPE_VARIABLE]: '1' })).toEqual({ allowed: true, via: 'demo-only' });
  });
});

describe('describeFindings', () => {
  it('is empty for a database of demo data only, and singular or plural by count', () => {
    expect(describeFindings(NOTHING)).toEqual([]);
    expect(hasNonDemoData(NOTHING)).toBe(false);
    expect(describeFindings(with_({ person: 1, school: 2, accounts: 1 }))).toEqual([
      '1 person whose slug does not start with demo-',
      '2 schools whose slug does not start with demo-',
      '1 account whose address is not in the reserved .test domain',
    ]);
    expect(hasNonDemoData(with_({ lineage: 1 }))).toBe(true);
  });
});
