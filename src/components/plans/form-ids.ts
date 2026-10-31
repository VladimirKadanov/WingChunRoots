// The fixed id of the upgrade prompt's form for a page that shows the outcome of a post without
// JavaScript: the outcome address opens the dashboard at its message (`anchor` in
// src/server/forms/flash.ts, M08 review round 1, a11y-webview-1). Otherwise the prompt uses
// useFormId(), since a page kept hidden by the router can be in the document twice.

export const PILOT_ACCESS_FORM = 'pilot-access';

/**
 * A link to what a higher plan adds ("See what a higher plan adds" of an approval refused at the
 * limit, M09 review screens-6): the page with UPGRADE_OPEN_PARAM renders the prompt open, and the
 * fragment UPGRADE_SUMMARY_ID opens it at its summary, which the browser focuses. A plain link
 * (a new page load), with or without JavaScript: the router keeps earlier pages in the document,
 * hidden, so the fragment could name the prompt of another page.
 */
export const UPGRADE_OPEN_PARAM = { name: 'upgrade', value: 'open' } as const;
export const UPGRADE_SUMMARY_ID = 'upgrade-summary';

/**
 * The query parameter "Not now" sends without JavaScript (M08 final check, screens-1): the page
 * comes back with the prompt closed and the focus on its line. A plain module, so the dashboard (a
 * server page) reads the values too.
 */
export const UPGRADE_CLOSED_PARAM = { name: 'upgrade', value: 'closed' } as const;
