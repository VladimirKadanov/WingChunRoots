import { describe, expect, it } from 'vitest';

import { nextSteps } from './next-steps';

const base = { accountType: 'student' as const, instructor: 'not_instructor' as const, hasProfile: false, staffOnly: false, teacherLinks: 0, schools: 0 };

describe('nextSteps', () => {
  it('asks a new student for a profile, then a teacher', () => {
    expect(nextSteps(base).map((s) => [s.key, s.done])).toEqual([
      ['profile', false],
      ['teacher', false],
      ['public', false],
      ['photo', false],
    ]);
    expect(nextSteps({ ...base, hasProfile: true }).map((s) => [s.key, s.done])).toEqual([
      ['profile', true],
      ['teacher', false],
      ['public', false],
      ['photo', false],
    ]);
  });

  it('disappears once every step is done', () => {
    const looks = { profilePublic: true, hasPhoto: true };
    expect(nextSteps({ ...base, hasProfile: true, teacherLinks: 1, ...looks })).toEqual([]);
    expect(nextSteps({ ...base, accountType: 'sifu', instructor: 'verified', hasProfile: true, schools: 2, teacherLinks: 1, students: 1, ...looks })).toEqual([]);
    // Role replay 2026-11-25 (P2-2): a private profile, or one without a photo, keeps the card.
    expect(nextSteps({ ...base, hasProfile: true, teacherLinks: 1, hasPhoto: true }).filter((s) => !s.done).map((s) => s.key)).toEqual(['public']);
    expect(nextSteps({ ...base, hasProfile: true, teacherLinks: 1, profilePublic: true }).filter((s) => !s.done).map((s) => s.key)).toEqual(['photo']);
  });

  it('gives a Sifu their teacher, a public profile, students, a school and verification, in that order (P2-3)', () => {
    const steps = nextSteps({ ...base, accountType: 'sifu', instructor: 'unverified', hasProfile: true });
    expect(steps.map((s) => s.key)).toEqual(['profile', 'teacher', 'public', 'invite', 'school', 'instructor', 'photo']);
    expect(steps.find((s) => s.key === 'school')?.href).toBe('/dashboard/schools/new');
    expect(steps.find((s) => s.key === 'invite')?.href).toBe('/dashboard/students/invite');
    const done = nextSteps({ ...base, accountType: 'sifu', instructor: 'verified', hasProfile: true, teacherLinks: 1, students: 3, schools: 1, profilePublic: true, hasPhoto: true });
    expect(done).toEqual([]);
  });

  it('keeps a beginner’s steps until a teacher is named (P2-1)', () => {
    const steps = nextSteps({ ...base, hasProfile: true, beginner: true });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ['profile', true],
      ['find-school', false],
      ['events', false],
      ['teacher', false],
    ]);
    expect(steps.find((s) => s.key === 'teacher')?.label).toBe('Started training? Name your teacher');
    expect(nextSteps({ ...base, hasProfile: true, beginner: true, trials: 1 }).find((s) => s.key === 'find-school')?.done).toBe(true);
    // Once a teacher is named, the usual steps.
    expect(nextSteps({ ...base, hasProfile: true, beginner: true, teacherLinks: 1 }).map((s) => s.key)).toEqual(['profile', 'teacher', 'public', 'photo']);
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
