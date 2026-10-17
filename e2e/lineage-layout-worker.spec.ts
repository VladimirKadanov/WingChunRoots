/**
 * src/lib/lineage-layout/layout.worker.ts in a real browser Web Worker (M03, plan §4.1).
 *
 * The unit tests run the worker entry point in Node with a simulated `self`
 * (layout.worker.test.ts). This test runs it where it really lives: a module worker in
 * Chromium (and WebKit in CI), with `elkjs/lib/elk.bundled.js` evaluated inside the worker,
 * so a worker-only failure of ELK fails here (ELK takes another branch when `document` is
 * missing and `self` exists).
 *
 * There is no page for the explorer before M05, so a small local server serves a blank page,
 * the module files transpiled by TypeScript (types removed, nothing bundled), and
 * elk.bundled.js wrapped as an ES module with CommonJS semantics, as a bundler would load it.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as ts from 'typescript';

const MODULE_DIR = path.resolve('src/lib/lineage-layout');
const ELK_BUNDLED = path.resolve('node_modules/elkjs/lib/elk.bundled.js');
const ELK_URL = '/vendor/elk.bundled.js';

/** A module file as browser JavaScript: types removed, the elkjs import pointed at ELK_URL. */
function moduleFile(name: string): string | undefined {
  if (!/^[a-z-]+(\.worker)?\.ts$/.test(name) || name.endsWith('.test.ts')) return undefined;
  const file = path.join(MODULE_DIR, name);
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return outputText.replace(/(['"])elkjs\/lib\/elk\.bundled\.js\1/g, `'${ELK_URL}'`);
}

/**
 * elk.bundled.js is a CommonJS (UMD) bundle. It runs in sloppy mode inside a function with its
 * own `module` and `exports`, as webpack and Turbopack run CommonJS modules, and its export
 * becomes the default export.
 */
function elkModule(): string {
  const source = readFileSync(ELK_BUNDLED, 'utf8');
  return [
    'const module = { exports: {} };',
    `new Function('module', 'exports', ${JSON.stringify(source)}).call(globalThis, module, module.exports);`,
    'export default module.exports;',
    '',
  ].join('\n');
}

let server: Server;
let origin: string;

test.beforeAll(async () => {
  const elk = elkModule();
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let body: string | undefined;
    let type = 'text/javascript; charset=utf-8';
    if (url.pathname === '/') {
      body = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Layout worker</title></html>';
      type = 'text/html; charset=utf-8';
    } else if (url.pathname === ELK_URL) {
      body = elk;
    } else if (url.pathname.startsWith('/src/lib/lineage-layout/')) {
      body = moduleFile(url.pathname.slice('/src/lib/lineage-layout/'.length));
    }
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Small fictional graphs in the shape of plan §6.3 (demo data only, D20). */
function demoGraph(ids: string[], edges: [teacher: string, student: string, kind: string][]) {
  return {
    focusId: ids[ids.length - 1],
    dataVersion: 'demo-e2e',
    nodes: ids.map((id) => ({
      id,
      displayName: `Demo ${id}`,
      altNames: [],
      lifeStatus: 'living',
      claimState: 'claimed',
      lineageIds: ['demo-lineage-x'],
      childCount: 0,
      hasMoreChildren: false,
    })),
    edges: edges.map(([teacherId, studentId, kind], i) => ({
      id: `demo-edge-${i + 1}`,
      teacherId,
      studentId,
      lineageId: kind === 'crossLineage' ? 'demo-lineage-y' : 'demo-lineage-x',
      kind,
      status: 'verified',
      isDisplayPrimary: kind === 'primary',
      visibility: 'public',
      periods: [{ from: '2001', to: null, ongoing: true, precision: 'year' }],
    })),
    hiddenCounts: {},
  };
}

test('@M03 layout.worker.ts lays out a view in a real module Web Worker', async ({ page }) => {
  test.setTimeout(60_000);
  const small = demoGraph(
    ['demo-r', 'demo-a', 'demo-b'],
    [
      ['demo-r', 'demo-a', 'primary'],
      ['demo-a', 'demo-b', 'primary'],
    ],
  );
  const cyclic = demoGraph(
    ['demo-a', 'demo-b'],
    [
      ['demo-a', 'demo-b', 'primary'],
      ['demo-b', 'demo-a', 'crossLineage'],
    ],
  );

  await page.goto(`${origin}/`);
  const outcome = await page.evaluate(
    async ({ small, cyclic }) => {
      const worker = new Worker('/src/lib/lineage-layout/layout.worker.ts', { type: 'module' });
      const answers: { type: string; requestId: number; [key: string]: unknown }[] = [];
      const errors: string[] = [];
      worker.addEventListener('error', (event) => errors.push(event.message || 'worker error event'));
      worker.addEventListener('messageerror', () => errors.push('messageerror'));
      worker.addEventListener('message', (event) => answers.push(event.data));
      const waitFor = async (count: number) => {
        const deadline = Date.now() + 30_000;
        while (answers.length < count && errors.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      // Two requests at once: the older one is stale, the newer one is laid out.
      worker.postMessage({ type: 'layout', requestId: 1, graph: small });
      worker.postMessage({ type: 'layout', requestId: 2, graph: small });
      await waitFor(2);
      worker.postMessage({ type: 'layout', requestId: 3, graph: cyclic });
      await waitFor(3);
      worker.terminate();
      return { answers, errors };
    },
    { small, cyclic },
  );

  expect(outcome.errors).toEqual([]);
  expect(outcome.answers.map((a) => [a.type, a.requestId])).toEqual([
    ['stale', 1],
    ['result', 2],
    ['error', 3],
  ]);
  const result = outcome.answers[1] as unknown as {
    scene: { nodes: { id: string; rank: number; y: number }[]; edges: { routedBy: string }[] };
  };
  const rank = Object.fromEntries(result.scene.nodes.map((n) => [n.id, n.rank]));
  expect(rank).toEqual({ 'demo-r': 0, 'demo-a': 1, 'demo-b': 2 });
  const y = Object.fromEntries(result.scene.nodes.map((n) => [n.id, n.y]));
  expect(y['demo-a']!).toBeGreaterThan(y['demo-r']!);
  expect(y['demo-b']!).toBeGreaterThan(y['demo-a']!);
  expect(result.scene.edges.map((e) => e.routedBy)).toEqual(['elk', 'elk']);
  expect(outcome.answers[2]).toMatchObject({ type: 'error', requestId: 3, error: { code: 'CYCLE' } });
});
