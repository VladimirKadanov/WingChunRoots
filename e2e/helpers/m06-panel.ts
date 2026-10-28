// Selection steps for the M06 selection tests (milestone M06, package B): the edges the canvas
// draws, the routes of descent up those edges to a person (read from the drawing itself, never
// written into the test), what a selection lights, M04's routes of descent of the record
// (GET /api/v1/lineage/paths), and whether a point of an element can be tapped.

import { expect, type Locator, type Page } from '@playwright/test';

import type { LineagePathsDto } from '../../src/server/dto/public';

/** An edge the canvas draws: its id, the teacher and the student. */
export interface DrawnEdge {
  id: string;
  teacher: string;
  student: string;
}

/** A route of descent: the people, root first and the person last, and the edges between them. */
export interface DrawnRoute {
  people: string[];
  edges: string[];
}

/** The edges React Flow draws now (onlyRenderVisibleElements: those on the pane), one per id. */
export async function drawnEdges(page: Page): Promise<DrawnEdge[]> {
  const edges = await page.locator('[data-edge]').evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-edge')!, teacher: el.getAttribute('data-teacher')!, student: el.getAttribute('data-student')! })),
  );
  return [...new Map(edges.map((e) => [e.id, e])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Every route up the drawn edges to `person`, from a person with no drawn teacher (none for a person with no drawn teacher). */
export function routesUp(edges: readonly DrawnEdge[], person: string): DrawnRoute[] {
  const routes: DrawnRoute[] = [];
  const walk = (people: string[], via: string[]) => {
    const top = people[0]!;
    const up = edges.filter((e) => e.student === top);
    if (up.length === 0) {
      if (via.length > 0) routes.push({ people, edges: via });
      return;
    }
    // A teacher already on the route closes a loop, which ends no route.
    for (const e of up) if (!people.includes(e.teacher)) walk([e.teacher, ...people], [e.id, ...via]);
  };
  walk([person], []);
  return routes;
}

/** The ids of the person nodes and the edges drawn lit (`data-lit`), sorted. */
export async function litIds(page: Page): Promise<{ nodes: string[]; edges: string[] }> {
  return page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .filter((el) => el.querySelector('[data-person-node][data-lit]'))
      .map((el) => el.dataset.id!)
      .sort(),
    edges: [...new Set([...document.querySelectorAll('[data-edge][data-lit]')].map((el) => el.getAttribute('data-edge')!))].sort(),
  }));
}

/** M04's routes of descent of a person in the public record (GET /api/v1/lineage/paths). */
export async function recordPaths(page: Page, focusId: string): Promise<LineagePathsDto> {
  const response = await page.request.get(`/api/v1/lineage/paths?focusId=${focusId}&limit=50`);
  expect(response.status(), `GET /api/v1/lineage/paths for ${focusId}`).toBe(200);
  return (await response.json()) as LineagePathsDto;
}

/** Whether a tap at the centre of the element lands on it: on screen, not clipped away and covered by nothing. */
export function tappableAtCentre(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (box.width === 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && el.contains(hit);
  });
}

/** The URL's search parameters, without the hash. */
export function searchOf(page: Page): Record<string, string> {
  return Object.fromEntries(new URL(page.url()).searchParams);
}
