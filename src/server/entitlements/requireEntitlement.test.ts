// requireEntitlement() and effectivePlan() without a database (M08, Done when 2): the pure core
// in effective.ts decides from the account type, the grants and the current use; access.ts only
// reads those. Overlapping, expired, revoked and future grants; the free plan as the floor; the
// machine-readable refusal of plan §6.5; the quota lock key.

import { describe, expect, it } from 'vitest';

import { decide, type GrantPeriod, grantState, lowestPlanAllowing, resolveEffectivePlan } from './effective';
import { quotaLockKey } from './quota';

const NOW = new Date('2026-10-18T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);
let seq = 0;
const grant = (planCode: GrantPeriod['planCode'], from: number, to: number | null, revokedAt: number | null = null): GrantPeriod => ({
  id: `g${++seq}`,
  planCode,
  source: 'test_grant',
  startsAt: day(from),
  endsAt: to === null ? null : day(to),
  revokedAt: revokedAt === null ? null : day(revokedAt),
});

describe('grantState()', () => {
  it('tells active, scheduled, ended and revoked grants apart', () => {
    expect(grantState(grant('pro_sifu', -1, 30), NOW)).toBe('active');
    expect(grantState(grant('pro_sifu', -1, null), NOW)).toBe('active');
    expect(grantState(grant('pro_sifu', 1, 30), NOW)).toBe('scheduled');
    expect(grantState(grant('pro_sifu', -30, -1), NOW)).toBe('ended');
    expect(grantState(grant('pro_sifu', -30, 30, -1), NOW)).toBe('revoked');
  });

  it('ends a grant exactly at its end and starts it exactly at its start', () => {
    expect(grantState({ ...grant('pro_sifu', -1, 0) }, NOW)).toBe('ended');
    expect(grantState({ ...grant('pro_sifu', 0, 1) }, NOW)).toBe('active');
  });
});

describe('resolveEffectivePlan()', () => {
  it('without grants: the free plan of the account type is the floor', () => {
    expect(resolveEffectivePlan('student', [], NOW)).toMatchObject({ plan: 'free_student', floor: 'free_student', grantId: null, until: null });
    expect(resolveEffectivePlan('sifu', [], NOW)).toMatchObject({ plan: 'free_sifu', floor: 'free_sifu', grantId: null });
  });

  it('an active grant lifts the plan until its end', () => {
    const g = grant('pro_sifu', -10, 20);
    expect(resolveEffectivePlan('sifu', [g], NOW)).toMatchObject({ plan: 'pro_sifu', grantId: g.id, until: day(20) });
  });

  it('expired, revoked and future grants do not count', () => {
    const grants = [grant('pro_sifu', -30, -1), grant('pro_sifu', -30, 30, -2), grant('pro_sifu', 2, 30)];
    expect(resolveEffectivePlan('sifu', grants, NOW).plan).toBe('free_sifu');
  });

  it('overlapping grants of the same plan do not add up; the longest gives the end', () => {
    const short = grant('pro_sifu', -10, 5);
    const long = grant('pro_sifu', -2, 40);
    const result = resolveEffectivePlan('sifu', [short, long], NOW);
    expect(result).toMatchObject({ plan: 'pro_sifu', grantId: long.id, until: day(40) });
    const open = grant('pro_sifu', -1, null);
    expect(resolveEffectivePlan('sifu', [short, open, long], NOW)).toMatchObject({ grantId: open.id, until: null });
  });

  it('a revoked grant next to an active one leaves the active one in effect', () => {
    const revoked = grant('pro_sifu', -10, null, -1);
    const active = grant('pro_sifu', -5, 10);
    expect(resolveEffectivePlan('sifu', [revoked, active], NOW)).toMatchObject({ plan: 'pro_sifu', grantId: active.id });
  });

  it('a grant of the other account type is dormant: it neither lifts nor lowers the plan', () => {
    const pro = grant('pro_sifu', -1, 30);
    expect(resolveEffectivePlan('student', [pro], NOW)).toMatchObject({ plan: 'free_student', dormantGrantIds: [pro.id] });
    const premium = grant('premium_student', -1, 30);
    expect(resolveEffectivePlan('sifu', [premium], NOW)).toMatchObject({ plan: 'free_sifu', dormantGrantIds: [premium.id] });
    expect(resolveEffectivePlan('student', [premium], NOW).plan).toBe('premium_student');
  });

  it('a grant of the free plan itself changes nothing', () => {
    expect(resolveEffectivePlan('sifu', [grant('free_sifu', -1, null)], NOW)).toMatchObject({ plan: 'free_sifu', grantId: null });
  });

  it('a grant that starts later takes effect then, and one that ends returns the floor', () => {
    const later = grant('pro_sifu', 5, 30);
    expect(resolveEffectivePlan('sifu', [later], NOW).plan).toBe('free_sifu');
    expect(resolveEffectivePlan('sifu', [later], day(6)).plan).toBe('pro_sifu');
    expect(resolveEffectivePlan('sifu', [later], day(31)).plan).toBe('free_sifu');
  });
});

describe('decide(): the answer of requireEntitlement()', () => {
  it('Free Sifu approves up to 5 students (D06)', () => {
    expect(decide('approve_students', 'free_sifu', 4)).toEqual({ ok: true, plan: 'free_sifu', limit: 5, current: 4 });
    expect(decide('approve_students', 'free_sifu', 5)).toEqual({ ok: false, code: 'quota', plan: 'free_sifu', limit: 5, current: 5, grantedBy: 'pro_sifu' });
    expect(decide('approve_students', 'free_sifu', 8)).toMatchObject({ ok: false, code: 'quota', current: 8 });
  });

  it('Professional Sifu has no limit in the pilot', () => {
    expect(decide('approve_students', 'pro_sifu', 500)).toEqual({ ok: true, plan: 'pro_sifu', limit: null, current: 500 });
  });

  it('a Student account does not approve students: code plan, granted by the Sifu account type', () => {
    expect(decide('approve_students', 'free_student', 0)).toEqual({ ok: false, code: 'plan', plan: 'free_student', limit: 0, current: 0, grantedBy: 'free_sifu' });
    expect(decide('approve_students', 'premium_student', 0)).toMatchObject({ ok: false, code: 'plan', grantedBy: 'free_sifu' });
  });

  it('the public school pin needs Professional Sifu', () => {
    expect(decide('school_map', 'free_sifu', 0)).toMatchObject({ ok: false, code: 'plan', grantedBy: 'pro_sifu' });
    expect(decide('school_map', 'pro_sifu', 0)).toMatchObject({ ok: true });
  });

  it('features every plan has are allowed', () => {
    for (const plan of ['free_student', 'premium_student', 'free_sifu', 'pro_sifu'] as const) {
      expect(decide('identity', plan, 0).ok).toBe(true);
      expect(decide('claim_teachers', plan, 0).ok).toBe(true);
    }
  });

  it('never names Federation (Phase 3) as the plan that would allow something', () => {
    expect(lowestPlanAllowing('approve_students', 'pro_sifu', 10_000)).toBeNull();
    expect(lowestPlanAllowing('approve_students', 'free_sifu', 5)).toBe('pro_sifu');
  });
});

describe('quotaLockKey()', () => {
  const subject = (userId: string) => ({ kind: 'user' as const, userId });

  it('is a stable 64-bit key per feature and subject', () => {
    const a = quotaLockKey(subject('0190a5c0-0000-7000-8000-000000000001'), 'approve_students');
    expect(a).toBe(quotaLockKey(subject('0190a5c0-0000-7000-8000-000000000001'), 'approve_students'));
    expect(a).not.toBe(quotaLockKey(subject('0190a5c0-0000-7000-8000-000000000002'), 'approve_students'));
    expect(a).not.toBe(quotaLockKey(subject('0190a5c0-0000-7000-8000-000000000001'), 'photos'));
    expect(a).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(a).toBeLessThan(2n ** 63n);
  });

  it('never falls in the key space of a 32-bit hash such as hashtext() (plan §6.3)', () => {
    const keys = new Set<bigint>();
    for (let i = 0; i < 5000; i++) {
      const key = quotaLockKey(subject(`0190a5c0-0000-7000-8000-${String(i).padStart(12, '0')}`), 'approve_students');
      expect(key >= -(2n ** 31n) && key < 2n ** 31n, String(key)).toBe(false);
      keys.add(key);
    }
    expect(keys.size).toBe(5000);
  });
});
