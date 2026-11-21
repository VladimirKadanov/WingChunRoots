/**
 * ADR 0052: the redesigned event calendar, the specs that only read. The Month view (a grid from
 * Monday, each seeded event on the day it starts in its own zone, a day chosen by a link, the months
 * one link away, all without JavaScript), the "Next up" event above the Agenda, the drawn banner of
 * an event without a poster, "More from this organizer", the organizer filter of an organization's
 * page, and the calendar feed (RFC 5545) with the same filters. The seeded demo events only (D20).
 * Desktop and phone projects.
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

const slugs = (page: Page) => page.getByTestId('event-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slug')));
const day = (page: Page, key: string) => page.locator(`[data-testid="month-day"][data-day="${key}"]`);

test('@redesign the Agenda opens with the next event, and the view switch leads to the Month grid', async ({ page }) => {
  await page.goto('/events');
  const next = page.getByTestId('event-next');
  await expect(next).toBeVisible();
  await expect(next).toHaveAttribute('data-slug', 'demo-seminar-chum-kiu-sofia');
  await expect(next.getByRole('heading', { level: 2 })).toHaveText('Demo seminar: Chum Kiu footwork');
  // A filtered list has no "Next up".
  await page.goto('/events?kind=camp');
  await expect(page.getByTestId('event-next')).toHaveCount(0);
  // The feed keeps the filters of the page.
  await expect(page.getByTestId('events-feed-link')).toHaveAttribute('href', '/events/calendar.ics?kind=camp');

  // The view switch keeps the filters too; the Agenda link is current on the Agenda.
  const views = page.getByRole('navigation', { name: 'View' });
  await expect(views.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
  await views.getByRole('link', { name: 'Month' }).click();
  await expect(page).toHaveURL(/\/events\?view=month&kind=camp$/);
  await expect(views.getByRole('link', { name: 'Month' })).toHaveAttribute('aria-current', 'page');
  // With no month asked for, the grid shows the month of the next matching event.
  await expect(page.getByTestId('month-title')).toHaveText('March 2027');
  expect(await slugs(page)).toEqual(['demo-spring-camp-london']);
});

test('@redesign the Month grid places each event on its day, chooses a day by a link, and moves between months', async ({ page }) => {
  await page.goto('/events?view=month&month=2027-03');
  await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
  await expect(page.getByTestId('month-title')).toHaveText('March 2027');
  // Monday first: 1 March 2027 is a Monday, so it is the first cell of the grid.
  await expect(page.getByTestId('month-day').first()).toHaveAttribute('data-day', '2027-03-01');
  await expect(day(page, '2027-03-13')).toHaveAttribute('data-count', '1');
  await expect(day(page, '2027-03-26')).toHaveAttribute('data-count', '1');
  await expect(day(page, '2027-03-14')).toHaveAttribute('data-count', '0');
  // The month's list names every event of the month, in order.
  const march = await slugs(page);
  expect(march).toContain('demo-seminar-chum-kiu-sofia');
  expect(march).toContain('demo-spring-camp-london');
  expect(march).not.toContain('demo-online-theory-evening');
  expect(march.indexOf('demo-seminar-chum-kiu-sofia')).toBeLessThan(march.indexOf('demo-spring-camp-london'));

  // A day with events is a link; the day's list replaces the month's, and the link says it is chosen.
  const link = day(page, '2027-03-13').getByRole('link', { name: /^13 March, 1 event$/ });
  const box = await link.boundingBox();
  if ((page.viewportSize()?.width ?? 1280) < 768) expect(box!.height, 'a 44 px target on a phone').toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/events\?view=month&month=2027-03&day=2027-03-13$/);
  await expect(day(page, '2027-03-13').getByRole('link').first()).toHaveAttribute('aria-current', 'date');
  await expect(page.getByTestId('month-list').getByRole('heading', { level: 2 })).toHaveText('Saturday 13 Mar');
  expect(await slugs(page)).toEqual(['demo-seminar-chum-kiu-sofia']);

  // The next month, by its link: the chosen day is left behind.
  await page.getByTestId('month-next').click();
  await expect(page).toHaveURL(/\/events\?view=month&month=2027-04$/);
  await expect(page.getByTestId('month-title')).toHaveText('April 2027');
  expect(await slugs(page)).toContain('demo-online-theory-evening');
  await page.getByTestId('month-prev').click();
  await expect(page.getByTestId('month-title')).toHaveText('March 2027');

  // A month with nothing says so.
  await page.goto('/events?view=month&month=2027-02');
  await expect(page.getByTestId('no-events')).toHaveText('No event this month.');

  for (const theme of THEMES) {
    await page.goto('/events?view=month&month=2027-03&day=2027-03-13');
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `events, month (${theme})`);
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('@redesign without JavaScript the Month view chooses days and months with plain links', async ({ page }) => {
    await page.goto('/events?view=month&month=2027-03');
    await day(page, '2027-03-26').getByRole('link').first().click();
    await expect(page).toHaveURL(/day=2027-03-26$/);
    expect(await slugs(page)).toEqual(['demo-spring-camp-london']);
    await page.getByTestId('month-next').click();
    await expect(page.getByTestId('month-title')).toHaveText('April 2027');
  });
});

test('@redesign an event without a poster gets a drawn banner, and its page offers more from its organizer', async ({ page }) => {
  await page.goto('/events/demo-online-theory-evening');
  const banner = page.getByTestId('event-banner');
  await expect(banner).toBeVisible();
  // Decorative ink, drawn on the server: an SVG hidden from assistive technology, never an image file.
  const art = banner.getByTestId('event-banner-art');
  await expect(art).toHaveAttribute('aria-hidden', 'true');
  await expect(banner.locator('img')).toHaveCount(0);
  // The same slug always gives the same drawing.
  const drawing = await art.innerHTML();
  await page.reload();
  expect(await page.getByTestId('event-banner-art').innerHTML()).toBe(drawing);

  // More from the same organizer: never the event itself.
  await page.goto('/events/demo-seminar-chum-kiu-sofia');
  const more = page.getByTestId('event-more');
  await expect(more).toBeVisible();
  const others = await more.getByTestId('event-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slug')));
  expect(others.length).toBeGreaterThan(0);
  expect(others).not.toContain('demo-seminar-chum-kiu-sofia');
  await expect(more.getByRole('link', { name: 'Every event of this organizer' })).toHaveAttribute('href', /^\/events\?person=demo-/);

  for (const theme of THEMES) {
    await page.goto('/events/demo-online-theory-evening');
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `event page, drawn banner (${theme})`);
  }
});

test('@redesign an organization filter lists the events it organizes', async ({ page }) => {
  await page.goto('/events?organization=demo-federation-north');
  expect(await slugs(page)).toEqual(['demo-federation-summer-camp']);
  await expect(page.getByTestId('events-feed-link')).toHaveAttribute('href', '/events/calendar.ics?organization=demo-federation-north');
});

test('@redesign the calendar feed carries the upcoming events of the same filters, from their public pages', async ({ page }) => {
  const all = await page.request.get('/events/calendar.ics');
  expect(all.status()).toBe(200);
  expect(all.headers()['content-type']).toMatch(/^text\/calendar/);
  // Inline: a calendar app subscribes to the address.
  expect(all.headers()['content-disposition']).toMatch(/^inline/);
  const body = await all.text();
  expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(body).toContain('\r\nX-WR-CALNAME:WingChunRoots events\r\n');
  expect(body).toContain('\r\nREFRESH-INTERVAL;VALUE=DURATION:PT12H\r\n');
  // One VEVENT per upcoming event; a past event is not in it.
  expect(body).toContain('\r\nDTSTART:20270313T080000Z\r\n');
  expect(body).toContain('/events/demo-spring-camp-london');
  expect(body).not.toContain('/events/demo-past-seminar-athens');
  // The place in words, as on the public page; never a point.
  expect(body).not.toMatch(/\r\nGEO[:;]/);

  const camps = await (await page.request.get('/events/calendar.ics?kind=camp&country=GB')).text();
  expect(camps).toContain('\r\nX-WR-CALNAME:WingChunRoots events: Camps\\, in United Kingdom\r\n');
  expect(camps.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(camps).toContain('/events/demo-spring-camp-london');
});
