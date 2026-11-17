// The control panel (docs/adr/0035-control-panel.md), against a migrated throwaway database: the
// dashboard figures and their role scoping (billing for administrators only), the navigation
// counts, the account directory (search by address and by the profile's name, the staff filter,
// paging) and the account menu's own data. Fictional data only (D20).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import type { TestDatabase } from '../db/testing';
import { listAccounts } from './account-directory';
import { accountMenu } from './account-menu';
import { adminDashboard, adminNavCounts, GROWTH_WEEKS } from './admin-dashboard';
import { member, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let admin: Awaited<ReturnType<typeof staff>>;
let moderator: Awaited<ReturnType<typeof staff>>;
let someone: Awaited<ReturnType<typeof member>>;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  admin = await staff('cp-admin', 'admin');
  moderator = await staff('cp-moderator', 'moderator');
  someone = await member('cp-findable-member');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const refused = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: unknown) => (e as { code?: string }).code ?? String(e),
  );

describe('adminDashboard', () => {
  it('gives administrators the billing figures and other staff none', async () => {
    const forAdmin = await adminDashboard(admin.principal);
    expect(forAdmin.billing).not.toBeNull();
    expect(forAdmin.accounts.total).toBeGreaterThanOrEqual(3);
    expect(forAdmin.growth).toHaveLength(GROWTH_WEEKS);
    const forModerator = await adminDashboard(moderator.principal);
    expect(forModerator.billing).toBeNull();
    expect(forModerator.deletionRequests).toBe(0);
  });

  it('refuses members and staff without the second factor', async () => {
    expect(await refused(adminDashboard(someone.principal))).not.toBe('OK');
    const unverified = await staff('cp-unverified', 'admin', { unverified: true });
    expect(await refused(adminDashboard(unverified.principal))).not.toBe('OK');
    expect(await refused(adminNavCounts(null))).not.toBe('OK');
  });

  it('counts for the navigation', async () => {
    const counts = await adminNavCounts(moderator.principal);
    expect(counts.openReview).toBeGreaterThanOrEqual(0);
    expect(counts.systemProblems).toBeGreaterThanOrEqual(0);
  });
});

describe('listAccounts', () => {
  it('finds an account by its address and by its profile name', async () => {
    const byEmail = await listAccounts(admin.principal, { q: someone.account.email.slice(0, 20) });
    expect(byEmail.rows.map((r) => r.id)).toContain(someone.account.id);
    const byName = await listAccounts(admin.principal, { q: 'cp findable member' });
    expect(byName.rows.map((r) => r.id)).toContain(someone.account.id);
    expect(byName.rows.find((r) => r.id === someone.account.id)?.name).toBe('Demo cp findable member');
  });

  it('filters staff and pages', async () => {
    const staffOnly = await listAccounts(admin.principal, { state: 'staff' });
    expect(staffOnly.rows.every((r) => r.role !== 'user')).toBe(true);
    const all = await listAccounts(admin.principal, { sort: 'email' });
    expect(all.pageSize).toBe(25);
    expect(all.pages).toBe(Math.max(1, Math.ceil(all.total / 25)));
  });

  it('is for administrators only', async () => {
    expect(await refused(listAccounts(moderator.principal))).not.toBe('OK');
    expect(await refused(listAccounts(someone.principal))).not.toBe('OK');
  });
});

describe('accountMenu', () => {
  it('shows the account its own name, address and role', async () => {
    const menu = await accountMenu(someone.principal);
    expect(menu.email).toBe(someone.account.email);
    expect(menu.displayName).toBe('Demo cp findable member');
    expect(menu.initials).toBe('DM');
    expect(menu.staff).toBe(false);
    expect((await accountMenu(moderator.principal)).staff).toBe(true);
    expect(await refused(accountMenu(null))).not.toBe('OK');
  });
});
