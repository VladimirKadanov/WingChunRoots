// "Is this you? Ask to claim this profile": offered only on a public, unclaimed record of a living
// person that is not the viewer's own (ADR 0040).

import { describe, expect, it } from 'vitest';

import { claimProfileHref } from './claim-href';

const unclaimed = {
  slug: 'demo-unclaimed',
  visibility: 'public',
  limited: false,
  isOwn: false,
  kind: 'living',
  lifeStatus: 'living',
  claimState: 'unclaimed',
} as const;

describe('claimProfileHref', () => {
  it('a public, unclaimed record of a living person: its claim page', () => {
    expect(claimProfileHref(unclaimed)).toBe('/people/demo-unclaimed/claim');
  });

  it('nothing for a claimed profile, an archive record, a historical or deceased person', () => {
    expect(claimProfileHref({ ...unclaimed, claimState: 'claimed' })).toBeNull();
    expect(claimProfileHref({ ...unclaimed, claimState: 'platform' })).toBeNull();
    expect(claimProfileHref({ ...unclaimed, kind: 'historical' })).toBeNull();
    expect(claimProfileHref({ ...unclaimed, lifeStatus: 'deceased' })).toBeNull();
    expect(claimProfileHref({ ...unclaimed, lifeStatus: 'unknown' })).toBeNull();
  });

  it('nothing for one’s own profile, a record that is not public or a limited view', () => {
    expect(claimProfileHref({ ...unclaimed, isOwn: true })).toBeNull();
    expect(claimProfileHref({ ...unclaimed, visibility: 'involved_only' })).toBeNull();
    expect(claimProfileHref({ ...unclaimed, limited: true })).toBeNull();
  });
});
