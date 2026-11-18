import { describe, expect, it } from 'vitest';

import type { DashboardNav } from '@/server/services/dashboard-nav';

import { currentHref, dashboardNavGroups } from './dashboard-nav';

const student: DashboardNav = {
  accountType: 'student',
  instructor: 'not_instructor',
  hasProfile: true,
  profileSlug: 'demo-x',
  staffOnly: false,
  organizations: [],
  unreadNotifications: 0,
  waitingStudentRequests: 0,
};

const labels = (nav: DashboardNav) => dashboardNavGroups(nav).map((g) => g.label);

describe('dashboardNavGroups', () => {
  it('shows a student no teaching or organization groups', () => {
    expect(labels(student)).toEqual(['Overview', 'Learning', 'You']);
  });

  it('shows a Sifu teaching and organizations, with verification until verified', () => {
    const sifu = { ...student, accountType: 'sifu' as const, instructor: 'unverified' as const, waitingStudentRequests: 2 };
    expect(labels(sifu)).toEqual(['Overview', 'Learning', 'Teaching', 'Organizations', 'You']);
    const teaching = dashboardNavGroups(sifu).find((g) => g.label === 'Teaching')!;
    expect(teaching.links.map((l) => l.href)).toContain('/dashboard/instructor');
    expect(teaching.links.find((l) => l.href === '/dashboard/students/requests')?.count).toBe(2);
    const verified = dashboardNavGroups({ ...sifu, instructor: 'verified' }).find((g) => g.label === 'Teaching')!;
    expect(verified.links.map((l) => l.href)).not.toContain('/dashboard/instructor');
  });

  it('lists each organization an account administers', () => {
    const owner = { ...student, organizations: [{ id: 'o1', name: 'Demo Federation North', role: 'owner' as const }] };
    const group = dashboardNavGroups(owner).find((g) => g.label === 'Organizations')!;
    expect(group.links.map((l) => [l.href, l.label])).toEqual([
      ['/dashboard/organization/o1', 'Demo Federation North'],
      ['/dashboard/organization', 'All your organizations'],
    ]);
  });

  it('gives a staff account without a profile only the overview and its own pages', () => {
    const staff = { ...student, hasProfile: false, profileSlug: null, staffOnly: true };
    expect(labels(staff)).toEqual(['Overview', 'You']);
    expect(dashboardNavGroups(staff).at(-1)!.links.map((l) => l.href)).not.toContain('/dashboard/cases');
  });
});

describe('currentHref', () => {
  const groups = dashboardNavGroups({ ...student, accountType: 'sifu', organizations: [{ id: 'o1', name: 'Org', role: 'admin' }] });
  it('marks the overview only on /dashboard itself', () => {
    expect(currentHref(groups, '/dashboard')).toBe('/dashboard');
    expect(currentHref(groups, '/dashboard/unknown')).toBe(null);
  });
  it('marks the longest address a page is at or below', () => {
    expect(currentHref(groups, '/dashboard/students/requests')).toBe('/dashboard/students/requests');
    expect(currentHref(groups, '/dashboard/students')).toBe('/dashboard/students');
    expect(currentHref(groups, '/dashboard/schools/abc/inquiries')).toBe('/dashboard/schools');
    expect(currentHref(groups, '/dashboard/organization/o1/analytics')).toBe('/dashboard/organization/o1');
  });
});
