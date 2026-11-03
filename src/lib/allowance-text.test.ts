import { describe, expect, it } from 'vitest';

import { allowanceSentence, allowanceShort } from './allowance-text';
import { findFomo } from './copy/no-fomo';

const photos = { one: 'photo', many: 'photos', verb: 'added' };
const students = { one: 'student', many: 'students', verb: 'approved' };

describe('allowanceSentence', () => {
  it('counts against the limit within it, and at it', () => {
    expect(allowanceSentence(photos, 0, 1, 'Free Student', true)).toBe('You have added 0 of 1 photo on Free Student.');
    expect(allowanceSentence(photos, 1, 1, 'Free Student', true)).toBe('You have added 1 of 1 photo on Free Student.');
    expect(allowanceSentence(photos, 2, 10, 'Premium Student', true)).toBe('You have added 2 of 10 photos on Premium Student.');
    expect(allowanceSentence(students, 5, 5, 'Free Sifu')).toBe('You have approved 5 of 5 students on Free Sifu.');
  });

  it('says plainly when an account holds more than its plan includes, never "3 of 1"', () => {
    // After a downgrade or an ended grant: 3 photos on Free Student, which includes 1.
    const sentence = allowanceSentence(photos, 3, 1, 'Free Student', true);
    expect(sentence).toBe('You have 3 photos; Free Student includes 1. Remove 3 to add another.');
    expect(sentence).not.toMatch(/\d+ of \d+/);
    // Removing all but the limit leaves it used up: one more to remove before one can be added.
    expect(allowanceSentence(photos, 12, 10, 'Premium Student', true)).toBe('You have 12 photos; Premium Student includes 10. Remove 3 to add another.');
    // Where nothing can be removed to make room, only the facts.
    expect(allowanceSentence(students, 7, 5, 'Free Sifu')).toBe('You have 7 students; Free Sifu includes 5.');
  });

  it('names no limit where the plan has none', () => {
    expect(allowanceSentence(photos, 4, null, 'Federation', true)).toBe('You have added 4 photos on Federation, which has no set limit.');
    expect(allowanceSentence(photos, 1, null, 'Federation', true)).toBe('You have added 1 photo on Federation, which has no set limit.');
  });

  it('has no urgency or scarcity words (CLAUDE.md §11)', () => {
    for (const s of [allowanceSentence(photos, 3, 1, 'Free Student', true), allowanceSentence(photos, 1, 1, 'Free Student', true), allowanceShort('approved', 7, 5, 'Free Sifu')]) {
      expect(findFomo(s), s).toEqual([]);
    }
  });
});

describe('allowanceShort', () => {
  it('within, at and over the limit, and with no limit', () => {
    expect(allowanceShort('approved', 3, 5, 'Free Sifu')).toBe('3 of 5 approved on Free Sifu');
    expect(allowanceShort('approved', 5, 5, 'Free Sifu')).toBe('5 of 5 approved on Free Sifu');
    expect(allowanceShort('approved', 7, 5, 'Free Sifu')).toBe('7 approved; Free Sifu includes 5');
    expect(allowanceShort('approved', 7, null, 'Professional Sifu')).toBe('7 approved, no limit on Professional Sifu');
  });
});
