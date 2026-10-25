// search.query (milestone M07, In scope 3; plan §5.6): people, schools and lineages by any
// spelling of a name. Open to everyone, signed in or not, and the answer is the same for both:
// only public records (src/server/search/query.ts reads them through the public views) and only
// the public DTO (src/server/dto/search.ts). The query itself is never logged (plan §6.4).

import * as z from 'zod';

import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { type SearchResultDto, toPublicSearchResult } from '../dto/search';
import { MAX_QUERY_LENGTH, queryForms } from '../search/keys';
import { searchLineages, searchPeople, searchSchools, setThresholds } from '../search/query';
import { isCountryCode } from './account';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

export const searchInput = z.object({
  q: z.string().max(MAX_QUERY_LENGTH, { error: `Search for at most ${MAX_QUERY_LENGTH} characters.` }),
  country: z
    .string()
    .max(2)
    .optional()
    .transform((s) => (s ? s.toUpperCase() : undefined))
    .refine((s) => s === undefined || isCountryCode(s), { error: 'Choose a country from the list.' }),
  lineageId: z.uuid({ error: 'Choose a lineage from the list.' }).optional(),
});
export type SearchInput = z.input<typeof searchInput>;

/**
 * A limit against floods (security review): at most SEARCHES_PER_WINDOW searches per client in
 * SEARCH_WINDOW_MS, counted in this process (the web runs as one replica, plan §6.4) by the
 * client's ip_hmac, never the address itself. Typing in the palette sends one search per pause.
 */
export const SEARCHES_PER_WINDOW = 40;
export const SEARCH_WINDOW_MS = 10_000;
const recentSearches = new Map<string, number[]>();

function checkSearchRate(meta: RequestMeta | undefined, now = Date.now()): void {
  // A request always has a client address (next start sets X-Forwarded-For to the socket's); a
  // call without one (in-process, the tests) is not counted rather than sharing one bucket.
  const client = meta?.ipHmac;
  if (!client) return;
  const since = now - SEARCH_WINDOW_MS;
  const times = (recentSearches.get(client) ?? []).filter((t) => t > since);
  if (times.length >= SEARCHES_PER_WINDOW) throw new ServiceError('TOO_MANY_REQUESTS', 'Too many searches at once. Wait a few seconds and try again.');
  times.push(now);
  recentSearches.set(client, times);
  // Forget idle clients, so the map stays small.
  if (recentSearches.size > 10_000) {
    for (const [key, list] of recentSearches) if (list.every((t) => t <= since)) recentSearches.delete(key);
  }
}

/** search.query: grouped public results; an empty query answers with empty groups. */
export async function searchQuery(_principal: Principal | null, raw: unknown, meta?: RequestMeta): Promise<SearchResultDto> {
  const parsed = searchInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'q')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the search.', fields);
  }
  const query = parsed.data.q.normalize('NFC').trim();
  const forms = queryForms(query);
  if (forms.length > 0) checkSearchRate(meta);
  if (forms.length === 0) return toPublicSearchResult({ query, people: [], schools: [], lineages: [] });
  const filters = { countryCode: parsed.data.country ?? null, lineageId: parsed.data.lineageId ?? null };
  const result = await getDb().transaction(async (tx) => {
    await setThresholds(tx);
    const people = await searchPeople(tx, forms, filters);
    const schools = await searchSchools(tx, forms, filters);
    const lineages = await searchLineages(tx, forms, filters);
    return { query, people, schools, lineages };
  });
  return toPublicSearchResult(result);
}
