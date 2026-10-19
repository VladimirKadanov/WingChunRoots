// safeNextPath (milestone M02): `?next=` after sign-in, onboarding and the second factor is a
// local path, never another site, also after the URL parser has normalised it.

import { describe, expect, it } from 'vitest';

import { checkRoute, hasStaff2FA, policyFor, safeNextPath } from './guards';
import type { Principal, Role } from './principal';

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

describe('hasStaff2FA (M08 review round 2, recheck-1)', () => {
  const principal = (role: Role, { enabled = true, verified = true } = {}): Principal => ({
    user: { id: 'u', email: 'demo-x@example.test', emailVerified: true, role, twoFactorEnabled: enabled },
    session: { id: 's', expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: verified ? new Date() : null },
    via: 'cookie',
  });

  it('is true only for a staff session that proved the second factor, of the roles asked for', () => {
    expect(hasStaff2FA(principal('admin'), ['admin'])).toBe(true);
    expect(hasStaff2FA(principal('moderator'))).toBe(true);
    expect(hasStaff2FA(principal('moderator'), ['admin'])).toBe(false);
    expect(hasStaff2FA(principal('admin', { verified: false }), ['admin'])).toBe(false);
    expect(hasStaff2FA(principal('admin', { enabled: false }), ['admin'])).toBe(false);
    expect(hasStaff2FA(principal('user'))).toBe(false);
    expect(hasStaff2FA(null)).toBe(false);
  });
});

describe('checkRoute returnTo (M08 review round 2, recheck-7)', () => {
  const admin = (verified: boolean): Principal => ({
    user: { id: 'u', email: 'demo-admin@example.test', emailVerified: true, role: 'admin', twoFactorEnabled: true },
    session: { id: 's', expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: verified ? new Date() : null },
    via: 'cookie',
  });
  const back = '/admin/grants?request=0190a5c0-0000-7000-8000-000000000001';

  it('comes back to the page with its query after sign-in or the second factor', () => {
    expect(checkRoute('/admin/grants', null, back)).toMatchObject({ ok: false, status: 401, redirectTo: `/sign-in?next=${encodeURIComponent(back)}` });
    expect(checkRoute('/admin/grants', admin(false), back)).toMatchObject({
      ok: false,
      status: 403,
      redirectTo: `/account/security?next=${encodeURIComponent(back)}`,
    });
    expect(checkRoute('/admin/grants', admin(true), back)).toMatchObject({ ok: true });
  });

  it('keeps only a local path, and the plain path without returnTo', () => {
    expect(checkRoute('/admin/grants', admin(false), '//example.test/x')).toMatchObject({ redirectTo: '/account/security?next=%2Fadmin%2Fgrants' });
    expect(checkRoute('/admin/grants', admin(false))).toMatchObject({ redirectTo: '/account/security?next=%2Fadmin%2Fgrants' });
  });
});
