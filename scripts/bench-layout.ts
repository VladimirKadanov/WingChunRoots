/**
 * pnpm bench:layout — measures the lineage layout module (M03, plan §4.11, §4.13) on the
 * synthetic graph and writes the tables to docs/perf/layout-bench.md (Bulgarian, like all
 * documentation).
 *
 *   pnpm bench:layout                      # writes docs/perf/layout-bench.md
 *   pnpm bench:layout --out <file.md>      # writes elsewhere (scripts/verify.d/M03.sh)
 *
 * Cold: a fresh Node process per run; the time from loading the layout module (and ELK) to
 * the end of the first layout, median of 3. Warm: after one small warm-up layout, median of
 * 5 layouts of the same view in one process.
 *
 * Runs under Node's type stripping (Node >= 22.12 with --experimental-strip-types, on by
 * default from 22.18), so every import of the module carries its .ts extension.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeRanks } from '../src/lib/lineage-layout/ranks.ts';
import { rowOrderFlips, positionsOf, ranksWithSeveralY, spineBends } from '../src/lib/lineage-layout/testing/checks.ts';
import { EGO_ANCHORS, anchorId, generateSyntheticLineage } from '../src/lib/lineage-layout/testing/synthetic.ts';
import { egoView, expandStudents, sharedAncestorView, standardViews } from '../src/lib/lineage-layout/testing/views.ts';
import type { LineageGraph, NodePlacement } from '../src/lib/lineage-layout/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const COLD_RUNS = 3;
const WARM_RUNS = 5;

const dataset = generateSyntheticLineage();
const views = standardViews(dataset);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const ms = (value: number) => `${Math.round(value)}`;

// --- Child mode: one cold layout ----------------------------------------------------------
const coldIndex = process.argv.indexOf('--cold');
if (coldIndex !== -1) {
  const name = process.argv[coldIndex + 1];
  const view = views.find((v) => v.name === name);
  if (!view) {
    console.error(`unknown view: ${name}`);
    process.exit(2);
  }
  const started = performance.now();
  const { layoutLineage } = await import('../src/lib/lineage-layout/layout.ts');
  await layoutLineage(view.graph);
  console.log(JSON.stringify({ ms: performance.now() - started }));
  process.exit(0);
}

// --- Parent mode ---------------------------------------------------------------------------
const outIndex = process.argv.indexOf('--out');
const outFile = path.resolve(root, outIndex !== -1 ? process.argv[outIndex + 1]! : 'docs/perf/layout-bench.md');

const { createElkEngine, layoutLineage, layoutLineageWithStats } = await import('../src/lib/lineage-layout/layout.ts');
const engine = createElkEngine();

function coldRun(name: string): number {
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--cold', name], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`cold run of ${name} failed:\n${result.stderr}`);
  const line = result.stdout.trim().split('\n').pop()!;
  return (JSON.parse(line) as { ms: number }).ms;
}

async function warm(graph: LineageGraph, nodePlacement?: NodePlacement): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < WARM_RUNS; i++) {
    times.push((await layoutLineageWithStats(graph, { nodePlacement }, engine)).stats.totalMs);
  }
  return median(times);
}

const log = (message: string) => process.stderr.write(`${message}\n`);

// Warm-up, as the explorer warms its worker on route load (plan §4.11).
await layoutLineage(egoView(dataset, anchorId(dataset, 'demo-converging')), {}, engine);

// Table 1: the views of the milestone.
const viewRows: string[] = [];
for (const view of views) {
  log(`view ${view.name}`);
  const ranks = computeRanks(view.graph);
  const cold = median(Array.from({ length: COLD_RUNS }, () => coldRun(view.name)));
  const warmNs = await warm(view.graph, 'NETWORK_SIMPLEX');
  const { scene, stats } = await layoutLineageWithStats(view.graph, {}, engine);
  const bk = await layoutLineage(view.graph, { nodePlacement: 'BRANDES_KOEPF' }, engine);
  const rowsOk = ranksWithSeveralY(scene).length === 0 && scene.rowY.length === ranks.rankCount;
  viewRows.push(
    `| \`${view.name}\` | ${stats.nodes} | ${stats.elkEdges} / ${stats.crossLineageEdges} | ${ranks.rankCount} | ` +
      `${ranks.cutOff.size} | ${rowsOk ? 'да' : '**НЕ**'} | ${ms(cold)} | ${ms(warmNs)} | ` +
      `${spineBends(scene)} / ${spineBends(bk)} | ${Math.round(scene.width)} × ${Math.round(scene.height)} |`,
  );
}

// Table 2: NETWORK_SIMPLEX against BRANDES_KOEPF on the ego view of every person.
const comparison: string[] = [];
for (const placement of ['NETWORK_SIMPLEX', 'BRANDES_KOEPF'] as const) {
  log(`all ego views, ${placement}`);
  let bentViews = 0;
  let bends = 0;
  let anchorBent = 0;
  let max = 0;
  const times: number[] = [];
  for (const node of dataset.graph.nodes) {
    const { scene, stats } = await layoutLineageWithStats(egoView(dataset, node.id), { nodePlacement: placement }, engine);
    const b = spineBends(scene);
    if (b > 0) bentViews++;
    bends += b;
    if (b > 0 && (EGO_ANCHORS as readonly string[]).includes(dataset.slugById[node.id]!)) anchorBent++;
    times.push(stats.totalMs);
    max = Math.max(max, stats.totalMs);
  }
  const v500 = views.find((v) => v.name === 'view-500')!;
  comparison.push(
    `| ${placement} | ${anchorBent} от ${EGO_ANCHORS.length} | ${bentViews} от ${dataset.graph.nodes.length} | ${bends} | ` +
      `${ms(median(times))} | ${ms(max)} | ${ms(await warm(v500.graph, placement))} |`,
  );
}

// Table 3: expanding a node with the expand preset (semiInteractive) against the explorer preset.
log('expansions');
const expansionCases: { base: LineageGraph; nodeId: string }[] = [
  { base: sharedAncestorView(dataset), nodeId: anchorId(dataset, 'demo-hub-a') },
];
for (const cap of [3, 6]) {
  dataset.graph.nodes.forEach((node, i) => {
    if (i % 5 !== 0) return;
    const base = egoView(dataset, node.id, cap);
    const target = [...base.nodes].reverse().find((n) => (base.hiddenCounts[n.id]?.students ?? 0) > 0);
    if (target) expansionCases.push({ base, nodeId: target.id });
  });
}
const totals = {
  expand: { pairs: 0, flips: 0, views: 0, rankMoves: 0 },
  explorer: { pairs: 0, flips: 0, views: 0, rankMoves: 0 },
};
for (const { base, nodeId } of expansionCases) {
  const before = await layoutLineage(base, {}, engine);
  const expanded = expandStudents(dataset, base, nodeId);
  for (const preset of ['expand', 'explorer'] as const) {
    const after = await layoutLineage(expanded, { preset, previousPositions: positionsOf(before) }, engine);
    const result = rowOrderFlips(before, after);
    totals[preset].pairs += result.pairs;
    totals[preset].flips += result.flips;
    totals[preset].rankMoves += result.rankMoves;
    if (result.flips > 0) totals[preset].views++;
  }
}

const elkVersion = (JSON.parse(readFileSync(path.join(root, 'node_modules/elkjs/package.json'), 'utf8')) as { version: string }).version;
const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
const generated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const markdown = `# Измерване на подредбата на родословието (M03)

<!-- generated by scripts/bench-layout.ts (pnpm bench:layout); do not edit by hand -->

Генерирано: ${generated} · Node ${process.versions.node} · elkjs ${elkVersion} · ${cpu} (${os.cpus().length} ядра) · ${os.platform()} ${os.arch()}

Данни: синтетичният граф от \`src/lib/lineage-layout/testing/synthetic.ts\` (seed ${dataset.seed}): ${dataset.graph.nodes.length} измислени души и ${dataset.graph.edges.length} връзки в 3 линии, с два хъба с по над 120 ученици. \`fixtures/lineage-600.json\` от M01 още не е в \`origin/main\`; измерването върху него прави M05.

Изгледите се извличат така, както ги връща API-то от план §6.3: его-изглед е „всички предци и 2 поколения ученици“, а \`lineage:demo-root-a\` е линия A с 3 поколения под корена и с учителите от друга линия (отрязани учители, план §4.4). \`around:demo-shared-ancestor\` е изгледът с двата корена на линии под общия предшественик и връзката от друга линия между клоновете им, а \`view-500\` е изглед от около 500 души под \`demo-shared-ancestor\`.

**Студена** подредба: нов процес на Node за всяко пускане; времето от зареждането на модула (и на ELK) до края на първата подредба, медиана от ${COLD_RUNS}. **Топла**: след една малка подредба за загряване, медиана от ${WARM_RUNS} подредби в същия процес. Времената са от облачен процесор и са ориентировъчни; на телефон от среден клас се очакват 2–4 пъти по-бавни (план §4.13).

## 1. Изгледите на етапа (избраният алгоритъм NETWORK_SIMPLEX)

| Изглед | Души | Връзки: в ELK / от друга линия | Редове (рангове) | Отрязани учители | Редове = рангове | Студена, ms | Топла, ms | Огъвания на гръбнака: NS / BK | Размер, px |
|---|---|---|---|---|---|---|---|---|---|
${viewRows.join('\n')}

„Редове = рангове“ значи, че всеки ранг е точно един ред на ELK с една y-координата (\`INTERACTIVE\` с псевдо y = rank × 200). Предпазните прагове от план §4.11 са его-изглед ≤ 1000 ms и изглед от 500 души ≤ 2500 ms (\`layout.perf.test.ts\`).

## 2. NETWORK_SIMPLEX срещу BRANDES_KOEPF (план §4.5)

Тестът е „гръбнакът на фокуса няма точки на огъване“ върху его-изгледа на всеки човек от данните (топли подредби, по едно пускане на изглед).

| Разполагане | Опорни его-изгледи с огънат гръбнак | Его-изгледи с огънат гръбнак | Точки на огъване по гръбнаците | Медиана, ms | Най-бавен его-изглед, ms | \`view-500\`, топла, ms |
|---|---|---|---|---|---|---|
${comparison.join('\n')}

## 3. Разгъване с набора \`expand\` (\`semiInteractive\` с предишните x)

${expansionCases.length} разгъвания: изгледът около \`demo-shared-ancestor\` с всички ученици на \`demo-hub-a\` и его-изгледите на всеки пети човек с 3 и с 6 ученици на учител, разгънати при последния възел със скрити ученици. Броят се двойките вече показани хора в един и същ ред, чийто ред отляво надясно се е обърнал.

| Набор | Двойки | Обърнати двойки | Изгледи с обърнат ред | Хора, сменили ранга си |
|---|---|---|---|---|
| \`expand\` (\`semiInteractive\`) | ${totals.expand.pairs} | ${totals.expand.flips} | ${totals.expand.views} | ${totals.expand.rankMoves} |
| \`explorer\` (без \`semiInteractive\`) | ${totals.explorer.pairs} | ${totals.explorer.flips} | ${totals.explorer.views} | ${totals.explorer.rankMoves} |

Смяна на ранга става само когато разгъването показва нов учител на вече видим човек: тогава той слиза по-надолу, за да остане \`rank(ученик) > rank(учител)\`.

## 4. Резервата d3-dag

Не е разглеждана: ELK запазва ранговете (таблица 1) и времената са в прага. Ако резервата от план §4.1 стане нужна, тя се измерва наново с точната конфигурация \`sugiyama().layering(layeringSimplex().rank(...)).decross(decrossDfs()).coord(coordGreedy())\`.
`;

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, markdown, 'utf8');
log(`wrote ${path.relative(root, outFile)}`);
process.stdout.write(markdown);
