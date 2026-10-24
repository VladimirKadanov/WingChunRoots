// Next.js's own error page, for the tests that a page shows its own content instead (M08 polish 2,
// note 1).
//
// When a render error reaches no error.tsx, Next.js shows its built-in page in <html id="__next_error__">
// (node_modules/next/dist/esm/client/components/builtin/global-error.js; the static 500 page,
// app-error.js, is the same). With JavaScript the page has the heading "This page couldn’t load",
// whose apostrophe is typographic (U+2019): an assertion written with a straight one never matches
// it and cannot fail. Without JavaScript the server sends only the empty root, a blank page with no
// heading at all, so the check below looks for the root as well as the heading.
// e2e/next-error.test.ts reads the heading from the installed Next.js and keeps the straight
// spelling of its texts out of the tests; e2e/next-error.spec.ts shows the check fails on the page.

import { expect, type Page } from '@playwright/test';

/** The heading of Next.js's error page, with either apostrophe. */
export const NEXT_ERROR_TITLE = /This page couldn['’]t load/;

/** The root element of Next.js's error page, with or without JavaScript. */
export const NEXT_ERROR_ROOT = 'html#__next_error__';

/** Asserts that `page` does not show Next.js's error page: neither its root element nor its heading. */
export async function expectNoNextErrorPage(page: Page, options?: { timeout?: number }) {
  await expect(page.locator(NEXT_ERROR_ROOT), "Next.js's error page").toHaveCount(0, options);
  await expect(page.getByText(NEXT_ERROR_TITLE), "the heading of Next.js's error page").toHaveCount(0, options);
}
