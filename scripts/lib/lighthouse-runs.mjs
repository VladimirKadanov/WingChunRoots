// How pnpm perf:web decides a route (scripts/lighthouse.mjs --plan, M13): the first run decides
// alone only when it is clearly within every budget; otherwise the route runs twice more and the
// median of the three runs decides, as lighthouserc.json's numberOfRuns 3 and `median-run` say.
// Plain JavaScript: scripts/lighthouse.mjs runs in plain Node (tsx breaks the functions Lighthouse
// sends to the page). Tested in scripts/lib/lighthouse-runs.test.ts.

/**
 * DEFAULT (M13 review F3, no D number; owner question in docs/plan/questions/M13.md): the share of
 * each budget a single run must stay within to decide alone. Lighthouse in the mobile profile
 * varies from run to run on the same build (simulated CPU and network on a shared machine), so
 * one run near a budget says little; a run at 90 % of every budget or below would need a swing of
 * more than 10 % to cross one, so its median of three would almost surely pass too. A run
 * closer to the budget (or over it) is not clear enough alone and gets the median of three. Always
 * running three costs about 33 minutes for 32 routes, too long for CI. The budgets themselves are
 * unchanged.
 */
export const CLEAR_MARGIN = 0.9;

/** The metrics of a run that have a budget, with the key of each in a run. */
export const BUDGETED = {
  'largest-contentful-paint': 'lcp',
  'cumulative-layout-shift': 'cls',
};

/** Every budgeted metric of the run is at or under `share` of its budget. */
export function withinShare(run, limits, share) {
  return Object.entries(BUDGETED).every(([audit, key]) => {
    const limit = limits[audit];
    return typeof limit === 'number' && Number.isFinite(run[key]) && run[key] <= limit * share;
  });
}

/** Every budgeted metric of the run is within its budget. */
export function withinBudget(run, limits) {
  return withinShare(run, limits, 1);
}

/** The first run decides alone: every budgeted metric is within CLEAR_MARGIN of its budget. */
export function clearlyWithin(run, limits) {
  return withinShare(run, limits, CLEAR_MARGIN);
}

/** The runs a route needs in all, after its first run: 1 when it is clearly within, else 3. */
export function runsNeeded(first, limits) {
  return clearlyWithin(first, limits) ? 1 : 3;
}

/** The median of each metric over the runs (each metric on its own), or null without runs. */
export function medianOf(runs) {
  if (runs.length === 0) return null;
  const keys = Object.keys(runs[0]);
  return Object.fromEntries(
    keys.map((key) => {
      const values = runs.map((r) => r[key]).sort((a, b) => a - b);
      return [key, values[Math.floor(values.length / 2)]];
    }),
  );
}

/**
 * The verdict on a route's runs: one run decides alone only when it is clearly within; otherwise
 * it takes the median of three (fewer runs than needed, as after an error, fail).
 */
export function decide(runs, limits) {
  const median = medianOf(runs);
  if (!median) return { median: null, ok: false };
  const complete = runs.length >= runsNeeded(runs[0], limits);
  return { median, ok: complete && withinBudget(median, limits) };
}
