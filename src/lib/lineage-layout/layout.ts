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
import { buildElkGraph } from './elk-graph.ts';
import { ElkLayoutError } from './errors.ts';
import { indexGraph } from './graph.ts';
import { computeRanksIndexed } from './ranks.ts';
import { buildScene } from './scene.ts';
import type { LayoutOptions, LayoutStats, LineageGraph, Scene } from './types.ts';

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

/**
 * Lays out a lineage view: ranks → ELK graph → scene. Returns the scene and timings.
 *
 * A view with a student who has several teachers in one lineage takes two ELK passes and a
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
  const build = buildElkGraph(index, ranks, options);
  const deferred = deferredEdges(index, build);
  let elkStarted = now();
  let laidOut: ElkNode;
  let elkMs: number;
  let unplacedStudents: string[] = [];
  if (deferred.size === 0) {
    laidOut = await runElk(engine, build.elkGraph);
    elkMs = now() - elkStarted;
  } else {
    const firstPass = await runElk(engine, firstPassGraph(build, deferred));
    elkMs = now() - elkStarted;
    const pass = convergingPass(index, ranks, build, deferred, firstPass);
    unplacedStudents = pass.unplaced;
    elkStarted = now();
    laidOut = pass.merge(await runElk(engine, pass.elkGraph));
    elkMs += now() - elkStarted;
  }
  const scene = buildScene(graph, ranks, build, laidOut);
  return {
    scene,
    stats: {
      totalMs: now() - started,
      elkMs,
      nodes: scene.nodes.length,
      elkEdges: build.elkEdges.length,
      crossLineageEdges: build.crossLineageEdges.length,
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
