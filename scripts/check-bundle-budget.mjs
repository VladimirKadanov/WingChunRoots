#!/usr/bin/env node
// scripts/check-bundle-budget.mjs [--dir .next] [--json <file>]
//
// The JavaScript budget per route (plan §5.8 (c), M00b): after `next build`, the JavaScript a
// browser loads to show each page of the App Router, gzip-compressed, must stay within the
// route's budget (170 kB by default; the explorer and the map get their own in M05 and M11).
//
// "Initially loaded" = the root main files of the build manifest (the runtime and the router)
// plus the chunks of every client entry in the route's client reference manifest (layouts,
// templates, loading, error and not-found boundaries, the page). Only the built-in global error
// page's own chunks and the nomodule polyfills that modern browsers skip are not counted. For every prerendered
// route the script also reads what the build prerendered (the HTML shell, the postponed state of a
// partial prerender and its RSC payload) and fails when a script named there is missing from that
// set, so a change in Next.js's manifests cannot shrink the count unnoticed. A route whose shell is
// empty (everything renders per request) is cross-checked against its postponed state and RSC
// payload only, and the output says how many scripts were cross-checked, never "checked" for nothing.
//
// The libraries that load only in a Web Worker (ELK, in the explorer's layout worker: plan §4.11,
// M05) are in no count; the script checks that on the built chunks too: the chunks that carry the
// library are named only by a worker's chunk list, never by a page or by anything a page loads.
//
// The libraries that load only after a page, with next/dynamic (MapLibre, in the school map's
// islands: milestone M11), are in no count either; the script checks that no page loads a chunk
// that carries them with its first JavaScript.
//
// 1 kB = 1000 bytes; gzip at the zlib default level, as a server would send it.
//
// DEFAULT D24: the budgets of plan §5.8 until the owner confirms the performance targets.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

export const KB = 1000;
export const DEFAULT_BUDGET = 170 * KB;

/**
 * Routes with their own budget (plan §5.8 (c): 170 kB is the budget of content routes; the
 * explorer gets its own in M05 and the map in M11).
 */
export const ROUTE_BUDGETS = {
  // The owner's decision of 2026-10-25 (docs/plan/questions/M07.md, question 3; ADR 0006): the
  // signed-in, noindex profile editor (M07) loads TanStack Form, which M07 In scope 1 and plan
  // §5.6 require (about 25 kB gzip on top of the shell and router that every route loads).
  '/dashboard/profile': 195 * KB,
  // M00b (ADR 0006): the noindex style guide for developers and the design review renders every
  // overlay component (dialog, sheets, menu, toast, tabs) at once on one page. 250 kB from M00b;
  // 260 kB by the owner's decision of 2026-10-25 (docs/plan/questions/M07.md, question 3;
  // ADR 0006), since M07's search palette shares Base UI's dialog and floating modules with it.
  '/styleguide': 260 * KB,
  // M05, ADR 0009: the explorer's client island loads TanStack Query, the oRPC client and nuqs
  // with the page (195.0 kB measured with M07's search field in the shell); React Flow (60 kB)
  // loads after it with next/dynamic and ELK (434 kB) only in the layout worker, so neither is in
  // this count.
  '/explore': 200 * KB,
  // M11, ADR 0013: the school finder (159.6 kB measured: the shell, the router, the finder island
  // with the list); MapLibre (about 286 kB) and the bottom sheet load after it with next/dynamic,
  // so neither is in this count (LAZY_ONLY below checks that). The default budget, named here so
  // that a change to the default cannot move it unnoticed.
  '/schools': 170 * KB,
};

/**
 * The client entry that loads only when its state renders: Next.js's built-in global error page.
 * The not-found, forbidden and unauthorized boundaries are in the tree of every page and load with
 * it (the HTML check below found that), and so does an app's own src/app/global-error.tsx (M04:
 * the prerendered pages load its chunks), so those are counted.
 */
const ON_DEMAND_ENTRY = /\/builtin\/global-error$/;

export function budgetFor(route) {
  return ROUTE_BUDGETS[route] ?? DEFAULT_BUDGET;
}

/**
 * `/page` -> `/`, `/legal/licenses/page` -> `/legal/licenses`; null for route handlers. Route groups
 * are not part of the URL, so they are dropped (`/dashboard/teachers/(list)/page` ->
 * `/dashboard/teachers`): the budget and the prerendered output are the URL's (M09).
 */
export function routeOfEntry(entry) {
  if (!entry.endsWith('/page')) return null;
  return entry.slice(0, -'/page'.length).replace(/\/\([^/)]+\)(?=\/|$)/g, '') || '/';
}

/** Evaluates a `*_client-reference-manifest.js` file and returns the manifest of `entry`. */
export function readClientManifest(file, entry) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 5000 });
  const manifest = sandbox.__RSC_MANIFEST?.[entry];
  if (!manifest?.entryJSFiles) throw new Error(`${file}: no entryJSFiles for ${entry}`);
  return manifest;
}

/** The chunks a route loads initially: root main files and its client entries' chunks. */
export function initialChunks(rootMainFiles, entryJSFiles) {
  const files = new Set(rootMainFiles);
  for (const [entry, chunks] of Object.entries(entryJSFiles)) {
    if (ON_DEMAND_ENTRY.test(entry)) continue;
    for (const chunk of chunks) files.add(chunk);
  }
  return [...files].map((file) => file.replace(/^\/?(_next\/)?/, '')).sort();
}

/** `<script src>` paths of an HTML document, relative to .next, without nomodule scripts. */
export function htmlScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/g)) {
    const attrs = match[1];
    if (/\bnomodule\b/i.test(attrs)) continue;
    const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
    if (!src) continue;
    const pathname = new URL(src, 'http://localhost').pathname;
    if (pathname.startsWith('/_next/')) scripts.push(pathname.slice('/_next/'.length));
  }
  return scripts;
}

/**
 * Every `static/….js` path a text names, with or without the `/_next/` prefix, relative to .next
 * (an RSC payload, a postponed state, a chunk's chunk lists).
 */
export function chunkPaths(text) {
  const paths = new Set();
  for (const match of text.matchAll(/(?:\/_next\/)?(static\/[\w.~/-]+?\.js)(?![\w.~/-])/g)) paths.add(match[1]);
  return [...paths];
}

/** Every file below `dir`, or none when it does not exist. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory() ? filesUnder(file) : [file];
    });
}

/**
 * The scripts a route's prerendered output loads, by where they are named: the `<script src>` of
 * its HTML shell (an empty shell names none), the bootstrap scripts and chunks of a partial
 * prerender's postponed state (`<route>.meta`) and the chunks its prerendered RSC payload names
 * (`<route>.rsc`, `<route>.segments/`). The nomodule polyfills are left out (modern browsers
 * skip them). Only sources that name a script are listed.
 */
export function prerenderedScripts(dir, route, polyfills = []) {
  const base = path.join(dir, 'server/app', route === '/' ? 'index' : route.slice(1));
  const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const skip = new Set(polyfills.map((file) => file.replace(/^\/?(_next\/)?/, '')));
  const sources = [];
  const add = (from, scripts) => {
    const named = [...new Set(scripts)].filter((script) => !skip.has(script));
    if (named.length > 0) sources.push({ from, scripts: named });
  };
  add('the HTML', htmlScripts(read(`${base}.html`)));
  const meta = read(`${base}.meta`);
  const postponed = meta ? JSON.parse(meta).postponed : undefined;
  if (typeof postponed === 'string') add('the postponed state', chunkPaths(postponed));
  const rsc = [`${base}.rsc`, ...filesUnder(`${base}.segments`)].map(read).join('\n');
  add('the RSC payload', chunkPaths(rsc));
  return sources;
}

export function checkBudgets(dir) {
  const buildManifest = JSON.parse(readFileSync(path.join(dir, 'build-manifest.json'), 'utf8'));
  const routes = JSON.parse(readFileSync(path.join(dir, 'app-path-routes-manifest.json'), 'utf8'));
  const gzipped = new Map();
  const gzipSize = (file) => {
    if (!gzipped.has(file)) gzipped.set(file, gzipSync(readFileSync(path.join(dir, file))).length);
    return gzipped.get(file);
  };

  const results = [];
  const errors = [];
  // Everything a page can load on the main thread, for checkWorkerOnly: the root main files, the
  // polyfills and every client entry's chunks (the on-demand global error page's too).
  const loaded = new Set([...(buildManifest.rootMainFiles ?? []), ...(buildManifest.polyfillFiles ?? [])].map((file) => file.replace(/^\/?(_next\/)?/, '')));
  for (const entry of Object.keys(routes).sort()) {
    const route = routeOfEntry(entry);
    // The global error page renders only when the root layout fails.
    if (!route || route === '/_global-error') continue;
    const manifestFile = path.join(dir, 'server/app', `${entry}_client-reference-manifest.js`);
    if (!existsSync(manifestFile)) {
      errors.push(`${route}: missing ${path.relative(dir, manifestFile)}`);
      continue;
    }
    const { entryJSFiles } = readClientManifest(manifestFile, entry);
    const files = initialChunks(buildManifest.rootMainFiles ?? [], entryJSFiles);
    for (const chunks of Object.values(entryJSFiles)) for (const chunk of chunks) loaded.add(chunk.replace(/^\/?(_next\/)?/, ''));

    // The cross-check against what the build prerendered (M05 review, graph-15: an empty shell is no check).
    const checked = new Set();
    for (const source of prerenderedScripts(dir, route, buildManifest.polyfillFiles ?? [])) {
      const missing = source.scripts.filter((src) => !files.includes(src));
      if (missing.length) errors.push(`${route}: ${source.from} loads scripts the count misses: ${missing.join(', ')}`);
      for (const src of source.scripts) checked.add(src);
    }

    const bytes = files.reduce((sum, file) => sum + gzipSize(file), 0);
    const budget = budgetFor(route);
    results.push({ route, files: files.length, bytes, budget, ok: bytes <= budget, prerendered: checked.size > 0, checked: checked.size });
  }
  if (results.length === 0) errors.push('no App Router pages found: run `pnpm build` first');
  return { results, errors, loaded: [...loaded].sort() };
}

/**
 * Libraries that load only in a Web Worker, never with a page, found in the build by a string only
 * their code carries: ELK runs in the explorer's layout worker (plan §4.11, §5.8 (c); M05), so it
 * is in no route's count.
 */
export const WORKER_ONLY = [{ name: 'ELK', signature: 'org.eclipse.elk' }];

/**
 * The chunk lists of Turbopack's worker entries, `"static/chunks/turbopack-worker-….js",[…]`: what
 * `new Worker(new URL(…, import.meta.url))` becomes in the build. A chunk named only in such lists
 * loads in the worker.
 */
const WORKER_LIST = /"(?:\/_next\/)?static\/chunks\/turbopack-worker-[\w.~-]+\.js",\s*\[([^\]]*)\]/g;

/**
 * Checks that every library of `libraries` loads only in a worker: at least one built script
 * carries its signature, every such chunk is in a worker's chunk list, and none of them is one the
 * main thread can load: a chunk of `loaded` (what pages load) or a chunk that one of those names
 * outside a worker list (a lazy import, next/dynamic), and so on.
 */
export function checkWorkerOnly(dir, loaded, libraries = WORKER_ONLY) {
  const scripts = filesUnder(path.join(dir, 'static'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => path.relative(dir, file).split(path.sep).join('/'));
  const bodies = new Map(scripts.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]));
  const inWorker = new Set();
  const names = new Map();
  for (const [file, body] of bodies) {
    for (const match of body.matchAll(WORKER_LIST)) for (const chunk of chunkPaths(match[1])) inWorker.add(chunk);
    names.set(
      file,
      chunkPaths(body.replace(WORKER_LIST, '')).filter((chunk) => chunk !== file),
    );
  }
  const main = new Set(loaded);
  const queue = [...main];
  while (queue.length > 0) {
    for (const chunk of names.get(queue.pop()) ?? []) {
      if (!main.has(chunk)) {
        main.add(chunk);
        queue.push(chunk);
      }
    }
  }
  const found = [];
  const errors = [];
  for (const library of libraries) {
    const chunks = scripts.filter((file) => bodies.get(file).includes(library.signature));
    if (chunks.length === 0) errors.push(`${library.name}: no built script carries its signature "${library.signature}"`);
    for (const chunk of chunks) {
      if (main.has(chunk)) errors.push(`${library.name} (${chunk}) loads on the main thread: a page, or a chunk a page loads, names it`);
      if (!inWorker.has(chunk)) errors.push(`${library.name} (${chunk}) is in no worker's chunk list`);
    }
    const bytes = chunks.reduce((sum, chunk) => sum + gzipSync(bodies.get(chunk)).length, 0);
    found.push({ name: library.name, chunks, bytes });
  }
  return { libraries: found, errors };
}

/**
 * Libraries that load only after a page (import(), next/dynamic), never with its first JavaScript,
 * found in the build by a string only their code carries: MapLibre GL JS, in the school map's
 * islands (src/components/map; milestone M11).
 */
export const LAZY_ONLY = [{ name: 'MapLibre', signature: 'maplibregl-canvas-container' }];

/**
 * Checks that every library of `libraries` is in the build and that no chunk carrying it is one a
 * page loads initially (`loaded`): it may only be asked for later.
 */
export function checkLazyOnly(dir, loaded, libraries = LAZY_ONLY) {
  const scripts = filesUnder(path.join(dir, 'static'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => path.relative(dir, file).split(path.sep).join('/'));
  const initial = new Set(loaded);
  const found = [];
  const errors = [];
  for (const library of libraries) {
    const chunks = scripts.filter((file) => readFileSync(path.join(dir, file), 'utf8').includes(library.signature));
    if (chunks.length === 0) errors.push(`${library.name}: no built script carries its signature "${library.signature}"`);
    for (const chunk of chunks) {
      if (initial.has(chunk)) errors.push(`${library.name} (${chunk}) loads with a page: it must load only after it (next/dynamic)`);
    }
    const bytes = chunks.reduce((sum, chunk) => sum + gzipSync(readFileSync(path.join(dir, chunk))).length, 0);
    found.push({ name: library.name, chunks, bytes });
  }
  return { libraries: found, errors };
}

const kb = (bytes) => `${(bytes / KB).toFixed(1)} kB`;

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
  };
  const dir = path.resolve(option('--dir', '.next'));
  if (!existsSync(path.join(dir, 'build-manifest.json'))) {
    console.error(`check-bundle-budget: ${dir} has no build-manifest.json; run \`pnpm build\` first.`);
    process.exit(2);
  }
  const { results, errors, loaded } = checkBudgets(dir);
  const workerOnly = checkWorkerOnly(dir, loaded);
  errors.push(...workerOnly.errors);
  const lazyOnly = checkLazyOnly(dir, loaded);
  errors.push(...lazyOnly.errors);
  console.log('Initial JavaScript per route (gzip):');
  for (const r of results) {
    const crossCheck = r.checked > 0 ? `${r.checked} cross-checked against the prerendered output` : 'nothing prerendered to cross-check';
    console.log(`  ${r.ok ? 'ok  ' : 'OVER'} ${r.route.padEnd(24)} ${kb(r.bytes).padStart(9)} of ${kb(r.budget)}  (${r.files} files, ${crossCheck})`);
  }
  console.log('Only in a Web Worker, in no count (gzip):');
  for (const library of workerOnly.libraries) {
    console.log(`  ${library.name.padEnd(29)} ${kb(library.bytes).padStart(9)}  (${library.chunks.join(', ') || 'not found'})`);
  }
  console.log('Only after a page (next/dynamic), in no count (gzip):');
  for (const library of lazyOnly.libraries) {
    console.log(`  ${library.name.padEnd(29)} ${kb(library.bytes).padStart(9)}  (${library.chunks.join(', ') || 'not found'})`);
  }
  const json = option('--json');
  if (json) writeFileSync(json, `${JSON.stringify({ results, workerOnly: workerOnly.libraries, lazyOnly: lazyOnly.libraries, errors }, null, 2)}\n`);
  for (const error of errors) console.error(`check-bundle-budget: ${error}`);
  const over = results.filter((r) => !r.ok);
  if (over.length || errors.length) {
    console.error(`check-bundle-budget: FAIL (${over.length} route(s) over budget, ${errors.length} error(s))`);
    process.exit(1);
  }
  console.log(`check-bundle-budget: PASS (${results.length} routes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
