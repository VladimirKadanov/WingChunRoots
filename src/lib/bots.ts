// M21 (docs/adr/0024-trial-lessons.md; DEFAULT M21, question 7): the user-agent heuristic the school
// stats use to leave out obvious bots. Pure: the user agent is tested and never kept or logged.
// Headless browsers (automated tests and previews) count as bots too.

const BOT = /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|monitor|uptime|pingdom|lighthouse|headless|phantomjs|curl\/|wget\/|python-|python\/|httpclient|okhttp|go-http-client|node-fetch|undici|axios\/|java\/|libwww|scrapy|feedfetcher/i;

/** True for a missing, very short or bot-like user agent. */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 10) return true;
  return BOT.test(userAgent);
}
