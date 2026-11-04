/**
 * Milestone M17: the event calendar, the specs that only read (docs/adr/0020-events.md). The seeded
 * demo events (src/fixtures/generate.ts, demoEvents) on /events: by month, filtered with the
 * keyboard through the plain GET form, past events one link away; an event's page in its own time
 * zone with its .ics file (RFC 5545) and JSON-LD with the city only; a cancelled event marked in
 * words; the "not listed" state; the Events tab. The specs that publish, cancel or remove an event
 * are e2e/m17-events.spec.ts (exclusive run). Desktop and phone projects.
 */

import { expect, test, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** Moves the focus with Tab until the focused element matches `selector` (at most `max` steps). */
async function tabTo(page: Page, selector: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
  }
  throw new Error(`Tab never reached ${selector}`);
}

const slugs = (page: Page) => page.getByTestId('event-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slug')));

test('@M17 the calendar lists the upcoming events by month and filters them with the keyboard', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
  const upcoming = await slugs(page);
  for (const slug of ['demo-seminar-chum-kiu-sofia', 'demo-spring-camp-london', 'demo-online-theory-evening', 'demo-cancelled-exam-session', 'demo-federation-summer-camp']) {
    expect(upcoming).toContain(slug);
  }
  expect(upcoming, 'a past event is not among the upcoming ones').not.toContain('demo-past-seminar-athens');
  // In order of start, under the heading of the month they start in (in their own zone).
  expect(upcoming.indexOf('demo-seminar-chum-kiu-sofia')).toBeLessThan(upcoming.indexOf('demo-spring-camp-london'));
  await expect(page.getByRole('heading', { level: 2, name: 'March 2027' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'July 2027' })).toBeVisible();
  // A cancelled event says so in words, with its mark.
  const cancelled = page.locator('[data-testid="event-row"][data-slug="demo-cancelled-exam-session"]');
  await expect(cancelled.getByTestId('event-cancelled')).toHaveText('Cancelled');
  // The Events tab is the current one.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Events' }).filter({ visible: true })).toHaveAttribute('aria-current', 'page');

  // The keyboard only: Tab to the country, choose, Tab to the kind, choose, submit with Enter.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await tabTo(page, '#event-country');
  await page.locator('#event-country').selectOption('GB');
  await page.keyboard.press('Tab');
  await expect(page.locator('#event-kind')).toBeFocused();
  await page.locator('#event-kind').selectOption('camp');
  await tabTo(page, 'button[type="submit"]');
  await page.keyboard.press('Enter');
  // A plain GET form sends its empty fields too; the page reads only what is set.
  await expect(page).toHaveURL(/\/events\?country=GB&kind=camp(&|$)/);
  expect(await slugs(page)).toEqual(['demo-spring-camp-london']);
  await expect(page.getByTestId('event-count')).toHaveText('1 event match these filters.');

  // Online only.
  await page.goto('/events?format=online');
  expect(await slugs(page)).toEqual(['demo-online-theory-evening']);

  // Nothing matches: says so, with a way back.
  await page.goto('/events?country=ZZ');
  await expect(page.getByTestId('no-events')).toContainText('No event matches these filters.');
  await page.getByTestId('no-events').getByRole('link', { name: 'Show every event' }).click();
  await expect(page).toHaveURL(/\/events$/);

  // Past events, one link away.
  await page.getByRole('navigation', { name: 'Upcoming or past' }).getByRole('link', { name: 'Past' }).click();
  await expect(page).toHaveURL(/\/events\?when=past$/);
  expect(await slugs(page)).toContain('demo-past-seminar-athens');
  expect(await slugs(page)).not.toContain('demo-seminar-chum-kiu-sofia');

  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `events, past (${theme})`);
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('@M17 without JavaScript the filter form works as a plain GET form', async ({ page }) => {
    await page.goto('/events');
    await page.locator('#event-kind').selectOption('seminar');
    await page.getByRole('button', { name: 'Show events' }).click();
    await expect(page).toHaveURL(/\/events\?(country=&)?kind=seminar(&|$)/);
    const found = await slugs(page);
    expect(found).toContain('demo-seminar-chum-kiu-sofia');
    expect(found.every((s) => s !== 'demo-spring-camp-london')).toBe(true);
  });
});

test('@M17 an event page shows its dates in its own zone, links its people, and gives an .ics file and JSON-LD with the city only', async ({ page }) => {
  await page.goto('/events/demo-seminar-chum-kiu-sofia');
  await expect(page.getByTestId('event-page')).toHaveAttribute('data-status', 'published');
  // 08:00 UTC is 10:00 in Sofia (EET, UTC+2, in March before the change).
  await expect(page.getByTestId('event-when')).toContainText('13 March 2027');
  await expect(page.getByTestId('event-when')).toContainText('10:00');
  await expect(page.getByTestId('event-when')).toHaveAttribute('datetime', '2027-03-13T10:00:00+02:00');
  await expect(page.getByTestId('event-zone')).toContainText('Sofia');
  await expect(page.getByTestId('event-where')).toContainText('Sofia, Bulgaria');
  await expect(page.getByTestId('event-organizer')).toHaveAttribute('href', /^\/people\/demo-/);
  await expect(page.getByTestId('event-school')).toHaveAttribute('href', '/schools/demo-school-sofia');
  await expect(page.getByTestId('event-instructor')).toHaveCount(1);
  await expect(page.getByTestId('event-poster')).toBeVisible();
  // The organizer's page opens in the same window.
  const external = page.getByTestId('event-external');
  await expect(external).toHaveAttribute('href', 'https://example.test/demo-seminar');
  expect(await external.getAttribute('target')).toBeNull();
  for (const link of await page.getByRole('link').filter({ visible: true }).all()) {
    const box = await link.boundingBox();
    if (box) expect(box.height, `${await link.textContent()}: a 44 px target`).toBeGreaterThanOrEqual(44);
  }

  // JSON-LD: an Event with the city, never a venue line or a point.
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!) as { [key: string]: unknown; location?: unknown };
  expect(ld['@type']).toBe('Event');
  expect(ld.startDate).toBe('2027-03-13T10:00:00+02:00');
  expect(ld.eventStatus).toBe('https://schema.org/EventScheduled');
  expect(ld.location).toEqual({ '@type': 'Place', name: 'Sofia', address: { '@type': 'PostalAddress', addressLocality: 'Sofia', addressCountry: 'BG' } });
  expect(JSON.stringify(ld)).not.toMatch(/latitude|longitude|geo/i);

  // .ics (RFC 5545): one VEVENT at the event's instant, from the public page's data.
  await expect(page.getByTestId('event-ics')).toHaveAttribute('href', '/events/demo-seminar-chum-kiu-sofia/calendar.ics');
  const ics = await page.request.get('/events/demo-seminar-chum-kiu-sofia/calendar.ics');
  expect(ics.status()).toBe(200);
  expect(ics.headers()['content-type']).toMatch(/^text\/calendar/);
  expect(ics.headers()['content-disposition']).toMatch(/attachment/);
  const body = await ics.text();
  expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(body).toContain('\r\nBEGIN:VEVENT\r\n');
  expect(body).toContain('\r\nDTSTART:20270313T080000Z\r\n');
  expect(body).toContain('\r\nDTEND:20270313T150000Z\r\n');
  expect(body).toMatch(/\r\nSUMMARY:[^\r]+\r\n/);
  expect(body.trimEnd().endsWith('END:VCALENDAR')).toBe(true);

  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `event page (${theme})`);
  }
});

test('@M17 a cancelled event stays, marked in words; an online event names no city; an unknown one is not listed and never indexed', async ({ page }) => {
  await page.goto('/events/demo-cancelled-exam-session');
  await expect(page.getByTestId('event-page')).toHaveAttribute('data-status', 'cancelled');
  await expect(page.getByTestId('event-cancelled-note')).toContainText('This event was cancelled');
  await expect(page.getByTestId('event-cancelled')).toHaveText('Cancelled');
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!) as { [key: string]: unknown; location?: unknown };
  expect(ld.eventStatus).toBe('https://schema.org/EventCancelled');
  const ics = await (await page.request.get('/events/demo-cancelled-exam-session/calendar.ics')).text();
  expect(ics).toContain('\r\nSTATUS:CANCELLED\r\n');

  await page.goto('/events/demo-online-theory-evening');
  await expect(page.getByTestId('event-where')).toHaveText('Online');
  await expect(page.getByTestId('event-zone')).toContainText('London');

  const missing = await page.goto('/events/demo-no-such-event');
  expect(missing?.status()).toBe(200);
  await expect(page.getByTestId('event-not-listed')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect((await page.request.get('/events/demo-no-such-event/calendar.ics')).status()).toBe(404);
  expect((await page.request.get('/api/v1/events/demo-no-such-event')).status()).toBe(404);
});

test('@M17 a profile and a school list their upcoming events, with a link to all of them', async ({ page }) => {
  await page.goto('/schools/demo-school-sofia');
  const section = page.getByTestId('upcoming-events');
  await expect(section.getByRole('heading', { name: 'Upcoming events' })).toBeVisible();
  await expect(section.locator('[data-testid="event-row"][data-slug="demo-seminar-chum-kiu-sofia"]')).toBeVisible();
  await section.getByRole('link', { name: 'Demo seminar: Chum Kiu footwork' }).click();
  await expect(page).toHaveURL(/\/events\/demo-seminar-chum-kiu-sofia$/);
  const organizer = await page.getByTestId('event-organizer').getAttribute('href');
  await page.goto(organizer!);
  await expect(page.getByTestId('upcoming-events').locator('[data-testid="event-row"][data-slug="demo-seminar-chum-kiu-sofia"]')).toBeVisible();
});
