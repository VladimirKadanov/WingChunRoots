// Milestone M12 (docs/plan/M12-local-ops.md, Done when 2): /healthz says only whether the app is
// healthy, and /admin/system shows the queue's depth and the time of the last local archive to
// staff whose session passed the second factor, and to no one else (plan §3.1 "Наблюдение", §6.4).

import { expect, test, type Browser } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, signInAs, type SignInTarget } from './helpers/auth';
import { deferredJob, deleteJob, NEWEST_ARCHIVE, writeDemoArchives } from './helpers/ops';
import { signInSeededAdmin } from './helpers/plans';

test.afterAll(closeHelpers);

async function signedInContext(browser: Browser, target: SignInTarget) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, target);
  return { context, page };
}

test('@M12 /healthz returns only {"ok":true}', async ({ request, page }) => {
  const response = await request.get('/healthz');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('{"ok":true}');
  expect(response.headers()['content-type']).toMatch(/^application\/json/);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['set-cookie']).toBeUndefined();

  // The same few bytes for a signed-in member: never which check ran, a version or a count.
  await signInAs(page, 'user');
  const signedIn = await page.request.get('/healthz');
  expect(signedIn.status()).toBe(200);
  expect(await signedIn.text()).toBe('{"ok":true}');
  // Answered fresh every time, never from a cache or as a page.
  const again = await request.get('/healthz', { headers: { 'x-request-id': 'demo-health-check-1' } });
  expect(await again.text()).toBe('{"ok":true}');
});

test('@M12 /admin/system shows queue depth and the last backup time to verified staff only', async ({ page, browser }) => {
  const newestFile = writeDemoArchives();
  const jobId = await deferredJob();
  try {
    // Anonymous: sent to sign in; the API answers 401.
    const anonymous = await browser.newContext({ baseURL: BASE_URL });
    try {
      const anon = await anonymous.newPage();
      await anon.goto('/admin/system');
      await expect(anon).toHaveURL(/\/sign-in/);
      await expect(anon.getByTestId('queue-depth')).toHaveCount(0);
      expect((await anon.request.get('/api/v1/admin/system')).status()).toBe(401);
    } finally {
      await anonymous.close();
    }

    // A member: told plainly; neither the page nor the API shows a number.
    await signInAs(page, 'user');
    await page.goto('/admin/system');
    await expect(page.getByTestId('system-denied')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Not available' })).toBeVisible();
    await expect(page.getByTestId('queue-depth')).toHaveCount(0);
    const memberApi = await page.request.get('/api/v1/admin/system');
    expect(memberApi.status()).toBe(403);
    expect(((await memberApi.json()) as { code?: string }).code).toBe('FORBIDDEN');

    // The administrator in a session that has not passed the second factor: sent to verify it.
    const unverified = await browser.newContext({ baseURL: BASE_URL });
    try {
      await giveOwnAddress(unverified);
      await signInSeededAdmin(unverified);
      const other = await unverified.newPage();
      const api = await other.request.get('/api/v1/admin/system');
      expect(api.status()).toBe(403);
      expect(((await api.json()) as { code?: string }).code).toBe('SECOND_FACTOR_REQUIRED');
      await other.goto('/admin/system');
      await expect(other).toHaveURL(/\/account\/security\?next=%2Fadmin%2Fsystem$/);
      await expect(other.getByTestId('queue-depth')).toHaveCount(0);
    } finally {
      await unverified.close();
    }

    // Staff with the second factor: an archivist sees the status too.
    const archivist = await signedInContext(browser, 'archivist');
    try {
      await archivist.page.goto('/admin/system');
      await expect(archivist.page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    } finally {
      await archivist.context.close();
    }

    // The administrator with the second factor: the depth counts the deferred job, and the last
    // backup is the newest archive in BACKUP_DIR.
    const admin = await signedInContext(browser, 'admin');
    try {
      const response = await admin.page.request.get('/api/v1/admin/system');
      expect(response.status(), await response.text()).toBe(200);
      const status = (await response.json()) as {
        queue: { waiting: number; queues: { queue: string; waiting: number }[] };
        backup: { latest: { file: string; createdAt: string; hasChecksum: boolean } | null };
      };
      expect(status.queue.waiting).toBeGreaterThanOrEqual(1);
      expect(status.queue.queues.find((q) => q.queue === 'retention.purge')?.waiting).toBeGreaterThanOrEqual(1);
      expect(status.backup.latest).toMatchObject({ file: newestFile, createdAt: NEWEST_ARCHIVE, hasChecksum: true });
      // Counts, queue names and times only.
      expect(JSON.stringify(status)).not.toMatch(/@|demo-[a-z]/);

      await admin.page.goto('/admin/system');
      await expect(admin.page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
      expect(Number(await admin.page.getByTestId('queue-depth').innerText())).toBeGreaterThanOrEqual(1);
      const purge = admin.page.getByTestId('queue-list').locator('li[data-queue="retention.purge"]');
      expect(Number(await purge.locator('[data-count="waiting"]').innerText())).toBeGreaterThanOrEqual(1);
      await expect(admin.page.getByTestId('last-backup-time').locator('time')).toHaveAttribute('datetime', NEWEST_ARCHIVE);
      await expect(admin.page.getByTestId('last-backup-time')).toHaveText('1 November 2026, 02:00 UTC');
      await expect(admin.page.getByTestId('last-backup')).toHaveText('1 November 2026');
      await expect(admin.page.getByTestId('backup-verdict')).toHaveText('OK');
      await expect(admin.page.getByTestId('queue-verdict')).toHaveAttribute('data-state', /^(ok|attention)$/);
      // Nothing that names a person.
      expect(await admin.page.locator('main').innerText()).not.toContain('@');
    } finally {
      await admin.context.close();
    }
  } finally {
    await deleteJob(jobId);
  }
});
