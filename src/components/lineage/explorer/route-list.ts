// The routes of descent the panel lists for a selection (plan §4.7; milestone M06, package B): from
// the people at the top of the view down to the selected person, along the drawn lines routes.ts
// found (display-primary first: DEFAULT D05). In the panel's chunk, not the explorer's first JavaScript.

import type { LineageGraphDto } from '@/server/dto/public';

import type { Line, RouteSource } from './routes';

/** One route of descent: the people, root first and the selected person last, and the edges between them. */
export interface Route {
  people: readonly string[];
  edges: readonly string[];
}

/** The routes the panel lists (at most MAX_ROUTES) and how many the view has. */
export interface RouteList {
  shown: readonly Route[];
  total: number;
}

/** DEFAULT D05: the panel lists at most 5 routes, display-primary first; "N more routes" opens the list view. */
export const MAX_ROUTES = 5;

/** The route search's steps: a view is bounded (about 500 people), and so is the search through it. */
const SEARCH_STEPS = 20_000;

export const NO_ROUTES: RouteList = { shown: [], total: 0 };

/**
 * The drawn lines into each person, DEFAULT D05: the display-primary teacher's line first, then the
 * primary ones, then the answer's order.
 */
function ordered(up: RouteSource['up'], graph: LineageGraphDto): Map<string, readonly Line[]> {
  const count = graph.edges.length;
  const order = new Map(graph.edges.map((e, i) => [e.id, (e.isDisplayPrimary ? 0 : e.kind === 'primary' ? 1 : 2) * count + i]));
  const rank = (line: Line) => order.get(line.id) ?? 3 * count;
  return new Map([...up].map(([person, lines]) => [person, [...lines].sort((a, b) => rank(a) - rank(b))]));
}

/**
 * The routes to the selected person from the people at the top of the view, as M04's searchRoutes
 * finds them: first one route through each of the person's own teachers, then the rest depth-first,
 * until MAX_ROUTES. `total` counts every route of the view (0 when no teacher of the person is drawn).
 */
export function routeList(source: RouteSource | null, graph: LineageGraphDto): RouteList {
  if (source === null) return NO_ROUTES;
  const { person } = source;
  const up = ordered(source.up, graph);
  const shown: Route[] = [];
  const found = new Set<string>();
  let steps = 0;
  const search = (first: { id: string; teacher: string } | null, want: number) => {
    const people = [person];
    const edges: string[] = [];
    // One frame per person on the current route: the index of the next line up to try.
    const next = [0];
    let added = 0;
    while (people.length > 0 && shown.length < MAX_ROUTES && steps < SEARCH_STEPS) {
      steps += 1;
      const top = people.length - 1;
      const lines = top === 0 && first ? [first] : (up.get(people[top]!) ?? []);
      if (lines.length === 0) {
        const key = edges.join(' ');
        if (top > 0 && !found.has(key)) {
          found.add(key);
          shown.push({ people: people.slice().reverse(), edges: edges.slice().reverse() });
          added += 1;
          if (added >= want) return;
        }
      } else if (next[top]! < lines.length) {
        const line = lines[next[top]!]!;
        next[top] = next[top]! + 1;
        if (!people.includes(line.teacher)) {
          people.push(line.teacher);
          edges.push(line.id);
          next.push(0);
        }
        continue;
      }
      // Every line up from here tried (or a top reached): step back down.
      people.pop();
      edges.pop();
      next.pop();
    }
  };
  for (const line of up.get(person) ?? []) search(line, 1);
  search(null, Number.POSITIVE_INFINITY);

  // Routes from each person to the top, counted once per person (0 while counting it: a cycle ends no route).
  const counted = new Map<string, number>();
  const count = (id: string): number => {
    const known = counted.get(id);
    if (known !== undefined) return known;
    counted.set(id, 0);
    const lines = up.get(id) ?? [];
    const n = lines.length === 0 ? 1 : lines.reduce((sum, line) => sum + count(line.teacher), 0);
    counted.set(id, n);
    return n;
  };
  const total = up.has(person) ? count(person) : 0;
  return { shown, total: Math.max(total, shown.length) };
}
