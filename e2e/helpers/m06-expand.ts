// Steps of the M06 expansion tests (milestone M06, package C): the API's counts and pages of a
// teacher's students, the layout worker's scenes (captureScenes), the summary node "and N more",
// a node's place on screen, and the students list in the panel.

import { expect, type Locator, type Page } from '@playwright/test';

import type { CapturedScene } from './explorer-checks';
import { nodeOf } from './explorer';

/** The summary node "and N more" of a teacher (state.ts summaryIdOf). */
export const summaryNodeOf = (page: Page, teacherId: string): Locator => nodeOf(page, `more:${teacherId}`);

/** A person's public students, as people.get counts them (the API; every public student, ended training included). */
export async function publicStudentCount(page: Page, slug: string): Promise<number> {
  const response = await page.request.get(`/api/v1/people/${slug}`);
  expect(response.status(), `GET /api/v1/people/${slug}`).toBe(200);
  return ((await response.json()) as { counts: { students: number } }).counts.students;
}

/** The names on one page of a teacher's students, by name (people.students over the API), as the panel lists them. */
export async function studentNamesOfPage(page: Page, slug: string, number: number, pageSize: number): Promise<string[]> {
  const response = await page.request.get(`/api/v1/people/${slug}/students?page=${number}&pageSize=${pageSize}&order=name`);
  expect(response.status(), `GET /api/v1/people/${slug}/students`).toBe(200);
  const body = (await response.json()) as { active: { person: { displayName: string } }[]; historical: { person: { displayName: string } }[] };
  return [...body.active, ...body.historical].map((s) => s.person.displayName);
}

/** Every scene the layout worker answered with for `focusId`, oldest first (captureScenes, before the page loads). */
export function scenesFor(page: Page, focusId: string): Promise<CapturedScene[]> {
  return page.evaluate((id) => ((window as unknown as { __scenes: CapturedScene[] }).__scenes ?? []).filter((s) => s.focusId === id), focusId);
}

/** The students of `teacherId` a scene draws: people, not the summary node. */
export function drawnStudents(scene: CapturedScene, teacherId: string): Set<string> {
  return new Set(scene.edges.filter((e) => e.teacherId === teacherId && !e.studentId.startsWith('more:')).map((e) => e.studentId));
}

/** A node's box on screen, or null when React Flow does not draw it. */
export function screenBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((nodeId) => {
    const r = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, id);
}

/** The panel's list of a teacher's students on page `number`: each row's name and profile address, in order. */
export async function listedStudents(page: Page, teacherName: string, number: number): Promise<{ name: string; href: string }[]> {
  const list = page.getByTestId('explorer-panel').getByRole('list', { name: `Students of ${teacherName}, page ${number}`, exact: true });
  await expect(list).toBeVisible();
  // Each row: the profile link (the name), then "Explore from here".
  return list.getByRole('listitem').evaluateAll((rows) =>
    rows.map((row) => {
      const link = row.querySelector<HTMLAnchorElement>('a[href^="/people/"]');
      return { name: (link?.textContent ?? '').trim(), href: link?.getAttribute('href') ?? '' };
    }),
  );
}
