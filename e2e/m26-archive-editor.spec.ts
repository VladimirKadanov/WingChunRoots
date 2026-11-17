// M26 (docs/plan/M26-archive-editor.md): the archive editor end to end, in the exclusive run (it
// writes public data: PUBLIC_WRITE_SPECS). An administrator creates two historical records, a lineage
// whose root is the first, and a verified link with its source; the teacher's public profile appears
// and never shows the source; the explorer offers the lineage. A moderator is refused. Fictional data
// only (D20): every name is "Demo …" with random letters.

import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, type SignInTarget } from './helpers/auth';
import { letters } from './helpers/evidence';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });
const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

async function signedIn(browser: Browser, target: SignInTarget) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, target);
  return { context, page };
}

/** Creates a historical record from the editor's form; returns its address. */
async function createRecord(page: Page, name: string): Promise<string> {
  await page.goto('/admin/archive#new-record');
  const form = visible(page.getByTestId('record-create-form'));
  await form.getByLabel(/^Name in Latin letters/).fill(name);
  await form.getByLabel(/^Life status/).selectOption({ label: 'Deceased' });
  await form.getByLabel(/^Reason/).fill('A fictional register of the end-to-end test.');
  await form.getByRole('button', { name: 'Create the record' }).click();
  await page.waitForURL(/[?&]done=record/);
  await expect(visible(page.getByTestId('archive-outcome'))).toContainText('The record is created');
  const slug = new URL(page.url()).searchParams.get('record');
  expect(slug).toMatch(/^demo-/);
  return slug!;
}

test('@M26 an administrator records two historical teachers, a lineage and a verified link with its source; the public profile shows the link and never the source', async ({ browser }) => {
  const tag = capital(letters(8));
  const { context, page } = await signedIn(browser, 'admin');

  const teacherName = `Demo Archive Teacher ${tag}`;
  const studentName = `Demo Archive Student ${tag}`;
  const teacher = await createRecord(page, teacherName);
  const student = await createRecord(page, studentName);

  // A new lineage with the teacher at its root.
  await page.goto('/admin/archive#new-lineage');
  const lineageForm = visible(page.getByTestId('lineage-create-form'));
  await lineageForm.getByLabel(/^Name of the lineage/).fill(`Demo Archive Lineage ${tag}`);
  await lineageForm.getByLabel(/^Root record/).fill(teacher);
  await lineageForm.getByLabel(/^Reason/).fill('A fictional lineage of the end-to-end test.');
  await lineageForm.getByRole('button', { name: 'Create the lineage' }).click();
  await page.waitForURL(/\/admin\/archive\/lineages\/demo-archive-lineage-[a-z]+\?done=created/);
  await expect(visible(page.getByTestId('lineage-facts'))).toContainText('Not in the explorer yet');
  await expectNoAxeViolations(page, 'the new lineage');

  // The search fills the teacher and the student; the link needs its source.
  const lineagePath = new URL(page.url()).pathname;
  await page.goto(`${lineagePath}?q=${encodeURIComponent(tag)}#add-link`);
  const results = visible(page.getByTestId('archive-search-results'));
  await results.locator(`[data-record="${teacher}"]`).getByRole('link', { name: 'Use as teacher' }).click();
  await page.waitForURL(new RegExp(`teacher=${teacher}`));
  await visible(page.getByTestId('archive-search-results')).locator(`[data-record="${student}"]`).getByRole('link', { name: 'Use as student' }).click();
  await page.waitForURL(new RegExp(`student=${student}`));
  const linkForm = visible(page.getByTestId('link-add-form'));
  await expect(linkForm.getByLabel(/^Teacher/)).toHaveValue(teacher);
  await expect(linkForm.getByLabel(/^Student/)).toHaveValue(student);
  await linkForm.getByLabel(/^From \(year\)/).fill('1890');
  await linkForm.getByLabel(/^To \(year\)/).fill('1901');
  await linkForm.getByRole('button', { name: 'Add the link' }).click();
  // No source: refused, nothing written.
  await expect(visible(page.getByText('Write the source: where this training is recorded.')).first()).toBeVisible();
  const source = `A fictional chronicle ${tag}, page 7.`;
  await visible(page.getByTestId('link-add-form')).getByLabel(/^Source/).fill(source);
  await visible(page.getByTestId('link-add-form')).getByRole('button', { name: 'Add the link' }).click();
  await page.waitForURL(/[?&]done=linked/);
  await expect(visible(page.getByTestId('archive-outcome'))).toContainText('shown on the public pages');
  const links = visible(page.getByTestId('lineage-links'));
  await expect(links).toContainText('1890–1901');
  await expect(links).toContainText(source);
  await expect(visible(page.getByTestId('lineage-facts'))).toContainText('In the explorer');

  const rows = await getDb().execute<{ status: string; path: string; event: string | null }>(sql`
    SELECT r.status, r.verification_path AS path,
           (SELECT e.reason FROM relationship_event e WHERE e.relationship_id = r.id ORDER BY e.created_at LIMIT 1) AS event
      FROM teaching_relationship r
      JOIN person t ON t.id = r.teacher_person_id
      JOIN person s ON s.id = r.student_person_id
     WHERE t.slug = ${teacher} AND s.slug = ${student}`);
  expect(rows.rows).toEqual([{ status: 'verified', path: 'committee_review', event: 'archive' }]);

  // The teacher's public profile: the student is there, the source is not.
  const visitor = await browser.newContext({ baseURL: BASE_URL });
  const anonymous = await visitor.newPage();
  const response = await anonymous.goto(`/people/${teacher}`);
  expect(response?.status()).toBe(200);
  await expect(anonymous.locator('main')).toContainText(teacherName);
  expect(await anonymous.content()).not.toContain(source);

  // A moderator is told plainly that the editor is not theirs.
  const moderator = await signedIn(browser, 'moderator');
  await moderator.page.goto('/admin/archive');
  await expect(visible(moderator.page.getByTestId('archive-denied'))).toBeVisible();

  await Promise.all([context.close(), visitor.close(), moderator.context.close()]);
});
