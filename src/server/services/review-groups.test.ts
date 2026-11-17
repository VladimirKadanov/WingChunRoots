import { describe, expect, it } from 'vitest';

import { REVIEW_KIND_GROUPS } from './admin-dashboard';
import { QUEUE_KINDS, REVIEW_GROUPS } from './review';

describe('the review queue groups (control panel)', () => {
  it('put every queue kind in exactly one group', () => {
    const kinds = Object.values(REVIEW_GROUPS).flatMap((g) => [...g.kinds]);
    expect([...kinds].sort()).toEqual([...QUEUE_KINDS].sort());
  });

  it('match the dashboard groups, so a dashboard figure can open its view', () => {
    const dashboard = REVIEW_KIND_GROUPS.filter((g) => g.key !== 'deletions').map((g) => [g.key, g.label, [...g.kinds]]);
    expect(Object.entries(REVIEW_GROUPS).map(([key, g]) => [key, g.label, [...g.kinds]])).toEqual(dashboard);
  });
});
