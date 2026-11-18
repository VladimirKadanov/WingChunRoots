// The control panel in Bulgarian (owner request 2026-11-18, docs/adr/0043-admin-bulgarian.md): a
// full administrator reads every /admin page in Bulgarian and switches it to English and back from
// the navigation; a moderator or an archivist always reads English and has no switch, whatever the
// cookie says. Every /admin page of e2e/routes.ts has no axe violations in Bulgarian in both themes
// and shows none of the common English words outside data (names, codes, e-mail addresses). The
// E2E server's default is English (ADMIN_DEFAULT_LANGUAGE=en, playwright.config.ts), so these
// tests choose Bulgarian with the cookie, as the switch does. Fictional data only (D20).

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, signInAsForPages } from './helpers/auth';
import { expectNoAxeViolations, openInTheme, resolvedTheme } from './helpers/ui';
import { ROUTES, THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

const ADMIN_ROUTES = ROUTES.filter((route) => route.path.startsWith('/admin') && route.status === 200);

async function chooseBulgarian(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'wcr.admin_lang', value: 'bg', url: `${BASE_URL}/admin`, sameSite: 'Lax' }]);
}

/**
 * The common English words a translated page must not show. Data keeps its own language and is
 * skipped: names and other text marked translate="no", code, and anything in another lang.
 */
const ENGLISH = /\b(the|and|of|to|for|with|from|your|you|is|are|this|show|save|cancel|page|none|yet|every|nobody|waiting|assigned|open|find)\b/i;

async function englishLeft(page: Page): Promise<string[]> {
  return page.evaluate((source) => {
    const pattern = new RegExp(source, 'i');
    const left: string[] = [];
    const root = document.querySelector('[data-admin-nav-slot]')?.parentElement ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? '';
      if (!parent || !text) continue;
      if (parent.closest('[translate="no"], code, script, style, svg, [lang]:not([lang="bg"])')) continue;
      if (pattern.test(text)) left.push(text.slice(0, 120));
    }
    for (const el of root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]')) {
      if (el.closest('[translate="no"], [lang]:not([lang="bg"])')) continue;
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        const value = el.getAttribute(attr);
        if (value && pattern.test(value)) left.push(`${attr}="${value.slice(0, 120)}"`);
      }
    }
    return [...new Set(left)];
  }, ENGLISH.source);
}

test('@admin @controlpanel a full administrator switches the control panel between Bulgarian and English', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'admin');
  await chooseBulgarian(context);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Табло' })).toBeVisible();
  await expect(page.locator('[lang="bg"]').filter({ has: page.getByRole('heading', { level: 1 }) })).toHaveCount(1);
  const nav = page.getByRole('navigation', { name: 'Контролен панел' });
  await expect(nav.getByRole('link', { name: 'Заявки за преглед' }).filter({ visible: true })).toBeVisible();

  await nav.getByRole('button', { name: 'English' }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  const english = page.getByRole('navigation', { name: 'Control panel' });
  await expect(english.getByRole('button', { name: 'English' }).filter({ visible: true })).toHaveAttribute('aria-pressed', 'true');

  // The choice is kept for the next page, and switching back works from any page.
  await page.goto('/admin/review');
  await expect(page.getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible();
  await english.getByRole('button', { name: 'Български' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/admin\/review$/);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Review queue');
  await expect(page.getByRole('navigation', { name: 'Контролен панел' })).toBeVisible();
  await context.close();
});

test('@admin @controlpanel a moderator reads the control panel in English with no switch, even with the cookie', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'moderator');
  await chooseBulgarian(context);
  await page.goto('/admin/review');
  await expect(page.getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Control panel' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Български' })).toHaveCount(0);
  await expect(page.locator('[lang="bg"]')).toHaveCount(0);
  await context.close();
});

for (const route of ADMIN_ROUTES) {
  for (const theme of THEMES) {
    test(`@admin ${route.path} (${route.name}) in Bulgarian has no axe violations in the ${theme} theme`, { tag: ['@a11y'] }, async ({ page }) => {
      await signInAsForPages(page, 'admin');
      await chooseBulgarian(page.context());
      const response = await openInTheme(page, route.path, theme);
      expect(response?.status()).toBe(200);
      expect(await resolvedTheme(page)).toBe(theme);
      await expectNoAxeViolations(page, `${route.path} in Bulgarian (${theme})`);
    });
  }
  test(`@admin ${route.path} (${route.name}) in Bulgarian shows no English outside data`, async ({ page }) => {
    await signInAsForPages(page, 'admin');
    await chooseBulgarian(page.context());
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await englishLeft(page)).toEqual([]);
  });
}
