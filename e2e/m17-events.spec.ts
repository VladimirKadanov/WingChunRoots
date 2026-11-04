/**
 * Milestone M17: the event calendar, the specs that write (docs/adr/0020-events.md). A new
 * Professional Sifu publishes an event with the form, a second through the API, and the third in
 * the same month is refused (DEFAULT M17, question 1: two a month, counted in the event's own
 * zone), while another month still has room; a Premium Student whose established teacher the Sifu
 * is gets a dashboard notice of the publication and of the cancellation (DEFAULT M17, question 3).
 * A Free Sifu cannot publish and sees the upgrade prompt, with only the benefits that exist now. A
 * member of staff with a verified second factor removes an event with a reason: it is gone from the
 * calendar and its page, and the audit log keeps the reason. axe runs on the dashboard, the form and
 * the event's own pages in both themes. Everything is fictional (D20).
 *
 * Published and removed events change the calendar and the pages other specs and the visual
 * regression compare, so the spec runs in the `exclusive` project, in a Playwright run of its own
 * after the others (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { auditLog, teachingRelationship } from '../src/server/db/schema';
import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount, signInSeededAdmin } from './helpers/plans';
import { freshContext, grantProSifu, placeOf, signedIn, sifuAccount, visible } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** A year no seeded event uses, so the month counts are the test's own. */
const YEAR = 2028;

async function personOf(userId: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id FROM person WHERE claimed_by_user_id = ${userId} AND deleted_at IS NULL`);
  expect(rows.rows, 'the account has a profile').toHaveLength(1);
  return rows.rows[0]!.id;
}

/** `teacher` and `student` with a verified relationship that only the two of them see (nothing public changes). */
async function relate(teacherUserId: string, studentUserId: string) {
  const lineage = await getDb().execute<{ id: string }>(sql`SELECT id FROM lineage WHERE slug LIKE 'demo-%' ORDER BY slug LIMIT 1`);
  await getDb()
    .insert(teachingRelationship)
    .values({ teacherPersonId: await personOf(teacherUserId), studentPersonId: await personOf(studentUserId), lineageId: lineage.rows[0]!.id, status: 'verified', visibility: 'involved_only' });
}

/** The newest notification with `title` on the dashboard of `page`, once the job worker has written it. */
async function expectNotice(page: Page, title: string, eventTitle: string) {
  await expect
    .poll(
      async () => {
        await page.goto('/dashboard');
        return visible(page.getByTestId('notification')).filter({ hasText: title }).filter({ hasText: eventTitle }).count();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(1);
}

/** Fills the event form for an event in Sofia on `day` of YEAR and submits it. */
async function publishWithForm(page: Page, title: string, day: string) {
  const form = page.getByTestId('event-form');
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Kind').selectOption('seminar');
  await form.getByTestId('event-where-city').check();
  await form.getByLabel('City or town').selectOption({ label: 'Sofia, BG' });
  await form.getByLabel('Venue').fill('Demo hall');
  await form.getByLabel('Starts').fill(`${YEAR}-${day}T10:00`);
  await form.getByLabel('Ends').fill(`${YEAR}-${day}T17:00`);
  await form.getByRole('button', { name: 'Publish the event' }).click();
}

test('@M17 a Professional Sifu publishes two events in a month, the third is refused, and a Premium Student is told', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  const pupil = await freshContext(browser);
  try {
    const sifu = await sifuAccount(page, 'Event Sifu');
    await grantProSifu(admin.page, sifu.email);
    const student = await freshAccount(pupil.page, { name: 'Demo Premium Pupil' });
    const given = await apiPost(admin.page, '/admin/grants/create', { email: student.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo pilot test of event notices' });
    expect(given.status(), await given.text()).toBe(200);
    await relate(sifu.userId, student.userId);

    await page.goto('/dashboard/events');
    await expect(page.getByRole('heading', { level: 1, name: 'Your events' })).toBeVisible();
    await expect(page.getByTestId('events-allowance')).toContainText('Professional Sifu');
    await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
    await expect(page.getByTestId('no-my-events')).toBeVisible();
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `dashboard events, empty (${theme})`);
    }

    // The first with the form.
    await page.getByTestId('new-event').click();
    await expect(page).toHaveURL(/\/dashboard\/events\/new$/);
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `new event (${theme})`);
    }
    const first = 'Demo seminar of the tests';
    await publishWithForm(page, first, '03-04');
    await expect(page).toHaveURL(/\/dashboard\/events\/[0-9a-f-]{36}\?published=1#outcome$/);
    await expect(page.getByTestId('event-done')).toHaveText('The event is published: it is in the calendar now.');
    const firstId = /\/dashboard\/events\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `own event (${theme})`);
    }
    await page.getByTestId('event-poster-link').click();
    await expect(page.getByTestId('poster-control')).toBeVisible();
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `event poster (${theme})`);
    }

    // The public page, at once (DEFAULT M17, question 2: no review first), in the city's zone.
    const visitor = await freshContext(browser);
    try {
      await visitor.page.goto('/events?country=BG');
      const row = visitor.page.getByTestId('event-row').filter({ hasText: first });
      await expect(row).toBeVisible();
      await row.getByRole('link', { name: first }).click();
      await expect(visitor.page.getByTestId('event-when')).toHaveAttribute('datetime', `${YEAR}-03-04T10:00:00+02:00`);
      await expect(visitor.page.getByTestId('event-where')).toContainText('Demo hall');
      await expect(visitor.page.getByTestId('event-moderation')).toHaveCount(0);
    } finally {
      await visitor.context.close();
    }

    // The Premium Student is told (the job worker writes the notice).
    await expectNotice(pupil.page, 'A teacher of yours has a new event', first);

    // The second through the API (/api/v1, the same service).
    const sofia = await placeOf(page.request, 'Sofia', 'BG');
    const second = await apiPost(page, '/events/create', {
      title: 'Demo second seminar of the tests',
      kind: 'seminar',
      startsAt: `${YEAR}-03-25T10:00`,
      endsAt: `${YEAR}-03-25T17:00`,
      placeId: sofia.id,
      instructorIds: [],
    });
    expect(second.status(), await second.text()).toBe(200);

    // The third in March: refused, in words on the field, with the decision for a machine.
    await page.goto('/dashboard/events');
    await expect(page.locator(`[data-month="${YEAR}-03"]`)).toContainText('2 of 2 published');
    await expect(page.locator(`[data-month="${YEAR}-03"]`)).toHaveAttribute('data-remaining', '0');
    await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
    await page.getByTestId('new-event').click();
    await publishWithForm(page, 'Demo third seminar of the tests', '03-29');
    await expect(page).toHaveURL(/\/dashboard\/events\/new/);
    await expect(page.getByTestId('event-form')).toContainText('You have published 2 of 2 events starting in March 2028 on Professional Sifu.');
    const refused = await apiPost(page, '/events/create', {
      title: 'Demo third seminar of the tests',
      kind: 'seminar',
      startsAt: `${YEAR}-03-30T10:00`,
      endsAt: `${YEAR}-03-30T17:00`,
      placeId: sofia.id,
    });
    expect(refused.status()).toBe(403);
    const body = (await refused.json()) as { code: string; data: { entitlement: Record<string, unknown> } };
    expect(body.code).toBe('ENTITLEMENT_REQUIRED');
    expect(body.data.entitlement).toMatchObject({ ok: false, code: 'quota', key: 'events', month: `${YEAR}-03`, limit: 2, current: 2 });
    // April still has room.
    await page.goto('/dashboard/events/new');
    await publishWithForm(page, 'Demo April seminar of the tests', '04-08');
    await expect(page.getByTestId('event-done')).toBeVisible();

    // Cancelled: it stays, marked in words, and the student is told.
    await page.goto(`/dashboard/events/${firstId}`);
    await page.getByTestId('event-cancel-form').getByLabel(/Note/).fill('Moved to the spring.');
    await page.getByRole('button', { name: 'Cancel the event' }).click();
    await expect(page.getByTestId('event-done')).toHaveText('The event is cancelled. It stays in the calendar, marked Cancelled.');
    await expect(page.getByTestId('event-cancelled').first()).toHaveText('Cancelled');
    await expectNotice(pupil.page, 'An event was cancelled', first);
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `own event, cancelled (${theme})`);
    }
    await page.goto('/dashboard/events');
    await expect(page.locator(`[data-month="${YEAR}-03"]`)).toContainText('1 of 2 published');
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `dashboard events, with events (${theme})`);
    }
  } finally {
    await admin.context.close();
    await pupil.context.close();
  }
});

test('@M17 a Free Sifu cannot publish: the upgrade prompt shows only benefits that exist now, and the API refuses', async ({ page }) => {
  await sifuAccount(page, 'Free Event Sifu');
  await page.goto('/dashboard/events');
  await expect(page.getByTestId('new-event')).toHaveCount(0);
  const prompt = page.getByTestId('upgrade-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Professional Sifu');
  await expect(prompt).not.toContainText(/coming soon|later|left|hurry|only today/i);
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `dashboard events, Free Sifu (${theme})`);
  }
  await page.goto('/dashboard/events/new');
  await expect(page.getByTestId('event-cannot-publish')).toBeVisible();
  await expect(page.getByTestId('event-form')).toHaveCount(0);
  const sofia = await placeOf(page.request, 'Sofia', 'BG');
  const refused = await apiPost(page, '/events/create', { title: 'Demo refused seminar', kind: 'seminar', startsAt: `${YEAR}-05-04T10:00`, endsAt: `${YEAR}-05-04T12:00`, placeId: sofia.id });
  expect(refused.status()).toBe(403);
  const body = (await refused.json()) as { code: string; data: { entitlement: Record<string, unknown> } };
  expect(body.code).toBe('ENTITLEMENT_REQUIRED');
  expect(body.data.entitlement).toMatchObject({ ok: false, key: 'events' });
});

test('@M17 staff with a verified second factor remove an event with a reason; it is gone and the audit log keeps the reason', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const admin = await signedIn(browser, 'admin');
  const staff = await freshContext(browser);
  try {
    const sifu = await sifuAccount(page, 'Removed Event Sifu');
    await grantProSifu(admin.page, sifu.email);
    const sofia = await placeOf(page.request, 'Sofia', 'BG');
    const title = `Demo seminar to remove ${randomUUID().slice(0, 6)}`;
    const created = await apiPost(page, '/events/create', { title, kind: 'seminar', startsAt: `${YEAR}-06-03T10:00`, endsAt: `${YEAR}-06-03T17:00`, placeId: sofia.id });
    expect(created.status(), await created.text()).toBe(200);
    const { id, slug } = (await created.json()) as { id: string; slug: string };

    // The organizer sees no moderation; staff with a verified second factor do.
    await page.goto(`/events/${slug}`);
    await expect(page.getByTestId('event-moderation')).toHaveCount(0);
    await signInSeededAdmin(staff.context, { verified: true });
    await staff.page.goto(`/events/${slug}`);
    const moderation = staff.page.getByTestId('event-moderation');
    await expect(moderation).toBeVisible();
    for (const theme of THEMES) {
      await switchColorScheme(staff.page, theme);
      await expectNoAxeViolations(staff.page, `event page, staff (${theme})`);
    }
    // A reason is required.
    await moderation.getByRole('button', { name: 'Remove the event' }).click();
    await expect(moderation.getByLabel('Reason')).toHaveAttribute('aria-invalid', 'true');
    const reason = 'Demo: not a Wing Chun event (test).';
    await moderation.getByLabel('Reason').fill(reason);
    await moderation.getByRole('button', { name: 'Remove the event' }).click();
    await expect(staff.page).toHaveURL(/\/events\?removed=1$/);
    await expect(staff.page.getByTestId('event-removed')).toBeVisible();
    await expect(staff.page.getByTestId('event-row').filter({ hasText: title })).toHaveCount(0);

    // Gone from its page, the API and the .ics; the organizer's dashboard says it was removed.
    await page.goto(`/events/${slug}`);
    await expect(page.getByTestId('event-not-listed')).toBeVisible();
    expect((await page.request.get(`/api/v1/events/${slug}`)).status()).toBe(404);
    expect((await page.request.get(`/events/${slug}/calendar.ics`)).status()).toBe(404);
    await page.goto('/dashboard/events');
    await expect(page.locator('[data-testid="my-event"][data-status="removed"]')).toContainText(title);

    const audit = await getDb()
      .select({ reason: auditLog.reason, actorRole: auditLog.actorRole })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'event.remove'), eq(auditLog.subjectId, id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toBe(reason);
  } finally {
    await admin.context.close();
    await staff.context.close();
  }
});
