// The phone layout (docs/adr/0053-phone-layout.md): below a breakpoint, filters, the explorer's
// options, the dashboard menu and the profile's lineage key fold behind a button (a <details>).
// These open one when it is folded and leave it as it is otherwise (a desktop shows them open),
// so a test reaches the same controls at every size.

import { expect, type Locator, type Page } from '@playwright/test';

/** Opens a <details> by its summary when the summary is shown and the details is closed. */
export async function unfold(details: Locator): Promise<void> {
  // Drawn and in place by then (isVisible does not wait): a part that streams in (the dashboard's
  // menu) waits in a hidden <div> until React moves it into the page. Next.js keeps earlier routes
  // in the document, hidden: only the shown one counts.
  await expect.poll(() => details.evaluateAll((all) => all.some((el) => !el.closest('[hidden]')))).toBe(true);
  details = details.filter({ visible: true });
  const summary = details.locator(':scope > summary');
  if (!(await summary.isVisible())) return;
  if (await details.evaluate((el) => (el as HTMLDetailsElement).open)) return;
  await summary.click();
  await expect(details).toHaveAttribute('open', '');
}

/** Closes a <details> by its summary when the summary is shown and the details is open. */
export async function fold(details: Locator): Promise<void> {
  details = details.filter({ visible: true });
  const summary = details.locator(':scope > summary');
  if (!(await summary.isVisible())) return;
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) return;
  await summary.click();
  await expect(details).not.toHaveAttribute('open', '');
}

/** The Filters of a form (events, the school finder): `scope` is the page or the form. */
export const openFilters = (scope: Page | Locator) => unfold(scope.getByTestId('filters').first());

/** The explorer's Options (the steppers, the lineage picker, "Show former students"). */
export const openExplorerOptions = (page: Page) => unfold(page.getByTestId('explorer-options'));
/** Folds the Options again: on a phone their panel lies over the top of the graph. */
export const closeExplorerOptions = (page: Page) => fold(page.getByTestId('explorer-options'));


/** The lineage key of a person's page and their lineage list ("What the lines mean", folded below 1280 px). */
export const openLineageKey = (page: Page) => unfold(page.getByTestId('lineage-key'));

/** The dashboard's menu (one button below 1024 px). */
export const openDashboardMenu = (page: Page) => unfold(page.getByTestId('dashboard-menu'));
