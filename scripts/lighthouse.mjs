#!/usr/bin/env node
// Lighthouse for `/` in the mobile profile (plan §5.8 (c), M00b): runs Lighthouse `numberOfRuns`
// times against a running server, takes the median of each metric and checks it against the thresholds of
// lighthouserc.json (LCP and CLS). Reports go to `upload.outputDir` (git-ignored).
//
//   node scripts/lighthouse.mjs --url=http://127.0.0.1:3102/ [--chrome-path=/path/to/chrome]
//   node scripts/lighthouse.mjs --plan=<plan.json> --results=<results.json> [--chrome-path=…]
//
// With --plan (M13, pnpm perf:web, scripts/lib/lighthouse-routes-run.ts): every route of the plan
// ({ base, routes: [{ label, path, cookie? }] }) in one Chrome, each once; a route over a threshold
// runs twice more and the median of the three decides. A route whose page ends at another path
// (a guarded page that sent Lighthouse to the sign-in page) fails. The measurements go to
// --results as JSON; reports to `upload.outputDir`/routes.
//
// It replaces @lhci/cli, whose last release pins Lighthouse 12 and brings eight known advisories
// into the dev tree (ADR 0006). The config keeps the lhci layout (ci.collect, ci.assert,
// ci.upload) so the thresholds stay where scripts/verify.d/M00b.sh checks them. Exit status 1
// when a threshold fails or a run errors.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, args.config || 'lighthouserc.json'), 'utf8')).ci;
const url = args.url;
if (!url && !args.plan) {
  console.error('usage: node scripts/lighthouse.mjs --url=<url> | --plan=<plan.json> --results=<results.json> [--chrome-path=<chrome>] [--config=lighthouserc.json]');
  process.exit(2);
}
if (args.plan) {
  if (!args.results) {
    console.error('--plan needs --results=<results.json>');
    process.exit(2);
  }
  process.exit(await runPlan(JSON.parse(readFileSync(args.plan, 'utf8')), args.results));
}

const runs = config.collect.numberOfRuns ?? 3;
const settings = config.collect.settings ?? {};
const outDir = join(root, config.upload?.outputDir ?? '.lighthouseci/reports');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** The audit each assertion names, and how its value is read. */
const AUDITS = {
  'largest-contentful-paint': (lhr) => lhr.audits['largest-contentful-paint'].numericValue,
  'cumulative-layout-shift': (lhr) => lhr.audits['cumulative-layout-shift'].numericValue,
};

/** The routes of a plan in one Chrome (see the top of this file); returns the exit status. */
async function runPlan(plan, resultsFile) {
  const settings = config.collect.settings ?? {};
  const limits = Object.fromEntries(Object.entries(config.assert.assertions).map(([audit, [, { maxNumericValue }]]) => [audit, maxNumericValue]));
  const within = (run) => run.lcp <= limits['largest-contentful-paint'] && run.cls <= limits['cumulative-layout-shift'];
  const dir = join(root, config.upload?.outputDir ?? '.lighthouseci/reports', 'routes');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const chrome = await chromeLauncher.launch({
    chromePath: args['chrome-path'] || undefined,
    chromeFlags: (settings.chromeFlags ?? '--headless=new').split(/\s+/).filter(Boolean),
  });
  const out = { lighthouse: '', throttling: settings.throttlingMethod ?? 'devtools', limits, routes: [] };
  let failed = 0;
  try {
    for (const [index, route] of plan.routes.entries()) {
      const target = new URL(route.path, plan.base);
      const runsOf = [];
      const once = async () => {
        const result = await lighthouse(target.href, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: settings.onlyCategories,
          throttlingMethod: settings.throttlingMethod,
          extraHeaders: route.cookie ? { Cookie: route.cookie } : undefined,
        });
        if (!result) throw new Error(`${route.label}: Lighthouse returned no result`);
        const { lhr, report } = result;
        if (lhr.runtimeError) throw new Error(`${route.label}: ${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
        out.lighthouse = lhr.lighthouseVersion;
        out.throttling = lhr.configSettings.throttlingMethod;
        writeFileSync(join(dir, `${String(index + 1).padStart(2, '0')}-${runsOf.length + 1}.json`), report);
        const ended = new URL(lhr.finalDisplayedUrl).pathname;
        if (ended !== target.pathname) throw new Error(`${route.label}: the page ended at ${ended}, not ${target.pathname}`);
        const value = (id) => lhr.audits[id]?.numericValue ?? Number.NaN;
        runsOf.push({ lcp: value('largest-contentful-paint'), cls: value('cumulative-layout-shift'), tbt: value('total-blocking-time'), fcp: value('first-contentful-paint') });
      };
      let error = null;
      try {
        await once();
        if (!within(runsOf[0])) {
          await once();
          await once();
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const mid = (key) => {
        const values = runsOf.map((r) => r[key]).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
      };
      const median = runsOf.length ? { lcp: mid('lcp'), cls: mid('cls'), tbt: mid('tbt'), fcp: mid('fcp') } : null;
      const ok = !error && median !== null && within(median);
      if (!ok) failed += 1;
      out.routes.push({ label: route.label, runs: runsOf.length, median, ok, error });
      console.log(
        error
          ? `FAIL ${route.label}: ${error}`
          : `${ok ? 'ok  ' : 'FAIL'} ${route.label}: LCP ${Math.round(median.lcp)} ms, CLS ${median.cls.toFixed(3)}, TBT ${Math.round(median.tbt)} ms (${runsOf.length} run${runsOf.length > 1 ? 's' : ''})`,
      );
    }
  } finally {
    await chrome.kill();
  }
  writeFileSync(resultsFile, JSON.stringify(out, null, 2));
  console.log(
    `Lighthouse ${out.lighthouse}, mobile, ${out.throttling} throttling: ${plan.routes.length - failed} of ${plan.routes.length} routes within ` +
      `LCP <= ${limits['largest-contentful-paint']} ms and CLS <= ${limits['cumulative-layout-shift']}`,
  );
  return failed ? 1 : 0;
}

const results = [];
for (let i = 1; i <= runs; i++) {
  const chrome = await chromeLauncher.launch({
    chromePath: args['chrome-path'] || undefined,
    chromeFlags: (settings.chromeFlags ?? '--headless=new').split(/\s+/).filter(Boolean),
  });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: ['json', 'html'],
      logLevel: 'error',
      onlyCategories: settings.onlyCategories,
      throttlingMethod: settings.throttlingMethod,
    });
    if (!result) throw new Error('Lighthouse returned no result');
    const { lhr, report } = result;
    if (lhr.runtimeError) throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
    writeFileSync(join(outDir, `lhr-${i}.json`), report[0]);
    writeFileSync(join(outDir, `lhr-${i}.html`), report[1]);
    results.push(lhr);
    const lcp = Math.round(AUDITS['largest-contentful-paint'](lhr));
    const cls = AUDITS['cumulative-layout-shift'](lhr).toFixed(3);
    console.log(`run ${i}/${runs}: LCP ${lcp} ms, CLS ${cls}`);
  } finally {
    await chrome.kill();
  }
}

// The median of each metric over the runs.
const medianOf = (audit) => {
  const values = results.map(AUDITS[audit]).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
const s = results[0].configSettings;
console.log(
  `Lighthouse ${results[0].lighthouseVersion}, ${s.formFactor}, ${s.throttlingMethod} throttling, ${results.length} runs: ` +
    `median LCP ${Math.round(medianOf('largest-contentful-paint'))} ms, ` +
    `median CLS ${medianOf('cumulative-layout-shift').toFixed(3)}`,
);

let failed = 0;
for (const [audit, [level, { maxNumericValue }]] of Object.entries(config.assert.assertions)) {
  const read = AUDITS[audit];
  if (!read) {
    console.error(`unknown assertion: ${audit}`);
    failed += 1;
    continue;
  }
  const value = medianOf(audit);
  if (level === 'error' && value > maxNumericValue) {
    console.error(`FAIL ${audit}: ${value} > ${maxNumericValue}`);
    failed += 1;
  } else {
    console.log(`ok   ${audit}: ${Number(value.toFixed(3))} <= ${maxNumericValue}`);
  }
}
process.exit(failed ? 1 : 0);
