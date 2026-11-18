import { describe, expect, it } from 'vitest';

import { nextSteps } from './next-steps';

const base = { accountType: 'student' as const, instructor: 'not_instructor' as const, hasProfile: false, staffOnly: false, teacherLinks: 0, schools: 0 };

describe('nextSteps', () => {
  it('asks a new student for a profile, then a teacher', () => {
    expect(nextSteps(base).map((s) => [s.key, s.done])).toEqual([
      ['profile', false],
      ['teacher', false],
    ]);
    expect(nextSteps({ ...base, hasProfile: true }).map((s) => [s.key, s.done])).toEqual([
      ['profile', true],
      ['teacher', false],
    ]);
  });

  it('disappears once every step is done', () => {
    expect(nextSteps({ ...base, hasProfile: true, teacherLinks: 1 })).toEqual([]);
    expect(nextSteps({ ...base, accountType: 'sifu', instructor: 'verified', hasProfile: true, schools: 2 })).toEqual([]);
  });

  it('gives a Sifu verification and a school instead of a teacher', () => {
    const steps = nextSteps({ ...base, accountType: 'sifu', instructor: 'unverified', hasProfile: true });
    expect(steps.map((s) => s.key)).toEqual(['profile', 'instructor', 'school']);
    expect(steps.find((s) => s.key === 'school')?.href).toBe('/dashboard/schools/new');
  });

  it('asks nothing of a staff account without a profile', () => {
    expect(nextSteps({ ...base, staffOnly: true })).toEqual([]);
  });

  it('waits while a claim of a profile is with the reviewers', () => {
    expect(nextSteps({ ...base, pendingClaim: true })).toEqual([]);
  });

  it('sends the profile step back to the dashboard', () => {
    expect(nextSteps(base)[0]!.href).toBe('/onboarding?next=%2Fdashboard');
  });
});
