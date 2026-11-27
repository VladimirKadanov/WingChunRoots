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
  instructorSchools: 0,
  family: false,
  hasCases: false,
  inSuccession: false,
  waitingNaming: 0,
};

const labels = (nav: DashboardNav) => dashboardNavGroups(nav).map((g) => g.label);

describe('dashboardNavGroups', () => {
  it('shows a student no teaching or organization groups', () => {
    expect(labels(student)).toEqual(['Overview', 'My training', 'Account']);
  });

  it('hides Cases while there is none, and Digital successor from a student outside a nomination (role replay 2026-11-25, P2-7)', () => {
    const account = (nav: DashboardNav) => dashboardNavGroups(nav).at(-1)!.links.map((l) => l.href);
    expect(account(student)).not.toContain('/dashboard/cases');
    expect(account(student)).not.toContain('/dashboard/succession');
    expect(account({ ...student, hasCases: true })).toContain('/dashboard/cases');
    expect(account({ ...student, inSuccession: true })).toContain('/dashboard/succession');
    expect(account({ ...student, accountType: 'sifu' })).toContain('/dashboard/succession');
  });

  it('shows a Student account the requests that wait for it and the schools that list it (journey review 2026-11-26, P1-1)', () => {
    const teacher = { ...student, waitingStudentRequests: 1, instructorSchools: 1 };
    expect(labels(teacher)).toEqual(['Overview', 'Teaching', 'Schools', 'My training', 'Account']);
    const teaching = dashboardNavGroups(teacher).find((g) => g.label === 'Teaching')!;
    expect(teaching.links).toEqual([expect.objectContaining({ href: '/dashboard/students/requests', count: 1 })]);
    expect(dashboardNavGroups(teacher).find((g) => g.label === 'Schools')!.links.map((l) => l.href)).toEqual(['/dashboard/schools']);
  });

  it('gives an organization admin who is no Sifu the events page with the organizations (P2-6)', () => {
    const admin = { ...student, organizations: [{ id: 'o1', name: 'Demo Federation North', role: 'admin' as const }] };
    expect(dashboardNavGroups(admin).find((g) => g.label === 'Organizations')!.links.map((l) => l.href)).toContain('/dashboard/events');
  });

  it('shows a Sifu teaching and organizations, with verification until verified', () => {
    const sifu = { ...student, accountType: 'sifu' as const, instructor: 'unverified' as const, waitingStudentRequests: 2 };
    expect(labels(sifu)).toEqual(['Overview', 'Teaching', 'Schools and events', 'My training', 'Organizations', 'Account']);
    expect(dashboardNavGroups(sifu).filter((g) => g.links.some((l) => l.href === '/dashboard/events'))).toHaveLength(1);
    const teaching = dashboardNavGroups(sifu).find((g) => g.label === 'Teaching')!;
    expect(teaching.links.map((l) => l.href)).toContain('/dashboard/instructor');
    expect(teaching.links.find((l) => l.href === '/dashboard/students/requests')?.count).toBe(2);
    const verified = dashboardNavGroups({ ...sifu, instructor: 'verified' }).find((g) => g.label === 'Teaching')!;
    expect(verified.links.map((l) => l.href)).not.toContain('/dashboard/instructor');
  });

  it('lists the kung fu family only on a plan that includes it (ADR 0048)', () => {
    const learning = (nav: DashboardNav) => dashboardNavGroups(nav).find((g) => g.label === 'My training')!.links.map((l) => l.href);
    expect(learning(student)).not.toContain('/dashboard/family');
    expect(learning({ ...student, family: true })).toEqual(['/dashboard/teachers', '/dashboard/passport', '/dashboard/family', '/dashboard/trial-lessons']);
  });

  it('lists each organization an account administers', () => {
    const owner = { ...student, organizations: [{ id: 'o1', name: 'Demo Federation North', role: 'owner' as const }] };
    const group = dashboardNavGroups(owner).find((g) => g.label === 'Organizations')!;
    expect(group.links.map((l) => [l.href, l.label])).toEqual([
      ['/dashboard/organization/o1', 'Demo Federation North'],
      ['/dashboard/organization', 'All your organizations'],
      ['/dashboard/events', 'Events'],
    ]);
  });

  it('gives a staff account without a profile only the overview and its own pages', () => {
    const staff = { ...student, hasProfile: false, profileSlug: null, staffOnly: true };
    expect(labels(staff)).toEqual(['Overview', 'Account']);
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

  it('shows Requests to name you only while one waits, with the count (review 2026-11-13, ADR 0088)', () => {
    const hrefs = (nav: DashboardNav) => dashboardNavGroups(nav).flatMap((g) => g.links.map((l) => l.href));
    expect(hrefs(student)).not.toContain('/dashboard/naming');
    const waiting = dashboardNavGroups({ ...student, waitingNaming: 2 }).flatMap((g) => g.links).find((l) => l.href === '/dashboard/naming');
    expect(waiting).toMatchObject({ label: 'Requests to name you', count: 2, countLabel: 'waiting' });
  });
});
