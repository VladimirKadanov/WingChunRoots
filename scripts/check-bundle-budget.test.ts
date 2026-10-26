// scripts/check-bundle-budget.mjs (M00b, plan §5.8 (c)) on a small fake build output.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import * as budget from './check-bundle-budget.mjs';

const { DEFAULT_BUDGET, KB, budgetFor, checkBudgets, checkWorkerOnly, chunkPaths, htmlScripts, initialChunks, routeOfEntry } = budget as {
  DEFAULT_BUDGET: number;
  KB: number;
  budgetFor: (route: string) => number;
  checkBudgets: (dir: string) => {
    results: { route: string; files: number; bytes: number; budget: number; ok: boolean; prerendered: boolean; checked: number }[];
    errors: string[];
    loaded: string[];
  };
  checkWorkerOnly: (
    dir: string,
    loaded: string[],
  ) => { libraries: { name: string; chunks: string[]; bytes: number }[]; errors: string[] };
  chunkPaths: (text: string) => string[];
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

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-budget-'));
  dirs.push(dir);
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  return { dir, write };
}

/** A partial prerender's postponed state as Next.js writes it in `<route>.meta` (one JSON string). */
function postponedMeta(chunks: string[]) {
  const bootstrap = `(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":${JSON.stringify(chunks.slice(1))},"runtimeModuleIds":[1]});`;
  const state = { resumableState: { bootstrapScriptContent: bootstrap, bootstrapScripts: [{ src: `/_next/${chunks[0]}` }] } };
  return JSON.stringify({ status: 200, postponed: `${JSON.stringify(state).length}:[0,${JSON.stringify(state)}]null` });
}

function fakeBuild({
  pageKb = 10,
  html = true as boolean | 'empty',
  extraHtmlScript = false,
  meta = null as string | null,
  segments = {} as Record<string, string>,
} = {}) {
  const { dir, write } = tempDir();
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
  if (html === 'empty') write('server/app/index.html', '');
  else if (html) {
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
  if (meta !== null) write('server/app/index.meta', meta);
  for (const [file, content] of Object.entries(segments)) write(`server/app/index.segments/${file}`, content);
  return dir;
}

/**
 * A build with the layout worker as Turbopack writes it: the page chunk turns
 * `new Worker(new URL(…))` into the worker entry and its chunk list, and the worker's own runtime
 * chunk lists ELK again. `page` is appended to the page chunk, `pageChunks` to the page's entry.
 */
function workerBuild({ page = '', pageChunks = [] as string[], signature = 'org.eclipse.elk.layered' } = {}) {
  const { dir, write } = tempDir();
  write('static/chunks/runtime.js', 'runtime');
  write(
    'static/chunks/page.js',
    `e.v(e.r(10914).f("static/chunks/turbopack-worker-abc.js",["static/chunks/layout-code.js","static/chunks/elk.js","static/chunks/turbopack-w.js","static/chunks/runtime.js"]));${page}`,
  );
  write('static/chunks/turbopack-worker-abc.js', 'worker entry');
  write('static/chunks/turbopack-w.js', 'push({otherChunks:["static/chunks/layout-code.js","static/chunks/elk.js"],runtimeModuleIds:[1]})');
  write('static/chunks/layout-code.js', 'layout code');
  write('static/chunks/elk.js', `elk ${signature} elk`);
  write('static/chunks/lazy.js', 'lazy');
  write('static/chunks/lazy-elk.js', 'e.v(t=>Promise.all(["static/chunks/elk.js"].map(t=>e.l(t))))');
  write('static/BUILD/_buildManifest.js', 'self.__BUILD_MANIFEST={}');
  return { dir, loaded: ['static/chunks/runtime.js', 'static/chunks/page.js', ...pageChunks] };
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

  it('cross-checks the scripts of the prerendered HTML and says how many', () => {
    const { results } = checkBudgets(fakeBuild());
    // runtime.js, page.js and not-found.js; the nomodule polyfill is not one of them.
    expect(results[0]).toMatchObject({ prerendered: true, checked: 3 });
  });

  it('treats an empty HTML shell as nothing to cross-check, not as a check (M05, graph-15)', () => {
    const { results, errors } = checkBudgets(fakeBuild({ html: 'empty' }));
    expect(errors).toEqual([]);
    expect(results[0]).toMatchObject({ route: '/', prerendered: false, checked: 0, ok: true });
  });

  it('cross-checks the postponed state of a route whose shell is empty', () => {
    const counted = checkBudgets(fakeBuild({ html: 'empty', meta: postponedMeta(['static/chunks/runtime.js', 'static/chunks/layout.js']) }));
    expect(counted.errors).toEqual([]);
    expect(counted.results[0]).toMatchObject({ prerendered: true, checked: 2 });
    const { errors } = checkBudgets(fakeBuild({ html: 'empty', meta: postponedMeta(['static/chunks/runtime.js', 'static/chunks/late.js']) }));
    expect(errors).toEqual(['/: the postponed state loads scripts the count misses: static/chunks/late.js']);
  });

  it('cross-checks the chunks the prerendered RSC payload names', () => {
    const page = '2:"/_next/static/chunks/page.js"\n3:I[1,["$2"],"default"]\n4:["$","script","script-0",{"src":"/_next/static/chunks/not-found.js","async":true}]';
    const counted = checkBudgets(fakeBuild({ html: 'empty', segments: { 'page/__PAGE__.segment.rsc': page } }));
    expect(counted.errors).toEqual([]);
    expect(counted.results[0]).toMatchObject({ prerendered: true, checked: 2 });
    const { errors } = checkBudgets(fakeBuild({ html: 'empty', segments: { '_full.segment.rsc': `${page}\n5:"/_next/static/chunks/late.js?dpl=1"` } }));
    expect(errors).toEqual(['/: the RSC payload loads scripts the count misses: static/chunks/late.js']);
  });

  it('leaves the nomodule polyfills out of every cross-check', () => {
    const { errors, results } = checkBudgets(fakeBuild({ html: 'empty', meta: postponedMeta(['static/chunks/runtime.js', 'static/chunks/polyfill.js']) }));
    expect(errors).toEqual([]);
    expect(results[0]).toMatchObject({ checked: 1 });
  });

  it('lists every chunk any page loads, the on-demand global error page included', () => {
    expect(checkBudgets(fakeBuild()).loaded).toEqual([
      'static/chunks/global-error.js',
      'static/chunks/layout.js',
      'static/chunks/not-found.js',
      'static/chunks/page.js',
      'static/chunks/polyfill.js',
      'static/chunks/runtime.js',
    ]);
  });

  it('reads chunk paths with or without the /_next/ prefix, and nothing else', () => {
    expect(chunkPaths('["static/chunks/a.js","/_next/static/chunks/b-1_x.js?dpl=2",\\"static/chunks/c.js\\"] static/chunks/d.json /static/x.css')).toEqual([
      'static/chunks/a.js',
      'static/chunks/b-1_x.js',
      'static/chunks/c.js',
    ]);
  });
});

describe('check-bundle-budget: libraries only in a Web Worker (M05, plan §4.11)', () => {
  it('passes when only the worker chunk lists name the chunk that carries ELK', () => {
    const { dir, loaded } = workerBuild();
    const { libraries, errors } = checkWorkerOnly(dir, loaded);
    expect(errors).toEqual([]);
    expect(libraries).toMatchObject([{ name: 'ELK', chunks: ['static/chunks/elk.js'] }]);
    expect(libraries[0]!.bytes).toBeGreaterThan(0);
  });

  it('fails when a page lazily imports the chunk with ELK (import(), next/dynamic)', () => {
    const { dir, loaded } = workerBuild({ page: 'e.v(t=>Promise.all(["static/chunks/elk.js"].map(t=>e.l(t))))' });
    expect(checkWorkerOnly(dir, loaded).errors).toEqual([
      'ELK (static/chunks/elk.js) loads on the main thread: a page, or a chunk a page loads, names it',
    ]);
  });

  it('follows lazy imports through other chunks', () => {
    const { dir, loaded } = workerBuild({ page: 'e.v(t=>Promise.all(["static/chunks/lazy-elk.js"].map(t=>e.l(t))))' });
    expect(checkWorkerOnly(dir, loaded).errors).toHaveLength(1);
  });

  it('fails when a page loads the chunk with ELK initially', () => {
    const { dir, loaded } = workerBuild({ pageChunks: ['static/chunks/elk.js'] });
    expect(checkWorkerOnly(dir, loaded).errors).toEqual([
      'ELK (static/chunks/elk.js) loads on the main thread: a page, or a chunk a page loads, names it',
    ]);
  });

  it('fails when no worker lists the chunk with ELK, or when no chunk carries it', () => {
    const { dir, loaded } = workerBuild({ signature: 'nothing here' });
    expect(checkWorkerOnly(dir, loaded).errors).toEqual(['ELK: no built script carries its signature "org.eclipse.elk"']);
    const other = workerBuild();
    writeFileSync(path.join(other.dir, 'static/chunks/lazy.js'), 'org.eclipse.elk in a chunk no worker loads');
    expect(checkWorkerOnly(other.dir, other.loaded).errors).toEqual(['ELK (static/chunks/lazy.js) is in no worker\'s chunk list']);
  });
});
