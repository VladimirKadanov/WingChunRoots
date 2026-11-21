// The public DTOs of organizations (milestone M15, plan §6.4): whatever a service hands them, only
// the named public keys come out: no applicant, admin, leader of the application, plan, document
// or point of a school.

import { describe, expect, it } from 'vitest';

import { toPublicOrganizationList, toPublicOrganizationPage } from './organizations';

const name = (value: string) => ({ value, lang: 'en', script: 'Latn' });

describe('toPublicOrganizationPage', () => {
  it('drops every private field, at every level', () => {
    const page = toPublicOrganizationPage({
      slug: 'demo-federation-north',
      name: 'Demo Federation North',
      kind: 'federation',
      kindLabel: 'Federation',
      countryCode: 'DE',
      websiteUrl: null,
      approvedOn: '2026-11-02',
      members: [{ slug: 'demo-root-a', displayName: name('Demo Root A'), original: null, role: 'leader', roleLabel: 'Leader', userId: 'u1', email: 'demo@example.test' }],
      schools: [{ slug: 'demo-school-sofia', name: 'Demo Hall', city: 'Sofia', countryCode: 'BG', logo: null, point: { lat: 42.7, lng: 23.3 }, exactPoint: 'x' }],
      // ADR 0052: a city at its own centre (rounded), never a school's point.
      cities: [{ name: 'Sofia', countryCode: 'BG', lat: 42.69, lng: 23.32, schools: 1, schoolIds: ['s1'] }],
      about: null,
      logo: null,
      banner: null,
      memberCount: 1,
      schoolCount: 1,
      leaderName: 'Demo Leader',
      leaderTitle: 'President',
      createdByUserId: 'u2',
      plan: 'federation',
      admins: [{ email: 'demo@example.test' }],
      evidenceIds: ['e1'],
      status: 'active',
    } as never);
    const text = JSON.stringify(page);
    for (const secret of ['Demo Leader', 'President', 'u1', 'u2', 'demo@example.test', 'e1', '42.7', 'exactPoint', 'schoolIds', 'plan', 'status']) expect(text).not.toContain(secret);
    expect(page.members[0]).toEqual({ slug: 'demo-root-a', displayName: name('Demo Root A'), original: null, role: 'leader', roleLabel: 'Leader' });
    expect(page.schools[0]).toEqual({ slug: 'demo-school-sofia', name: 'Demo Hall', city: 'Sofia', countryCode: 'BG', logo: null });
    expect(page.cities).toEqual([{ name: 'Sofia', countryCode: 'BG', lat: 42.69, lng: 23.32, schools: 1 }]);
  });
});

describe('toPublicOrganizationList', () => {
  it('keeps the slug, name, kind, country, images and public counts only', () => {
    const list = toPublicOrganizationList({
      organizations: [{ slug: 'demo-x', name: 'Demo X', kind: 'association', kindLabel: 'Association', countryCode: null, logo: null, banner: null, memberCount: 2, schoolCount: 0, id: 'secret-id' }],
    } as never);
    expect(list).toEqual({ organizations: [{ slug: 'demo-x', name: 'Demo X', kind: 'association', kindLabel: 'Association', countryCode: null, logo: null, banner: null, memberCount: 2, schoolCount: 0 }] });
  });
});
