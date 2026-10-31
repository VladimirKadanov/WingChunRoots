/**
 * Asynchronous layout API (plan §4.1).
 *
 * Runs in the browser's Web Worker (layout.worker.ts), in Node background jobs (pg-boss or
 * worker_threads) and in tests — never in the request path of Next.js: a layout blocks the
 * event loop for about 0.3 s at 500 people (plan §4.13).
 *
 * ELK comes from `elkjs/lib/elk.bundled.js`, which runs the layout in the calling thread;
 * `elk-worker.min.js` is not used, so there is never a worker inside a worker.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkEngine, ElkNode } from 'elkjs/lib/elk.bundled.js';
import { convergingPass, deferredEdges, firstPassGraph } from './converging.ts';
import { buildElkGraph, type ElkGraphBuild } from './elk-graph.ts';
import { ElkLayoutError } from './errors.ts';
import { indexGraph, lineageBands, type GraphIndex } from './graph.ts';
import { computeRanksIndexed } from './ranks.ts';
import { buildScene, type LaidOutColumn } from './scene.ts';
import type { LayoutOptions, LayoutStats, LineageEdge, LineageGraph, RankResult, Scene } from './types.ts';

export type { ElkEngine };

let sharedEngine: ElkEngine | undefined;

/** Creates a new ELK engine that runs in the calling thread. */
export function createElkEngine(): ElkEngine {
  return new ELK();
}

/** The engine shared by every call of this module instance (created on first use). */
export function sharedElkEngine(): ElkEngine {
  sharedEngine ??= createElkEngine();
  return sharedEngine;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

async function runElk(engine: ElkEngine, graph: ElkNode): Promise<ElkNode> {
  try {
    return await engine.layout(graph);
  } catch (error) {
    throw new ElkLayoutError(error instanceof Error ? error.message : String(error));
  }
}

/** One ELK graph laid out: one pass, or three for a student with several teachers in one lineage. */
async function layOut(
  engine: ElkEngine,
  index: GraphIndex,
  ranks: RankResult,
  build: ElkGraphBuild,
): Promise<{ laidOut: ElkNode; elkMs: number; unplaced: string[] }> {
  const deferred = deferredEdges(index, build);
  let elkStarted = now();
  if (deferred.size === 0) {
    const laidOut = await runElk(engine, build.elkGraph);
    return { laidOut, elkMs: now() - elkStarted, unplaced: [] };
  }
  const firstPass = await runElk(engine, firstPassGraph(build, deferred));
  let elkMs = now() - elkStarted;
  const pass = convergingPass(index, ranks, build, deferred, firstPass);
  elkStarted = now();
  const laidOut = pass.merge(await runElk(engine, pass.elkGraph));
  elkMs += now() - elkStarted;
  return { laidOut, elkMs, unplaced: pass.unplaced };
}

/**
 * Lays out a lineage view: ranks → ELK graph → scene. Returns the scene and timings.
 *
 * A view with people of two or more lineages is laid out one lineage column at a time
 * (`lineageBands`): each column is an ELK graph of its people and of the edges between them,
 * with the ranks of the whole view, and the scene puts the columns side by side with every row
 * at one height (plan §4.6, the Ink Lineage direction). An edge between two columns is drawn as
 * a Bézier curve, like an edge to a teacher from another lineage.
 *
 * A column with a student who has several teachers in one lineage takes two ELK passes and a
 * placement step in between, so that the student stands between them (plan §4.6,
 * converging.ts).
 *
 * Rejects with `LineageCycleError` (code `CYCLE`) for a cycle, `LineageInputError`
 * (`INVALID_INPUT`) for a malformed graph and `ElkLayoutError` (`ELK_FAILED`) when ELK
 * fails.
 */
export async function layoutLineageWithStats(
  graph: LineageGraph,
  options: LayoutOptions = {},
  engine: ElkEngine = sharedElkEngine(),
): Promise<{ scene: Scene; stats: LayoutStats }> {
  const started = now();
  const index = indexGraph(graph);
  const ranks = computeRanksIndexed(index);
  const view = buildElkGraph(index, ranks, options);
  // The spine of the view, from the focus upwards: it stays in one column (lineageBands).
  const spineNodes = view.focusId && index.nodes.has(view.focusId) ? [view.focusId, ...view.spine.map((e) => e.teacherId)] : [];
  const { keys, bandOf } = lineageBands(index, spineNodes);
  const columns: LaidOutColumn[] = [];
  let elkMs = 0;
  let elkEdges = 0;
  const unplacedStudents: string[] = [];
  let curves: LineageEdge[];
  if (keys.length <= 1) {
    const done = await layOut(engine, index, ranks, view);
    columns.push({ key: keys[0] ?? '', build: view, laidOut: done.laidOut });
    elkMs = done.elkMs;
    elkEdges = view.elkEdges.length;
    unplacedStudents.push(...done.unplaced);
    curves = view.crossLineageEdges;
  } else {
    const routed = new Set<string>();
    const unplaced = new Set<string>();
    for (const key of keys) {
      const people = new Set(graph.nodes.filter((n) => bandOf.get(n.id) === key).map((n) => n.id));
      const columnGraph: LineageGraph = {
        ...graph,
        focusId: spineNodes.length > 0 && people.has(spineNodes[0]!) ? spineNodes[0]! : null,
        nodes: graph.nodes.filter((n) => people.has(n.id)),
        edges: graph.edges.filter((e) => e.kind !== 'crossLineage' && people.has(e.teacherId) && people.has(e.studentId)),
      };
      const columnIndex = indexGraph(columnGraph);
      const spine = view.spine.filter((e) => people.has(e.teacherId) && people.has(e.studentId));
      const build = buildElkGraph(columnIndex, ranks, { ...options, focusId: columnGraph.focusId }, spine);
      const done = await layOut(engine, columnIndex, ranks, build);
      columns.push({ key, build, laidOut: done.laidOut });
      elkMs += done.elkMs;
      elkEdges += build.elkEdges.length;
      for (const edge of build.elkEdges) routed.add(edge.id);
      for (const id of done.unplaced) unplaced.add(id);
    }
    unplacedStudents.push(...view.order.filter((id) => unplaced.has(id)));
    const position = new Map(view.order.map((id, i) => [id, i]));
    curves = graph.edges
      .filter((e) => !routed.has(e.id))
      .sort(
        (a, b) =>
          position.get(a.teacherId)! - position.get(b.teacherId)! ||
          position.get(a.studentId)! - position.get(b.studentId)! ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }
  const scene = buildScene(graph, ranks, view, columns, curves);
  return {
    scene,
    stats: {
      totalMs: now() - started,
      elkMs,
      nodes: scene.nodes.length,
      elkEdges,
      crossLineageEdges: curves.length,
      unplacedStudents,
    },
  };
}

/** Lays out a lineage view and returns only the scene (see `layoutLineageWithStats`). */
export async function layoutLineage(
  graph: LineageGraph,
  options: LayoutOptions = {},
  engine: ElkEngine = sharedElkEngine(),
): Promise<Scene> {
  return (await layoutLineageWithStats(graph, options, engine)).scene;
}
