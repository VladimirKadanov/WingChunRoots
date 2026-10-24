// scripts/check-bundle-budget.mjs (M00b, plan §5.8 (c)) on a small fake build output.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import * as budget from './check-bundle-budget.mjs';

const { DEFAULT_BUDGET, KB, budgetFor, checkBudgets, htmlScripts, initialChunks, routeOfEntry } = budget as {
  DEFAULT_BUDGET: number;
  KB: number;
  budgetFor: (route: string) => number;
  checkBudgets: (dir: string) => {
    results: { route: string; files: number; bytes: number; budget: number; ok: boolean; prerendered: boolean }[];
    errors: string[];
  };
  htmlScripts: (html: string) => string[];
  initialChunks: (root: string[], entries: Record<string, string[]>) => string[];
  routeOfEntry: (entry: string) => string | null;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** High-entropy content (base64 of a SHA-256 chain), so gzip sizes stay close to the input. */
function noise(bytes: number, seed: number): string {
  let block = String(seed);
  let out = '';
  while (out.length < bytes) {
    block = createHash('sha256').update(block).digest('base64');
    out += block;
  }
  return out.slice(0, bytes);
}

function fakeBuild({ pageKb = 10, html = true, extraHtmlScript = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-budget-'));
  dirs.push(dir);
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  write('static/chunks/runtime.js', noise(40 * KB, 1));
  write('static/chunks/polyfill.js', noise(200 * KB, 2));
  write('static/chunks/layout.js', noise(5 * KB, 3));
  write('static/chunks/page.js', noise(pageKb * KB, 4));
  write('static/chunks/not-found.js', noise(1 * KB, 5));
  write('static/chunks/global-error.js', noise(300 * KB, 6));
  write('static/chunks/late.js', noise(1 * KB, 7));
  write(
    'build-manifest.json',
    JSON.stringify({ polyfillFiles: ['static/chunks/polyfill.js'], rootMainFiles: ['static/chunks/runtime.js'] }),
  );
  write('app-path-routes-manifest.json', JSON.stringify({ '/page': '/', '/api/rpc/[[...rest]]/route': '/api/rpc/[[...rest]]', '/_global-error/page': '/_global-error' }));
  const manifest = {
    entryJSFiles: {
      '[project]/src/app/layout': ['static/chunks/layout.js'],
      '[project]/src/app/not-found': ['static/chunks/layout.js', 'static/chunks/not-found.js'],
      '[project]/node_modules/next/dist/client/components/builtin/global-error': ['static/chunks/global-error.js'],
      '[project]/src/app/page': ['static/chunks/layout.js', 'static/chunks/page.js'],
    },
  };
  write(
    'server/app/page_client-reference-manifest.js',
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify(manifest)};\n`,
  );
  if (html) {
    write(
      'server/app/index.html',
      [
        '<!DOCTYPE html><html><head>',
        '<script src="/_next/static/chunks/runtime.js" async=""></script>',
        '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>',
        '<script src="/_next/static/chunks/page.js?dpl=abc" async=""></script>',
        '<script src="/_next/static/chunks/not-found.js" async=""></script>',
        extraHtmlScript ? '<script src="/_next/static/chunks/late.js" async=""></script>' : '',
        '<script>self.__next_f=[]</script>',
        '</head><body></body></html>',
      ].join(''),
    );
  }
  return dir;
}

describe('check-bundle-budget', () => {
  it('budgets 170 kB per route unless a route has its own budget', () => {
    expect(DEFAULT_BUDGET).toBe(170_000);
    expect(budgetFor('/')).toBe(DEFAULT_BUDGET);
    expect(budgetFor('/legal/licenses')).toBe(DEFAULT_BUDGET);
  });

  it('maps App Router entries to routes and skips route handlers', () => {
    expect(routeOfEntry('/page')).toBe('/');
    expect(routeOfEntry('/legal/licenses/page')).toBe('/legal/licenses');
    expect(routeOfEntry('/api/rpc/[[...rest]]/route')).toBeNull();
  });

  it('counts the root main files and every client entry except the global error page', () => {
    expect(
      initialChunks(['static/chunks/runtime.js'], {
        '[project]/src/app/layout': ['static/chunks/layout.js'],
        '[project]/src/app/not-found': ['static/chunks/layout.js', 'static/chunks/not-found.js'],
        'x/builtin/global-error': ['static/chunks/global-error.js'],
        '[project]/src/app/page': ['/_next/static/chunks/page.js'],
      }),
    ).toEqual(['static/chunks/layout.js', 'static/chunks/not-found.js', 'static/chunks/page.js', 'static/chunks/runtime.js']);
  });

  it("counts the app's own global error page, which every prerendered page loads (M04)", () => {
    expect(
      initialChunks(['static/chunks/runtime.js'], {
        '[project]/src/app/layout': ['static/chunks/layout.js'],
        '[project]/src/app/global-error': ['static/chunks/layout.js', 'static/chunks/app-global-error.js'],
        '[project]/src/app/page': ['static/chunks/page.js'],
      }),
    ).toEqual(['static/chunks/app-global-error.js', 'static/chunks/layout.js', 'static/chunks/page.js', 'static/chunks/runtime.js']);
  });

  it('reads module scripts from HTML and ignores nomodule and inline scripts', () => {
    expect(
      htmlScripts(
        '<script src="/_next/static/a.js?x=1" async=""></script><script src="/_next/static/b.js" noModule=""></script><script>1</script><script src="https://cdn.example/c.js"></script>',
      ),
    ).toEqual(['static/a.js']);
  });

  it('sums the gzip sizes of the counted files and passes within the budget', () => {
    const dir = fakeBuild();
    const { results, errors } = checkBudgets(dir);
    expect(errors).toEqual([]);
    expect(results).toHaveLength(1);
    const [home] = results;
    const gz = (file: string, kb: number, seed: number) => gzipSync(noise(kb * KB, seed)).length;
    expect(home).toMatchObject({ route: '/', files: 4, ok: true, prerendered: true });
    expect(home!.bytes).toBe(gz('runtime', 40, 1) + gz('layout', 5, 3) + gz('page', 10, 4) + gz('not-found', 1, 5));
  });

  it('fails a route over its budget', () => {
    const { results } = checkBudgets(fakeBuild({ pageKb: 300 }));
    expect(results[0]).toMatchObject({ route: '/', ok: false });
  });

  it('fails when the HTML loads a script that the manifests do not name', () => {
    const { errors } = checkBudgets(fakeBuild({ extraHtmlScript: true }));
    expect(errors).toEqual(['/: the HTML loads scripts the count misses: static/chunks/late.js']);
  });

  it('counts routes without prerendered HTML from the manifests alone', () => {
    const { results, errors } = checkBudgets(fakeBuild({ html: false }));
    expect(errors).toEqual([]);
    expect(results[0]).toMatchObject({ route: '/', prerendered: false, ok: true });
  });
});
