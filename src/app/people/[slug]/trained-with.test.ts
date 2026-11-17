// "I trained with <name>": offered only where the request forms can take the person, and a visitor
// keeps the chosen teacher through sign-in.

import { describe, expect, it } from 'vitest';

import { trainedWithHref } from './trained-with';

const living = {
  slug: 'demo-teacher',
  visibility: 'public',
  limited: false,
  isOwn: false,
  kind: 'living',
  lifeStatus: 'living',
  claimState: 'claimed',
} as const;

describe('trainedWithHref', () => {
  it('a living teacher with an account: the request form, with the teacher chosen', () => {
    expect(trainedWithHref(living, true)).toBe('/dashboard/teachers/new?teacher=demo-teacher');
  });

  it('a visitor signs in first and comes back to the form with the teacher chosen', () => {
    expect(trainedWithHref(living, false)).toBe(`/sign-in?next=${encodeURIComponent('/dashboard/teachers/new?teacher=demo-teacher')}`);
  });

  it('a historical or deceased teacher: the historical claim, confirmed from evidence', () => {
    expect(trainedWithHref({ ...living, kind: 'historical', claimState: 'platform' }, true)).toBe('/dashboard/teachers/historical?teacher=demo-teacher');
    expect(trainedWithHref({ ...living, lifeStatus: 'deceased', claimState: 'unclaimed' }, true)).toBe('/dashboard/teachers/historical?teacher=demo-teacher');
  });

  it('nothing for one’s own profile, a record that is not public, a limited view or a living record without an account', () => {
    expect(trainedWithHref({ ...living, isOwn: true }, true)).toBeNull();
    expect(trainedWithHref({ ...living, visibility: 'involved_only' }, true)).toBeNull();
    expect(trainedWithHref({ ...living, limited: true }, true)).toBeNull();
    expect(trainedWithHref({ ...living, claimState: 'unclaimed' }, true)).toBeNull();
    expect(trainedWithHref({ ...living, claimState: 'platform' }, false)).toBeNull();
  });
});
