/**
 * `fixtures/lineage-600.json` from M01 as a dataset for the view helpers of testing/views.ts
 * (M03, milestone items 1 and 6): the layout tests, the performance guards and
 * `pnpm bench:layout` run on it as well as on the synthetic graph.
 *
 * The file has the graph shape of plan §6.3 for the whole demo dataset, plus `anchors`
 * (anchor slug → person id) and `lineages` (`{ id, slug, … }`). Its people are fictional
 * (D20). Node-only (reads the file); used by tests and the benchmark, never by the module.
 */
import { readFileSync } from 'node:fs';
import type { LineageGraph } from '../types.ts';
import { EGO_ANCHORS, LINEAGES, type LineageDataset } from './synthetic.ts';

/** The fixture, relative to the repository root. */
export const LINEAGE_FIXTURE_PATH = 'fixtures/lineage-600.json';

/** The fixture's location (this file is src/lib/lineage-layout/testing/fixture.ts). */
export const LINEAGE_FIXTURE_URL = new URL(`../../../../${LINEAGE_FIXTURE_PATH}`, import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Turns the parsed fixture into a dataset. Throws when it lacks the plan §6.3 arrays, an
 * anchor of the standard views (all of them are ego anchors) or a lineage slug.
 */
export function datasetFromLineageFixture(json: unknown, source = LINEAGE_FIXTURE_PATH): LineageDataset {
  if (!isRecord(json) || !Array.isArray(json.nodes) || !Array.isArray(json.edges)) {
    throw new Error(`${source}: expected the plan §6.3 shape with the arrays nodes and edges`);
  }
  const anchors = isRecord(json.anchors) ? json.anchors : {};
  const idBySlug: Record<string, string> = {};
  const slugById: Record<string, string> = {};
  for (const [slug, id] of Object.entries(anchors)) {
    if (typeof id !== 'string') throw new Error(`${source}: anchor ${slug} has no person id`);
    idBySlug[slug] = id;
    slugById[id] = slug;
  }
  for (const slug of EGO_ANCHORS) {
    if (!Object.hasOwn(idBySlug, slug)) throw new Error(`${source}: anchor ${slug} is missing`);
  }
  const lineageIdBySlug: Record<string, string> = {};
  for (const lineage of Array.isArray(json.lineages) ? json.lineages : []) {
    if (isRecord(lineage) && typeof lineage.slug === 'string' && typeof lineage.id === 'string') {
      lineageIdBySlug[lineage.slug] = lineage.id;
    }
  }
  for (const slug of Object.values(LINEAGES)) {
    if (!Object.hasOwn(lineageIdBySlug, slug)) throw new Error(`${source}: lineage ${slug} is missing`);
  }
  const graph: LineageGraph = {
    focusId: null,
    dataVersion: typeof json.dataVersion === 'string' ? json.dataVersion : source,
    nodes: json.nodes as LineageGraph['nodes'],
    edges: json.edges as LineageGraph['edges'],
    hiddenCounts: {},
  };
  return { source, graph, slugById, idBySlug, lineageIdBySlug };
}

/** Reads `fixtures/lineage-600.json` (tracked in the repository since M01). */
export function loadLineageFixture(): LineageDataset {
  return datasetFromLineageFixture(JSON.parse(readFileSync(LINEAGE_FIXTURE_URL, 'utf8')));
}
