#!/usr/bin/env node
// scripts/check-bundle-budget.mjs [--dir .next] [--json <file>]
//
// The JavaScript budget per route (plan §5.8 (c), M00b): after `next build`, the JavaScript a
// browser loads to show each page of the App Router, gzip-compressed, must stay within the
// route's budget (170 kB by default; the explorer and the map get their own in M05 and M11).
//
// "Initially loaded" = the root main files of the build manifest (the runtime and the router)
// plus the chunks of every client entry in the route's client reference manifest (layouts,
// templates, loading, error and not-found boundaries, the page). Only the global error page's
// own chunks and the nomodule polyfills that modern browsers skip are not counted. For every prerendered
// route the script also reads its HTML and fails when a <script src> there is missing from
// that set, so a change in Next.js's manifests cannot shrink the count unnoticed.
//
// 1 kB = 1000 bytes; gzip at the zlib default level, as a server would send it.
//
// DEFAULT D24: the budgets of plan §5.8 until the owner confirms the performance targets.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  // DEFAULT (M00b, ADR 0006): the noindex style guide for developers and the design review
  // renders every overlay component (dialog, sheets, menu, toast, tabs) at once on one page.
  '/styleguide': 250 * KB,
};

/**
 * The client entry that loads only when its state renders: the global error page. The
 * not-found, forbidden and unauthorized boundaries are in the tree of every page and load with
 * it (the HTML check below found that).
 */
const ON_DEMAND_ENTRY = /\/global-error$/;

export function budgetFor(route) {
  return ROUTE_BUDGETS[route] ?? DEFAULT_BUDGET;
}

/** `/page` -> `/`, `/legal/licenses/page` -> `/legal/licenses`; null for route handlers. */
export function routeOfEntry(entry) {
  if (!entry.endsWith('/page')) return null;
  return entry.slice(0, -'/page'.length) || '/';
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

/** The prerendered HTML of a route, if the build wrote one. */
function htmlFile(dir, route) {
  return path.join(dir, 'server/app', `${route === '/' ? '/index' : route}.html`);
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

    const html = htmlFile(dir, route);
    if (existsSync(html)) {
      const missing = htmlScripts(readFileSync(html, 'utf8')).filter((src) => !files.includes(src));
      if (missing.length) errors.push(`${route}: the HTML loads scripts the count misses: ${missing.join(', ')}`);
    }

    const bytes = files.reduce((sum, file) => sum + gzipSize(file), 0);
    const budget = budgetFor(route);
    results.push({ route, files: files.length, bytes, budget, ok: bytes <= budget, prerendered: existsSync(html) });
  }
  if (results.length === 0) errors.push('no App Router pages found: run `pnpm build` first');
  return { results, errors };
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
  const { results, errors } = checkBudgets(dir);
  console.log('Initial JavaScript per route (gzip):');
  for (const r of results) {
    console.log(
      `  ${r.ok ? 'ok  ' : 'OVER'} ${r.route.padEnd(24)} ${kb(r.bytes).padStart(9)} of ${kb(r.budget)}  (${r.files} files${r.prerendered ? ', checked against its HTML' : ''})`,
    );
  }
  const json = option('--json');
  if (json) writeFileSync(json, `${JSON.stringify({ results, errors }, null, 2)}\n`);
  for (const error of errors) console.error(`check-bundle-budget: ${error}`);
  const over = results.filter((r) => !r.ok);
  if (over.length || errors.length) {
    console.error(`check-bundle-budget: FAIL (${over.length} route(s) over budget, ${errors.length} error(s))`);
    process.exit(1);
  }
  console.log(`check-bundle-budget: PASS (${results.length} routes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
