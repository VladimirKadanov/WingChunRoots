import { describe, expect, it } from 'vitest';

import { currentHref, type AdminNavGroup } from './admin-nav';

const groups: AdminNavGroup[] = [
  { label: 'Overview', links: [{ href: '/admin', label: 'Dashboard', count: null }] },
  {
    label: 'Queues',
    links: [
      { href: '/admin/review', label: 'Review requests', count: 3 },
      { href: '/admin/review/records', label: 'Shared records', count: null },
    ],
  },
];

describe('currentHref', () => {
  it('marks the dashboard only on /admin itself', () => {
    expect(currentHref(groups, '/admin')).toBe('/admin');
    expect(currentHref(groups, '/admin/accounts')).toBeNull();
  });
  it('takes the longest section the address is at or below', () => {
    expect(currentHref(groups, '/admin/review')).toBe('/admin/review');
    expect(currentHref(groups, '/admin/review/0193-case')).toBe('/admin/review');
    expect(currentHref(groups, '/admin/review/records/demo-root-c')).toBe('/admin/review/records');
  });
  it('does not match a section by a shared prefix of letters', () => {
    expect(currentHref(groups, '/admin/reviewers')).toBeNull();
  });
});
