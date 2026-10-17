#!/usr/bin/env node
// Lighthouse for `/` in the mobile profile (plan §5.8 (c), M00b): runs Lighthouse `numberOfRuns`
// times against a running server, takes the median of each metric and checks it against the thresholds of
// lighthouserc.json (LCP and CLS). Reports go to `upload.outputDir` (git-ignored).
//
//   node scripts/lighthouse.mjs --url=http://127.0.0.1:3102/ [--chrome-path=/path/to/chrome]
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
if (!url) {
  console.error('usage: node scripts/lighthouse.mjs --url=<url> [--chrome-path=<chrome>] [--config=lighthouserc.json]');
  process.exit(2);
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
