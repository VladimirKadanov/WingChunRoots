// scripts/lib/lighthouse-runs.mjs: when one Lighthouse run decides a route of pnpm perf:web and
// when the median of three does (M13 review F3, DEFAULT CLEAR_MARGIN).

import { describe, expect, it } from 'vitest';

import * as runs from './lighthouse-runs.mjs';

interface Run {
  lcp: number;
  cls: number;
  tbt: number;
  fcp: number;
}
type Limits = Record<string, number>;

const { CLEAR_MARGIN, clearlyWithin, decide, medianOf, runsNeeded } = runs as {
  CLEAR_MARGIN: number;
  clearlyWithin: (run: Run, limits: Limits) => boolean;
  decide: (runs: Run[], limits: Limits) => { median: Run | null; ok: boolean };
  medianOf: (runs: Run[]) => Run | null;
  runsNeeded: (first: Run, limits: Limits) => number;
};

// The budgets of lighthouserc.json.
const LIMITS: Limits = { 'largest-contentful-paint': 2500, 'cumulative-layout-shift': 0.1 };
const run = (lcp: number, cls: number, tbt = 100, fcp = 1000): Run => ({ lcp, cls, tbt, fcp });

describe('CLEAR_MARGIN', () => {
  it('is 90 % of the budget', () => {
    expect(CLEAR_MARGIN).toBe(0.9);
  });
});

describe('runsNeeded', () => {
  it('lets a first run with a clear margin on every budgeted metric decide alone', () => {
    expect(runsNeeded(run(1700, 0.01), LIMITS)).toBe(1);
    expect(runsNeeded(run(2250, 0.09), LIMITS)).toBe(1); // exactly at 90 %
  });

  it('asks for three runs when any budgeted metric is past 90 % of its budget', () => {
    expect(runsNeeded(run(2251, 0.0), LIMITS)).toBe(3); // within the budget, but not clearly
    expect(runsNeeded(run(1600, 0.095), LIMITS)).toBe(3);
    expect(runsNeeded(run(2600, 0.0), LIMITS)).toBe(3); // over the budget
  });

  it('ignores metrics without a budget (TBT, FCP)', () => {
    expect(runsNeeded(run(1600, 0.0, 5000, 2400), LIMITS)).toBe(1);
  });

  it('asks for three runs when a budgeted metric is missing or a budget is unknown', () => {
    expect(runsNeeded(run(Number.NaN, 0.0), LIMITS)).toBe(3);
    expect(clearlyWithin(run(1600, 0.0), { 'largest-contentful-paint': 2500 })).toBe(false);
  });
});

describe('medianOf', () => {
  it('takes the median of each metric on its own', () => {
    expect(medianOf([run(2600, 0.0, 300, 900), run(2300, 0.05, 100, 1100), run(2400, 0.02, 200, 1000)])).toEqual(run(2400, 0.02, 200, 1000));
  });

  it('is null without runs', () => {
    expect(medianOf([])).toBeNull();
  });
});

describe('decide', () => {
  it('passes a clear single run', () => {
    expect(decide([run(1700, 0.0)], LIMITS)).toEqual({ median: run(1700, 0.0), ok: true });
  });

  it('does not let a single run near the budget decide', () => {
    expect(decide([run(2400, 0.0)], LIMITS).ok).toBe(false);
  });

  it('decides on the median of three when the first run is not clear', () => {
    // First over the budget, the median within: passes.
    expect(decide([run(2600, 0.0), run(2300, 0.0), run(2400, 0.0)], LIMITS)).toMatchObject({ ok: true, median: { lcp: 2400 } });
    // First near the budget, the median over: fails.
    expect(decide([run(2400, 0.0), run(2600, 0.0), run(2700, 0.0)], LIMITS)).toMatchObject({ ok: false, median: { lcp: 2600 } });
    // CLS decides as well.
    expect(decide([run(1600, 0.095), run(1600, 0.12), run(1600, 0.11)], LIMITS).ok).toBe(false);
  });

  it('fails without runs', () => {
    expect(decide([], LIMITS)).toEqual({ median: null, ok: false });
  });
});
