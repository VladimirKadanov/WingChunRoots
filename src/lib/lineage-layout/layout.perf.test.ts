/**
 * Regression guards from plan §4.11 (D24): every ego view of the data ≤ 1000 ms and a view of
 * about 500 people ≤ 2500 ms in Node. They guard against regressions; they are not the
 * targets (those are measured on devices in M06). The thresholds are never relaxed to let an
 * algorithm pass (docs/plan/M03-lineage-layout.md, Constraints).
 *
 * DEFAULT D24: the engine is warmed with one small layout first, as the explorer warms its
 * worker on route load (plan §4.11); every view is then measured on its first layout. Cold
 * starts in a fresh process are measured by `pnpm bench:layout` (docs/perf/layout-bench.md).
 */
import { describe, expect, it } from 'vitest';
import { createElkEngine, layoutLineageWithStats } from './layout.ts';
import { EGO_ANCHORS, anchorId, generateSyntheticLineage } from './testing/synthetic.ts';
import { egoView, standardViews } from './testing/views.ts';

const EGO_VIEW_BUDGET_MS = 1000;
const VIEW_500_BUDGET_MS = 2500;

const dataset = generateSyntheticLineage();
const engine = createElkEngine();

async function warmUp() {
  await layoutLineageWithStats(egoView(dataset, anchorId(dataset, 'demo-converging')), {}, engine);
}

describe('layout performance guards (plan §4.11)', () => {
  it(`lays out the ego view of every person in the data in ≤ ${EGO_VIEW_BUDGET_MS} ms`, async () => {
    await warmUp();
    const slow: string[] = [];
    let worst = { ms: 0, slug: '', nodes: 0 };
    for (const node of dataset.graph.nodes) {
      const { stats } = await layoutLineageWithStats(egoView(dataset, node.id), {}, engine);
      if (stats.totalMs > worst.ms) worst = { ms: stats.totalMs, slug: dataset.slugById[node.id]!, nodes: stats.nodes };
      if (stats.totalMs > EGO_VIEW_BUDGET_MS) slow.push(`${dataset.slugById[node.id]}: ${stats.totalMs.toFixed(0)} ms`);
    }
    console.info(`slowest ego view: ${worst.slug}, ${worst.nodes} people, ${worst.ms.toFixed(0)} ms`);
    expect(slow).toEqual([]);
    expect(dataset.graph.nodes.length).toBeGreaterThanOrEqual(550);
    for (const slug of EGO_ANCHORS) expect(dataset.idBySlug[slug]).toBeDefined();
  }, 300_000);

  it(`lays out a view of about 500 people in ≤ ${VIEW_500_BUDGET_MS} ms`, async () => {
    await warmUp();
    const view = standardViews(dataset).find((v) => v.name === 'view-500')!;
    expect(view.graph.nodes.length).toBeGreaterThanOrEqual(480);
    expect(view.graph.nodes.length).toBeLessThanOrEqual(520);
    const { stats } = await layoutLineageWithStats(view.graph, {}, engine);
    console.info(`view of ${stats.nodes} people: ${stats.totalMs.toFixed(0)} ms (ELK ${stats.elkMs.toFixed(0)} ms)`);
    expect(stats.totalMs).toBeLessThanOrEqual(VIEW_500_BUDGET_MS);
  }, 120_000);
});
