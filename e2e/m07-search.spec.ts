/**
 * Milestone M07: names, profile, account privacy and search (Done when 3). The palette runs
 * against `next start` and the demo data's search keys, which the worker writes after
 * `pnpm db:seed` (waitForSearchKeys). Tests that change data use accounts they create themselves
 * (`demo-e2e-…@example.test`) and fictional names only (D20); the seeded demo people are only read.
 */

import { randomBytes } from 'node:crypto';

import { devices, expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { MISSING_PRIMARY } from '../src/lib/profile-form';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { openPalette, option, palette, paletteQuery, personIdOf, search, searchInput, waitForSearchKeys } from './helpers/search';
import { expectNoAxeViolations, noClickAfterCancelledTouchPress, openInTheme, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(async () => {
  loadTestEnv();
  await waitForSearchKeys();
});
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

/** Fictional Latin letters for a name no other test uses (desktop and phone run at once). */
const tag = () =>
  [...randomBytes(6)]
    .map((b) => 'bcdfghjklmnpqrstvwz'[b % 19])
    .join('')
    .replace(/^./, (c) => c.toUpperCase());

/** The search answer of the API, as the palette receives it. */
async function apiSearch(page: Page, query: Record<string, string>) {
  const response = await page.request.post('/api/v1/search', { data: query, headers: { origin: BASE_URL } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as {
    query: string;
    morePeople: boolean;
    people: Record<string, unknown>[];
    schools: Record<string, unknown>[];
    lineages: Record<string, unknown>[];
  };
}

async function auditCount(action: string, actorUserId: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE action = ${action} AND actor_user_id = ${actorUserId}`);
  return rows.rows[0]!.n;
}

test('@M07 Ctrl+K opens the palette and the query "Тестов" finds demo-latin-name', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  await expect(palette(page)).toBeVisible();
  await expect(searchInput(page)).toBeFocused();
  await search(page, 'Тестов');
  await expect(option(page, 'Ivan Testov')).toBeVisible();
});

test('@M07 a Jyutping query finds demo-cjk-name and shows its stored name', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  await search(page, 'sou1 cing4 laam4');
  const hit = option(page, 'So Ching Laam').first();
  await expect(hit).toBeVisible();
  // The stored Jyutping of person_name, with its tone numbers and its own language.
  await expect(hit.locator('[lang="yue-Latn"]', { hasText: 'sou1 cing4 laam4' })).toBeVisible();
});

test('@M07 a match on a generated Jyutping key shows the stored primary name, not the generated romanization', async ({ page }) => {
  // A public profile with a Latin name and Chinese characters only: its Jyutping exists only as a
  // generated key ("wan sek" from 雲石).
  const latin = `Demo ${tag()} Cloudstone`;
  await freshAccount(page, { name: latin });
  const saved = await apiPost(page, '/profile/update', {
    names: [
      { kind: 'name', value: latin, script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true },
      { kind: 'name', value: '雲石', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: false },
    ],
    showPublicly: true,
  });
  expect(saved.status(), await saved.text()).toBe(200);

  await page.goto('/');
  await openPalette(page);
  await search(page, 'wan sek');
  const hit = option(page, latin);
  await expect(hit).toBeVisible();
  // The stored names: the display name and the characters the key was generated from.
  await expect(hit.locator('[lang="zh-Hant"]', { hasText: '雲石' })).toBeVisible();
  // Never the generated romanization.
  await expect(hit).not.toContainText('wan sek');
  await expect(hit).not.toContainText(/wan4|sek6/);
});

test('@M07 Simplified and Traditional spellings find the same person', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  await search(page, '蘇晴嵐');
  await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  const traditional = await option(page, 'So Ching Laam').first().innerText();
  await search(page, '苏晴岚');
  await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  expect((await option(page, 'So Ching Laam').first().innerText()).split('\n')[0]).toBe(traditional.split('\n')[0]);
  // And the API agrees: the same person first for both spellings.
  const [t, s] = [await apiSearch(page, { q: '蘇晴嵐' }), await apiSearch(page, { q: '苏晴岚' })];
  expect(t.people[0]?.slug).toBe('demo-cjk-name');
  expect(s.people[0]?.slug).toBe('demo-cjk-name');
});

test('@M07 a toneless pinyin query finds demo-cjk-name', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  await search(page, 'su qing lan');
  await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  expect((await apiSearch(page, { q: 'su qing lan' })).people.map((p) => p.slug)).toContain('demo-cjk-name');
});

test('@M07 a query filtered by country returns only people and schools in that country', async ({ page }) => {
  const rows = await getDb().execute<{ country_code: string }>(sql`SELECT country_code FROM person WHERE slug = 'demo-cjk-name'`);
  const country = rows.rows[0]!.country_code;
  const other = country === 'BG' ? 'GR' : 'BG';
  for (const q of ['laam', 'so ching', 'school']) {
    for (const code of [country, other]) {
      const answer = await apiSearch(page, { q, country: code });
      for (const person of answer.people) expect(person.countryCode, `${q} in ${code}`).toBe(code);
      for (const school of answer.schools) expect(school.countryCode, `${q} in ${code}`).toBe(code);
    }
  }
  // Schools: "kwoon" names demo schools in several countries (Athens, Berlin, Kowloon), and each
  // country keeps only its own; a country with no such school gets none.
  const kwoon = await apiSearch(page, { q: 'kwoon' });
  const schoolCountries = [...new Set(kwoon.schools.map((school) => school.countryCode as string))];
  expect(schoolCountries.length).toBeGreaterThanOrEqual(2);
  for (const code of schoolCountries) {
    const only = await apiSearch(page, { q: 'kwoon', country: code });
    expect(only.schools.length, `kwoon in ${code}`).toBeGreaterThan(0);
    for (const school of only.schools) expect(school.countryCode, `kwoon in ${code}`).toBe(code);
  }
  expect(schoolCountries).not.toContain('BG');
  expect((await apiSearch(page, { q: 'kwoon', country: 'BG' })).schools).toEqual([]);
  const sofia = await apiSearch(page, { q: 'wing chun', country: 'BG' });
  expect(sofia.schools.length).toBeGreaterThan(0);
  for (const school of sofia.schools) expect(school.countryCode).toBe('BG');
  expect((await apiSearch(page, { q: 'So Ching Laam', country })).people.map((p) => p.slug)).toContain('demo-cjk-name');
  expect((await apiSearch(page, { q: 'So Ching Laam', country: other })).people.map((p) => p.slug)).not.toContain('demo-cjk-name');
});

test.describe('with a desktop or iOS input method', () => {
  // The composition gate is off on Android (the next test), so this one names a browser that keeps it.
  test.use({ userAgent: devices['Desktop Chrome'].userAgent });

  test('@M07 no query is sent during IME composition and one is sent after compositionend', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);
    const sent: string[] = [];
    page.on('request', (request) => {
      const q = paletteQuery(request);
      if (q !== null) sent.push(q);
    });
    const input = searchInput(page);
    await input.dispatchEvent('compositionstart', { data: '' });
    // What an input method shows while it composes: Latin letters, then the characters.
    await input.fill('sou');
    await input.fill('蘇');
    await input.fill('蘇晴');
    await page.waitForTimeout(800);
    expect(sent).toEqual([]);
    const answered = page.waitForResponse((r) => paletteQuery(r.request()) !== null);
    await input.dispatchEvent('compositionend', { data: '蘇晴' });
    expect((await answered).status()).toBe(200);
    expect(sent).toEqual(['蘇晴']);
    await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  });
});

test.describe('on Android', () => {
  test.use({ userAgent: devices['Pixel 7'].userAgent });

  test('@M07 on Android a search runs while the keyboard composes a word (Gboard composes every Latin word)', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);
    const input = searchInput(page);
    // Gboard holds each Latin or Cyrillic word as a composition until a space or a suggestion commits it.
    await input.dispatchEvent('compositionstart', { data: '' });
    const answered = page.waitForResponse((r) => paletteQuery(r.request()) === 'So Ching Laam');
    await input.fill('So Ching Laam');
    expect((await answered).status()).toBe(200);
    await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  });
});

test('@M07 search results contain only public persons and no private fields', async ({ page }) => {
  // demo-pending and demo-claim-only-teacher are involved_only (DEFAULT D03).
  const hidden = await getDb().execute<{ slug: string; value: string }>(sql`
    SELECT p.slug, n.value FROM person p JOIN person_name n ON n.person_id = p.id AND n.is_primary
     WHERE p.slug IN ('demo-pending', 'demo-claim-only-teacher')`);
  expect(hidden.rows).toHaveLength(2);
  for (const row of hidden.rows) {
    const answer = await apiSearch(page, { q: row.value });
    expect(answer.people.map((p) => p.slug), row.value).not.toContain(row.slug);
  }
  const answer = await apiSearch(page, { q: 'sou cing laam' });
  expect(answer.people.length).toBeGreaterThan(0);
  const publicSlugs = new Set(
    (await getDb().execute<{ slug: string }>(sql`SELECT slug FROM v_public_person`)).rows.map((r) => r.slug),
  );
  for (const person of answer.people) {
    expect(publicSlugs.has(person.slug as string)).toBe(true);
    expect(Object.keys(person).sort()).toEqual(['city', 'countryCode', 'displayName', 'id', 'lineageName', 'matched', 'slug', 'verified']);
  }
  const text = JSON.stringify({ people: answer.people, schools: answer.schools, lineages: answer.lineages });
  expect(text).not.toMatch(/claimedBy|claimed_by|birth|email|public_point|exact_point|"key"|source|keyKind/i);
  // The generated keys never leave the server: the toneless forms are not in any answer.
  expect(text).not.toContain('"sou cing laam"');
  expect(text).not.toContain('soucinglaam');
});

test('@M07 pressing "/" with focus outside the graph does not open the palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-search-field]').filter({ visible: true })).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('/');
  await page.waitForTimeout(500);
  await expect(palette(page)).toHaveCount(0);
  // Ctrl/⌘+K still opens it.
  await openPalette(page);
  await expect(palette(page)).toBeVisible();
});

test('@M07 Ctrl+K opens the palette on a Cyrillic keyboard layout too (the physical K key)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-search-field]').filter({ visible: true })).toBeVisible();
  // With a Bulgarian layout the key reports its own letter; Playwright's keyboard has no layouts.
  await expect(async () => {
    const prevented = await page.evaluate(
      () => !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'л', code: 'KeyK', ctrlKey: true, cancelable: true })),
    );
    expect(prevented, 'the browser keeps no Ctrl+K of its own').toBe(true);
    await expect(searchInput(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});

test('@M07 Enter right after more typing opens the first result of the whole query, never a row of the earlier one', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  await search(page, 'So Ching');
  // The rows of "So Ching" are on screen. Typing the rest of a name that is not the first of them and
  // pressing Enter at once, within the 200 ms pause, must open that name's first result.
  const first = await palette(page).getByRole('option').first().innerText();
  const rest = first.includes('So Ching Laam') ? ' Long' : ' Laam';
  const expected = (await apiSearch(page, { q: `So Ching${rest}` })).people[0]!;
  expect(first).not.toContain((expected.displayName as { value: string }).value);
  await searchInput(page).press('End');
  await page.keyboard.type(rest);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === `/people/${expected.slug as string}`);

  // Ctrl/⌘+Enter the same way: the explorer opens on the person of the whole query.
  await openPalette(page);
  await search(page, 'So Ching');
  await searchInput(page).press('End');
  await page.keyboard.type(rest);
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForURL((url) => url.pathname === '/explore');
  expect(new URL(page.url()).searchParams.get('focus')).toBe(expected.id);
});

test('@M07 every opening starts with an empty field, and sign-out leaves no query, result or recent search in the palette', async ({ page }) => {
  await freshAccount(page);
  await page.goto('/account');
  await openPalette(page);
  await search(page, 'So Ching Laam');
  await option(page, 'So Ching Laam').first().click();
  await page.waitForURL((url) => url.pathname === '/people/demo-cjk-name');
  // Back to the account page without a page load (the palette's own Pages group), so the shell and
  // the palette stay mounted as they do in use.
  await openPalette(page);
  await expect(searchInput(page)).toHaveValue('');
  await expect(option(page, 'So Ching Laam')).toHaveCount(1);
  await search(page, 'Your account');
  await option(page, 'Your account').click();
  await page.waitForURL((url) => url.pathname === '/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/sign-in');
  expect(await page.evaluate(() => window.localStorage.getItem('wcr.recent-searches'))).toBeNull();
  // The next person on this device opens the palette: nothing of the last one.
  await openPalette(page);
  await expect(searchInput(page)).toHaveValue('');
  await expect(palette(page).getByRole('option')).toHaveCount(0);
  await expect(palette(page).getByText('Recent searches')).toHaveCount(0);
  await expect(palette(page).getByText('Search by any spelling')).toBeVisible();
});

test('@M07 the recent searches have a Clear button outside the list, 44 px or more, and no axe violations', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.setItem('wcr.recent-searches', JSON.stringify(['So Ching Laam', '蘇晴嵐', 'Тестов'])));
  await openPalette(page);
  await expect(option(page, 'Тестов')).toBeVisible();
  const clear = palette(page).getByRole('button', { name: 'Clear recent searches' });
  const box = await clear.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // No button inside the listbox, and the group is named by its label alone.
  await expect(palette(page).getByRole('listbox').getByRole('button')).toHaveCount(0);
  await expect(palette(page).getByRole('group', { name: 'Recent searches', exact: true })).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `the recent searches, ${theme} theme`);
  }
  await clear.click();
  await expect(palette(page).getByRole('option')).toHaveCount(0);
  await expect(searchInput(page)).toBeFocused();
  expect(await page.evaluate(() => window.localStorage.getItem('wcr.recent-searches'))).toBeNull();
});

test('@M07 when more people match than the list holds, the palette says so', async ({ page }) => {
  expect((await apiSearch(page, { q: 'so' })).morePeople).toBe(true);
  await page.goto('/');
  await openPalette(page);
  await search(page, 'so');
  await expect(palette(page).getByRole('status')).toContainText('Only the first 20 people are shown: type more of the name to narrow the list.');
  // A query with few matches (the fuzzy Latin "So Ching Laam" also finds 20 fixture namesakes).
  await search(page, '蘇晴嵐');
  await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  await expect(palette(page).getByRole('status')).not.toContainText('Only the first');
});

test("@M07 a user edits their own names in three scripts; editing another person's profile is refused", async ({ page }) => {
  const latin = `Demo ${tag()} Inkwell`;
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Your profile' })).toBeVisible();

  const display = page.getByLabel('Display name', { exact: true }).filter({ visible: true }).first();
  await display.fill(latin);
  await page.getByRole('button', { name: 'Add a name' }).click();
  await page.getByLabel('Name 2', { exact: true }).fill('測試雲');
  await page.getByLabel('Written in').nth(1).selectOption({ label: 'Chinese, Traditional characters' });
  await page.getByRole('button', { name: 'Add a name' }).click();
  await page.getByLabel('Name 3', { exact: true }).fill('Тест Облак');
  await page.getByLabel('Written in').nth(2).selectOption({ label: 'Bulgarian, Cyrillic' });
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();

  // Read back after a reload: every name in its own script, unchanged (NFC).
  await page.reload();
  await expect(page.getByLabel('Display name', { exact: true }).first()).toHaveValue(latin);
  await expect(page.getByLabel('Name 2', { exact: true })).toHaveValue('測試雲');
  await expect(page.getByLabel('Name 2', { exact: true })).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.getByLabel('Name 3', { exact: true })).toHaveValue('Тест Облак');
  await expect(page.getByLabel('Name 3', { exact: true })).toHaveAttribute('lang', 'bg-Cyrl');

  // Han characters a step larger; Cyrillic at the size of the Latin names. Kind is a 16 px field
  // like the others (no zoom on iOS), and a name that cannot be the display name says why.
  const fontSize = (label: string) =>
    page.getByLabel(label, { exact: true }).first().evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(await fontSize('Display name')).toBe(16);
  expect(await fontSize('Name 3')).toBe(16);
  expect(await fontSize('Name 2')).toBeGreaterThan(16);
  for (const kind of await page.getByLabel('Kind', { exact: true }).all()) {
    expect(await kind.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  }
  await expect(page.getByText('Choose “Latin letters” or “Cantonese, Hong Kong spelling” under “Written in” to use this name.')).toHaveCount(2);

  // Someone else's record: refused, through the same procedure.
  const other = await personIdOf('demo-hub-a');
  const refused = await apiPost(page, '/profile/update', {
    personId: other,
    names: [{ kind: 'name', value: 'Demo Someone Else', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true }],
    showPublicly: false,
  });
  expect(refused.status()).toBe(403);
  const unchanged = await getDb().execute<{ value: string }>(sql`SELECT value FROM person_name WHERE person_id = ${other}::uuid AND is_primary`);
  expect(unchanged.rows[0]!.value).not.toBe('Demo Someone Else');
});

test('@M07 a display name typed before the profile editor has its JavaScript is the one saved', async ({ page }) => {
  // A slow phone connection or webview: the person types into the page the server drew while its
  // scripts are still on the way. Hydration must not put the old name back (the iPhone run of
  // PR #13 saved "Demo Placeholder Name").
  const latin = `Demo ${tag()} Earlybird`;
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  let releaseScripts!: () => void;
  const scriptsHeld = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await scriptsHeld;
    await route.continue();
  });
  await page.goto('/dashboard/profile', { waitUntil: 'commit' });
  const display = page.getByLabel('Display name', { exact: true }).filter({ visible: true }).first();
  await display.fill(latin);
  // Still the page without JavaScript: "Add a name" comes with it.
  await expect(page.getByRole('button', { name: 'Add a name' })).toHaveCount(0);
  releaseScripts();
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  await expect(display).toHaveValue(latin);
  // The editor's own state has it too: its preview shows it.
  await expect(page.getByRole('figure', { name: 'How your name will appear' })).toContainText(latin);
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name', { exact: true }).first()).toHaveValue(latin);
});

/** Where an edit of the profile editor landed while the page hydrated (watchHydration). */
type HydrationWindow = 'W0' | 'W1' | 'W2' | 'W3' | 'W4';
interface HydrationRecord {
  /** react-dom found the DevTools hook and injected itself: without it, nothing below is seen. */
  hooked: boolean;
  /** The commit that hydrated the display name happened; its passive effects (useEffect) ran. */
  committed: boolean;
  passive: boolean;
  /** Every input event of the display name and of the biography, with the window it landed in. */
  inputs: { field: string; window: HydrationWindow }[];
  /** textInput events kept from React (suppressTextInput). */
  textInputs: number;
  /** The edit made right after the hydrating commit (editInW3): the field's text after it, the country chosen. */
  w3Edit: { value: string; country: string } | null;
  problem: string | null;
}

/**
 * An init script that watches the profile editor hydrate (PR #13: the iPhone runs saved the old
 * display name). An edit can land before React has a root (W0), while the display name has no
 * fiber yet (W1), with a fiber but before the commit that hydrated it (W2), after that commit but
 * before its passive effects (W3), or after them (W4). React's DevTools hook (which the production
 * react-dom calls on every commit and after its passive effects) tells the commit; a capture
 * listener on window (before React's own on the document) tells where each input event landed.
 * `suppressTextInput` keeps textInput from React, as WebKit sends none before the edit (Chromium
 * does, and its textInput hydrates the field first). `editInW3` types that name into the display
 * name, and chooses a country, in a microtask right after the hydrating commit. The record is
 * window.__hydration: the tests check it, so that a missed window fails instead of passing for
 * nothing.
 */
function watchHydration({ suppressTextInput, editInW3 }: { suppressTextInput: boolean; editInW3: string | null }) {
  const record: HydrationRecord = { hooked: false, committed: false, passive: false, inputs: [], textInputs: 0, w3Edit: null, problem: null };
  const w = window as unknown as { __hydration: HydrationRecord; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
  w.__hydration = record;
  type Fiber = { return: Fiber | null };
  const display = () => document.querySelector<HTMLInputElement>('input[name="names.0.value"]');
  const fiberOf = (node: Element): Fiber | null => {
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    return key ? (node as unknown as Record<string, Fiber>)[key]! : null;
  };
  const windowOf = (node: Element): HydrationWindow => {
    if (!Object.keys(document).some((k) => k.startsWith('__reactContainer$'))) return 'W0';
    if (!fiberOf(node)) return 'W1';
    if (!record.committed) return 'W2';
    return record.passive ? 'W4' : 'W3';
  };
  const edit = (text: string) => {
    const field = display();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const country = document.querySelector<HTMLSelectElement>('select[name="countryCode"]');
    const code = country ? [...country.options].find((o) => o.value && o.value !== country.value)?.value : undefined;
    if (!field || !setValue || !country || !code) {
      record.problem = 'the display name, the value setter or a country to choose is missing';
      return;
    }
    // As a person types: the browser's own value setter (React's tracker still holds the old
    // text), then the input event; and a country chosen in the list.
    field.focus();
    setValue.call(field, text);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    country.value = code;
    country.dispatchEvent(new Event('change', { bubbles: true }));
    record.w3Edit = { value: field.value, country: code };
  };
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined) {
    record.problem = 'a React DevTools hook was already installed';
    return;
  }
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject() {
      record.hooked = true;
      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    setStrictMode() {},
    onCommitFiberRoot(_renderer: number, root: { current: Fiber }) {
      if (record.committed) return;
      const field = display();
      let top = field && fiberOf(field);
      if (!top) return;
      // The field's fiber belongs to the tree this commit made current, not to a render still in progress.
      while (top.return) top = top.return;
      if (top !== root.current) return;
      record.committed = true;
      if (editInW3 !== null) queueMicrotask(() => edit(editInW3));
    },
    onPostCommitFiberRoot() {
      if (record.committed) record.passive = true;
    },
  };
  window.addEventListener(
    'textInput',
    (event) => {
      if (!suppressTextInput) return;
      record.textInputs++;
      event.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if ((target instanceof HTMLInputElement && target.name === 'names.0.value') || (target instanceof HTMLTextAreaElement && target.name === 'bio')) {
        record.inputs.push({ field: target.name, window: windowOf(target) });
      }
    },
    true,
  );
}

const hydrationRecord = (page: Page) => page.evaluate(() => (window as unknown as { __hydration: HydrationRecord }).__hydration);

/** Saves a biography for the account (its only name stays the display name). */
async function saveBio(page: Page, name: string, body: string) {
  const saved = await apiPost(page, '/profile/update', {
    names: [{ kind: 'name', value: name, script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true }],
    bio: { body, lang: 'en' },
    showPublicly: false,
  });
  expect(saved.status(), await saved.text()).toBe(200);
}

/** The saved profile in a page of its own (the test's page keeps its init script and routes). */
async function openSavedProfile(page: Page) {
  const fresh = await page.context().newPage();
  await fresh.goto('/dashboard/profile');
  await expect(fresh.getByRole('button', { name: 'Add a name' })).toBeVisible();
  return fresh;
}

test('@M07 a display name typed between the commit that hydrates the profile editor and its effects is the one saved', async ({ page }) => {
  // The window the iPhone run of PR #13 hit after the first fix (W3): the edit reaches the form
  // state, but React has not yet subscribed to it and puts the text it drew back into a
  // controlled field. A controlled select (Country) is changed in the same moment.
  const latin = `Demo ${tag()} Afterglow`;
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  await page.addInitScript(watchHydration, { suppressTextInput: false, editInW3: latin });
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  const record = await hydrationRecord(page);
  expect(record.problem).toBeNull();
  expect(record.hooked, 'react-dom used the DevTools hook').toBe(true);
  expect(record.committed, 'the commit that hydrated the display name was seen').toBe(true);
  expect(record.inputs, 'the edit landed after that commit, before its effects (W3)').toEqual([{ field: 'names.0.value', window: 'W3' }]);
  expect(record.w3Edit?.value, 'React left the typed name in the field').toBe(latin);

  const display = page.getByLabel('Display name', { exact: true }).filter({ visible: true }).first();
  await expect(display).toHaveValue(latin);
  await expect(page.getByRole('figure', { name: 'How your name will appear' })).toContainText(latin);
  await expect(page.getByLabel('Country')).toHaveValue(record.w3Edit!.country);
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
  const saved = await openSavedProfile(page);
  await expect(saved.getByLabel('Display name', { exact: true }).first()).toHaveValue(latin);
  await expect(saved.getByLabel('Country')).toHaveValue(record.w3Edit!.country);
});

test('@M07 a display name and a biography typed while the profile editor hydrates are the ones saved, with no textInput before the edit as in WebKit', async ({ page }) => {
  // W1 (and W2): React has a root, but the editor's fields are not hydrated yet. The chunk with
  // the editor is held, so the edit lands there; textInput is kept from React. The biography
  // replaces a saved one: React's hydration of a textarea puts the saved text back into it.
  const latin = `Demo ${tag()} Midstream`;
  const bio = `Demo biography ${tag()}, typed while the page was getting ready.`;
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  await saveBio(page, 'Demo Placeholder Name', 'Demo saved biography.');
  await page.addInitScript(watchHydration, { suppressTextInput: true, editInW3: null });
  let releaseEditor!: () => void;
  const editorHeld = new Promise<void>((resolve) => {
    releaseEditor = resolve;
  });
  let held = 0;
  await page.route('**/_next/static/**/*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('Use as display name')) {
      held++;
      await editorHeld;
    }
    await route.fulfill({ response, body });
  });
  await page.goto('/dashboard/profile', { waitUntil: 'commit' });
  // hydrateRoot has run: from here until the editor's chunk comes, an edit lands during hydration.
  await page.waitForFunction(() => Object.keys(document).some((k) => k.startsWith('__reactContainer$')));
  const display = page.getByLabel('Display name', { exact: true }).filter({ visible: true }).first();
  await display.fill(latin);
  await page.getByLabel('Short biography').fill(bio);
  expect(held, 'the chunk with the editor was held').toBeGreaterThan(0);
  releaseEditor();
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  const record = await hydrationRecord(page);
  expect(record.problem).toBeNull();
  expect(record.hooked, 'react-dom used the DevTools hook').toBe(true);
  expect(record.inputs.map((e) => e.field), 'both edits were seen').toEqual(expect.arrayContaining(['names.0.value', 'bio']));
  for (const { field, window } of record.inputs) expect(['W1', 'W2'], `${field}: the edit landed while the editor hydrated`).toContain(window);

  await expect(display).toHaveValue(latin);
  await expect(page.getByLabel('Short biography')).toHaveValue(bio);
  await expect(page.getByRole('figure', { name: 'How your name will appear' })).toContainText(latin);
  await expect(page.getByText(`${bio.length} of 1000`)).toBeVisible();
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
  const saved = await openSavedProfile(page);
  await expect(saved.getByLabel('Display name', { exact: true }).first()).toHaveValue(latin);
  await expect(saved.getByLabel('Short biography')).toHaveValue(bio);
});

test('@M07 a biography typed over a saved one before the profile editor has its JavaScript is the one saved', async ({ page }) => {
  // W0 for the biography: unlike an input, a textarea does not keep typed text through
  // hydration when the server drew some (React writes the saved biography back into it).
  const bio = `Demo biography ${tag()}, typed before the scripts came.`;
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  await saveBio(page, 'Demo Placeholder Name', 'Demo saved biography.');
  await page.addInitScript(watchHydration, { suppressTextInput: false, editInW3: null });
  let releaseScripts!: () => void;
  const scriptsHeld = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await scriptsHeld;
    await route.continue();
  });
  await page.goto('/dashboard/profile', { waitUntil: 'commit' });
  const field = page.getByLabel('Short biography');
  await expect(field).toHaveValue('Demo saved biography.');
  await field.fill(bio);
  await expect(page.getByRole('button', { name: 'Add a name' })).toHaveCount(0);
  releaseScripts();
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  const record = await hydrationRecord(page);
  expect(record.inputs.length, 'the edit was seen').toBeGreaterThan(0);
  for (const { window } of record.inputs) expect(window, 'the edit landed before React had a root').toBe('W0');
  await expect(field).toHaveValue(bio);
  await expect(page.getByText(`${bio.length} of 1000`)).toBeVisible();
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
  const saved = await openSavedProfile(page);
  await expect(saved.getByLabel('Short biography')).toHaveValue(bio);
});

test('@M07 while a profile save is on its way, no choice can be made that the saved profile would undo', async ({ page }) => {
  // A slow connection: the save sends what the fields held when Save was pressed, and the saved
  // profile is written back into them when the answer comes. A choice made in between would be
  // undone without a word ("Show my profile publicly" is the consent to publication), so every
  // control is inert until then, as the text fields are.
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  const two = await apiPost(page, '/profile/update', {
    names: [
      { kind: 'name', value: 'Demo Placeholder Name', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true },
      { kind: 'name', value: 'Demo Second Name', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: false },
    ],
    showPublicly: false,
  });
  expect(two.status(), await two.text()).toBe(200);
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  let releaseSave!: () => void;
  const saveHeld = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(
    (url) => url.pathname === '/dashboard/profile',
    async (route) => {
      if (route.request().method() === 'POST') await saveHeld;
      await route.continue();
    },
  );

  const name2 = page.getByLabel('Name 2', { exact: true });
  const publicly = page.getByLabel('Show my profile publicly');
  const radios = page.getByRole('radio', { name: 'Use as display name' });
  const preview = page.getByRole('figure', { name: 'How your name will appear' });
  const controls = [
    publicly,
    radios.nth(0),
    radios.nth(1),
    page.getByLabel('Written in').nth(0),
    page.getByLabel('Written in').nth(1),
    page.getByLabel('Kind', { exact: true }).nth(0),
    page.getByLabel('Kind', { exact: true }).nth(1),
    page.getByLabel('Language of the biography'),
    page.getByLabel('Country'),
    page.getByLabel('City'),
    page.getByRole('button', { name: 'Add a name' }),
    page.getByRole('button', { name: 'Remove name 1' }),
    page.getByRole('button', { name: 'Remove name 2' }),
  ];
  const textFields = [page.getByLabel('Display name', { exact: true }), name2, page.getByLabel('Short biography'), page.getByLabel('Year you started Wing Chun')];
  await name2.fill('Demo Second Edited');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeVisible();
  // A tap on the consent or on another display name while it is on its way changes nothing.
  await publicly.click({ force: true });
  await radios.nth(1).click({ force: true });
  await expect(publicly).not.toBeChecked();
  await expect(radios.nth(0)).toBeChecked();
  await expect(preview).toContainText('Demo Placeholder Name');
  for (const control of controls) await expect(control).toBeDisabled();
  for (const field of textFields) await expect(field).not.toBeEditable();

  releaseSave();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
  for (const control of controls) await expect(control).toBeEnabled();
  for (const field of textFields) await expect(field).toBeEditable();
  await expect(name2).toHaveValue('Demo Second Edited');
  await expect(publicly).not.toBeChecked();
  await expect(radios.nth(0)).toBeChecked();
  await expect(preview).toContainText('Demo Placeholder Name');

  // Then the same choices are made and saved.
  await publicly.check();
  await radios.nth(1).check();
  await expect(preview).toContainText('Demo Second Edited');
  const answered = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/dashboard/profile');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await answered;
  await expect(page.getByRole('button', { name: 'Save my profile' })).toBeVisible();
  const saved = await openSavedProfile(page);
  await expect(saved.getByLabel('Display name', { exact: true }).first()).toHaveValue('Demo Second Edited');
  await expect(saved.getByLabel('Show my profile publicly')).toBeChecked();
});

test('@M07 "Also known as" stays chosen when "Written in" goes to a romanization and back, and is saved so', async ({ page }) => {
  // A romanization is always a name: its Kind is a hidden field that says so, and the row keeps the
  // Kind chosen before, which comes back with Latin letters.
  await freshAccount(page, { name: 'Demo Placeholder Name' });
  await page.goto('/dashboard/profile');
  await page.getByRole('button', { name: 'Add a name' }).click();
  await page.getByLabel('Name 2', { exact: true }).fill(`Demo ${tag()} Alias`);
  const kind = page.getByLabel('Kind', { exact: true }).nth(1);
  const second = page.getByRole('radio', { name: 'Use as display name' }).nth(1);
  await kind.selectOption('alias');
  await expect(second).toBeDisabled();
  await page.getByLabel('Written in').nth(1).selectOption({ label: 'Cantonese, Jyutping' });
  await expect(page.getByLabel('Kind', { exact: true })).toHaveCount(1);
  await page.getByLabel('Written in').nth(1).selectOption({ label: 'Latin letters' });
  await expect(kind).toHaveValue('alias');
  await expect(second).toBeDisabled();
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
  await expect(kind).toHaveValue('alias');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  await expect(kind).toHaveValue('alias');
  await expect(second).toBeDisabled();
});

test('@M07 saving a profile without a Latin-script primary name is refused with a clear message', async ({ page }) => {
  await freshAccount(page, { name: 'Demo Lonely Name' });
  await page.goto('/dashboard/profile');
  // The only name becomes Chinese characters: it can no longer be the display name.
  await page.getByLabel('Written in').first().selectOption({ label: 'Chinese, Traditional characters' });
  await page.getByLabel(/^(Display name|Name 1)$/).filter({ visible: true }).first().fill('測試');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  const summary = page.locator('[data-form-message]').filter({ visible: true });
  await expect(summary).toContainText(MISSING_PRIMARY);
  // The row says what to change, not only that Latin letters are needed.
  await expect(page.getByText('Choose “Latin letters” or “Cantonese, Hong Kong spelling” under “Written in” to use this name.').first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toHaveCount(0);

  // The procedure refuses it too, with the same message, whatever the browser checked.
  const refused = await apiPost(page, '/profile/update', {
    names: [{ kind: 'name', value: '測試', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: true }],
    showPublicly: false,
  });
  expect(refused.status()).toBe(400);
  expect(((await refused.json()) as { message: string }).message).toBe(MISSING_PRIMARY);
});

test('@M07 Ctrl+Enter navigates to /explore?focus=<id> of the selected person', async ({ page }) => {
  const id = await personIdOf('demo-cjk-name');
  await page.goto('/');
  await openPalette(page);
  await search(page, 'So Ching Laam');
  await expect(option(page, 'So Ching Laam').first()).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForURL((url) => url.pathname === '/explore');
  expect(new URL(page.url()).searchParams.get('focus')).toBe(id);
});

test('@M07 withdrawing a consent records consent.withdraw', async ({ page }) => {
  const account = await freshAccount(page);
  const onboard = await apiPost(page, '/account/onboard', { primaryName: `Demo ${tag()} Consent`, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  await page.goto('/account/privacy');
  await expect(page.getByTestId('consent-state-publication')).toContainText('Given');
  await page.getByRole('button', { name: 'Withdraw and make my profile private' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'withdrawn and your profile is private again' })).toBeVisible();
  expect(await auditCount('consent.withdraw', account.userId)).toBe(1);
  const records = await getDb().execute<{ action: string }>(sql`
    SELECT action FROM consent_record WHERE user_id = ${account.userId}::uuid AND kind = 'publication' ORDER BY occurred_at`);
  expect(records.rows.map((r) => r.action)).toEqual(['granted', 'withdrawn']);
  await page.reload();
  await expect(page.getByTestId('consent-state-publication')).toContainText('Withdrawn');
});

test('@M07 a deletion request creates a review case and notifies admins', async ({ page }) => {
  const account = await freshAccount(page, { name: `Demo ${tag()} Leaving` });
  await page.goto('/account/privacy');
  const button = page.getByRole('button', { name: 'Request account deletion' });
  // Not without the confirmation, which is never ticked in advance.
  await expect(page.getByLabel(/I want my account deleted/)).not.toBeChecked();
  await button.click();
  await expect(page.getByText('Tick this box to confirm that you want your account deleted.')).toBeVisible();
  await page.getByLabel(/I want my account deleted/).check();
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: 'Your request is sent.' })).toBeVisible();

  const cases = await getDb().execute<{ id: string; status: string }>(sql`
    SELECT id::text AS id, status FROM review_case WHERE kind = 'deletion_request' AND opened_by_user_id = ${account.userId}::uuid`);
  expect(cases.rows).toHaveLength(1);
  expect(cases.rows[0]!.status).toBe('open');
  const admins = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM auth_user WHERE role = 'admin'`);
  const notes = await getDb().execute<{ user_id: string }>(sql`
    SELECT user_id::text AS user_id FROM notification WHERE template = 'account.deletion-requested' AND payload->>'caseId' = ${cases.rows[0]!.id}`);
  expect(notes.rows.map((r) => r.user_id).sort()).toEqual(admins.rows.map((r) => r.id).sort());
  expect(await auditCount('account.deletion_request', account.userId)).toBe(1);
  await page.reload();
  await expect(page.getByText(/You asked for your account to be deleted on/)).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M07 at 390x844 the palette opens full screen and a result can be chosen by touch', async ({ page }) => {
    await page.goto('/');
    const field = page.locator('[data-search-field="bar"]');
    await expect(field).toBeVisible();
    await expect(async () => {
      await field.tap();
      await expect(searchInput(page)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const box = await palette(page).boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await search(page, 'So Ching Laam');
    const hit = option(page, 'So Ching Laam').first();
    const target = await hit.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
    await hit.tap();
    await page.waitForURL((url) => url.pathname === '/people/demo-cjk-name');
    await expect(palette(page)).toHaveCount(0);
  });

  test('@M07 at 390x844 a tap chooses a recent search and a result, also where a cancelled touch press brings no click (WebKit GTK, WPE)', async ({
    page,
  }) => {
    // Chromium sends the click after a cancelled touch pointerdown; WebKit's GTK and WPE ports, which the
    // mobile-webkit project runs on, do not. Here every browser behaves like those ports.
    await noClickAfterCancelledTouchPress(page);
    await page.addInitScript(() => window.localStorage.setItem('wcr.recent-searches', JSON.stringify(['So Ching Laam'])));
    await page.goto('/');
    const field = page.locator('[data-search-field="bar"]');
    await expect(field).toBeVisible();
    await expect(async () => {
      await field.tap();
      await expect(searchInput(page)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(searchInput(page)).toBeFocused();

    // A recent search runs again, and the field keeps the focus (the phone keeps its keyboard).
    const answered = page.waitForResponse((r) => paletteQuery(r.request()) === 'So Ching Laam');
    await palette(page).locator('[data-kind="recent"]').filter({ hasText: 'So Ching Laam' }).tap();
    expect((await answered).status()).toBe(200);
    await expect(searchInput(page)).toHaveValue('So Ching Laam');
    await expect(searchInput(page)).toBeFocused();

    await palette(page).locator('[data-kind="person"]').filter({ hasText: 'So Ching Laam' }).first().tap();
    await page.waitForURL((url) => url.pathname === '/people/demo-cjk-name');
    await expect(palette(page)).toHaveCount(0);
  });

  test('@M07 at 390 and 320 px the profile editor fits the screen: Kind and Remove stay inside their card', async ({ page }) => {
    await freshAccount(page, { name: 'Demo Narrow Screen' });
    await page.goto('/dashboard/profile');
    await page.getByRole('button', { name: 'Add a name' }).click();
    await page.getByLabel('Name 2', { exact: true }).fill('測試雲');
    await page.getByLabel('Written in').nth(1).selectOption({ label: 'Chinese, Traditional characters' });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      // A phone widens its layout viewport to fit wider content, so the screen width is the bound.
      const scrollWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      expect(scrollWidth, `${width} px: no horizontal scroll`).toBeLessThanOrEqual(width);
      const cards = page.locator('[data-name-row]');
      await expect(cards).toHaveCount(2);
      for (const card of await cards.all()) {
        const right = await card.evaluate((el) => el.getBoundingClientRect().right);
        for (const control of [card.getByLabel('Kind', { exact: true }), card.getByRole('button', { name: 'Remove' })]) {
          const box = (await control.boundingBox())!;
          expect(box.x + box.width, `${width} px: inside the card`).toBeLessThanOrEqual(right);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });
});

test.describe('on a phone in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('@M07 at 844x390 the palette still fills the screen and shows no keyboard hints', async ({ page }) => {
    await page.goto('/');
    const field = page.locator('[data-search-field]').filter({ visible: true });
    await expect(field).toBeVisible();
    await expect(async () => {
      await field.tap();
      await expect(searchInput(page)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    expect(await palette(page).boundingBox()).toEqual({ x: 0, y: 0, width: 844, height: 390 });
    await expect(palette(page).getByText('to open a person in the explorer')).toBeHidden();
    await search(page, 'So Ching Laam');
    await expect(option(page, 'So Ching Laam').first()).toBeInViewport();
  });
});

test('@M07 no axe violations with the palette open in dark and light themes', async ({ page }) => {
  await openInTheme(page, '/', THEMES[0]!);
  await openPalette(page);
  await search(page, 'So Ching');
  await expect(option(page, 'So Ching Laam').first()).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `the palette with results, ${theme} theme`);
  }
  // The empty palette: the recent searches or the hint.
  await searchInput(page).fill('');
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `the empty palette, ${theme} theme`);
  }
});
