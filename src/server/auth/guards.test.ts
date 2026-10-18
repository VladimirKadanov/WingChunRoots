// safeNextPath (milestone M02): `?next=` after sign-in, onboarding and the second factor is a
// local path, never another site, also after the URL parser has normalised it.

import { describe, expect, it } from 'vitest';

import { policyFor, safeNextPath } from './guards';

describe('safeNextPath', () => {
  it.each([
    ['/account', '/account'],
    ['/schools?city=demo-sofia', '/schools?city=demo-sofia'],
    ['/account/security/../../schools', '/schools'],
    ['/a/./b', '/a/b'],
  ])('keeps the local path %j as %j', (value, expected) => {
    expect(safeNextPath(value, '/fallback')).toBe(expected);
  });

  it.each([
    'https://example.test/',
    '//example.test',
    '/\\example.test',
    '/.//example.test',
    '/a/..//example.test',
    '/%2e//example.test',
    '/./\\example.test',
    '/\t/example.test',
    'account',
    '',
    undefined,
    42,
  ])('refuses %j', (value) => {
    expect(safeNextPath(value, '/fallback')).toBe('/fallback');
  });
});

describe('policyFor', () => {
  it('matches a protected prefix and its subpaths only', () => {
    expect(policyFor('/admin')).toEqual({ kind: 'staff2fa' });
    expect(policyFor('/admin/users')).toEqual({ kind: 'staff2fa' });
    // M08: plan grants are for admins only; the dashboard for any signed-in account.
    expect(policyFor('/admin/grants')).toEqual({ kind: 'staff2fa', roles: ['admin'] });
    expect(policyFor('/dashboard/settings')).toEqual({ kind: 'user' });
    expect(policyFor('/administrator')).toBeNull();
    expect(policyFor('/account/security')).toEqual({ kind: 'user' });
    expect(policyFor('/')).toBeNull();
  });
});
