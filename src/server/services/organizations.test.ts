// The input of the organization procedures (milestone M15): the application's fields in Latin
// script, the profile and school addresses a person pastes, and the plan that can be given to an
// organization (Federation only, never through the account grants: DEFAULT D09).

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheTag: () => undefined, cacheLife: () => undefined, revalidateTag: () => undefined, updateTag: () => undefined }));

import { GRANTABLE_PLANS, ORGANIZATION_GRANTABLE_PLANS } from '../entitlements/plans';
import { isoDay } from '../../lib/dates';
import { addMemberInput, membershipHasEnded, membershipIsCurrent, organizationFieldsInput, requestSchoolInput } from './organizations';

const VALID = { name: 'Demo Wing Chun Federation', kind: 'federation', leaderName: 'Demo Leader', countryCode: 'bg', schoolsEstimate: 12 };

describe('organizationFieldsInput', () => {
  it('accepts a Latin-script application and normalizes the country', () => {
    const parsed = organizationFieldsInput.parse({ ...VALID, websiteUrl: 'https://example.test', leaderTitle: '' });
    expect(parsed).toMatchObject({ countryCode: 'BG', websiteUrl: 'https://example.test', leaderTitle: null });
  });

  it.each([
    ['name', { name: 'Демо федерация' }],
    ['name', { name: '詠春總會' }],
    ['leaderName', { leaderName: 'Демо' }],
    ['websiteUrl', { websiteUrl: 'example.test' }],
    ['countryCode', { countryCode: 'XX' }],
    ['schoolsEstimate', { schoolsEstimate: 1.5 }],
    ['schoolsEstimate', { schoolsEstimate: -1 }],
    ['kind', { kind: 'club' }],
  ])('refuses a bad %s', (field, change) => {
    const parsed = organizationFieldsInput.safeParse({ ...VALID, ...change });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});

describe('the addresses a person pastes', () => {
  it('takes the slug from a profile or school address', () => {
    expect(addMemberInput.parse({ organizationId: '0190f0f0-0000-7000-8000-000000000000', personSlug: 'https://example.test/people/demo-root-a?x=1' }).personSlug).toBe('demo-root-a');
    expect(requestSchoolInput.parse({ organizationId: '0190f0f0-0000-7000-8000-000000000000', schoolSlug: '/schools/demo-school-sofia/' }).schoolSlug).toBe('demo-school-sofia');
  });
});

describe('a membership in time', () => {
  const today = '2026-11-03';
  it('is current from its start (or with no start) until its end', () => {
    expect(membershipIsCurrent({ startsOn: null, endsOn: null }, today)).toBe(true);
    expect(membershipIsCurrent({ startsOn: '2026-11-03', endsOn: null }, today)).toBe(true);
    expect(membershipIsCurrent({ startsOn: '2026-11-04', endsOn: null }, today)).toBe(false);
    expect(membershipIsCurrent({ startsOn: null, endsOn: '2026-11-04' }, today)).toBe(true);
    expect(membershipIsCurrent({ startsOn: null, endsOn: '2026-11-03' }, today)).toBe(false);
  });

  it('a later membership ended on its first day has ended, and stays off the page', () => {
    const endedEarly = { startsOn: '2026-12-01', endsOn: '2026-12-01' };
    expect(membershipHasEnded(endedEarly, today)).toBe(true);
    expect(membershipIsCurrent(endedEarly, today)).toBe(false);
    expect(membershipHasEnded({ startsOn: '2026-12-01', endsOn: null }, today)).toBe(false);
  });

  it('a new member cannot start later than today', () => {
    const base = { organizationId: '0190f0f0-0000-7000-8000-000000000000', personSlug: 'demo-root-a' };
    expect(addMemberInput.safeParse({ ...base, startsOn: isoDay(new Date()) }).success).toBe(true);
    const later = addMemberInput.safeParse({ ...base, startsOn: '2999-01-01' });
    expect(later.success).toBe(false);
    expect(later.error?.issues.map((i) => i.path[0])).toContain('startsOn');
  });
});

describe('the plans an organization can be given', () => {
  it('is Federation only, and never through the account grants', () => {
    expect(ORGANIZATION_GRANTABLE_PLANS).toEqual(['federation']);
    expect(GRANTABLE_PLANS).not.toContain('federation');
  });
});
