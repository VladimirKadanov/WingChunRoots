// search.query (milestone M07, In scope 3; plan §5.6): people, schools, events and the city named (role replay 2026-11-25, P2-5), organizations (ADR 0051) and lineages by any
// spelling of a name. Open to everyone, signed in or not, and the answer is the same for both:
// only public records (src/server/search/query.ts reads them through the public views) and only
// the public DTO (src/server/dto/search.ts). The query itself is never logged (plan §6.4).

import * as z from 'zod';

import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { type SearchResultDto, toPublicSearchResult } from '../dto/search';
import { foldLatin, MAX_QUERY_LENGTH, queryForms } from '../search/keys';
import { searchEvents, searchLineages, searchOrganizations, searchPeople, searchPlace, searchSchools, setThresholds } from '../search/query';
import { isCountryCode } from './account';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { featuredSearchCards } from './featured-profile';
import { ORGANIZATION_KIND_LABELS } from './organizations';
import { photoOf, publicPhotoRefs } from './photo-refs';

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

export function checkSearchRate(meta: RequestMeta | undefined, now = Date.now()): void {
  // An in-process call (no request: the tests) is not counted. A request whose client address
  // cannot be read (a forged X-Forwarded-For chain without TRUSTED_PROXIES) shares one bucket, so
  // forging the header never turns the limit off.
  if (!meta) return;
  const client = meta.ipHmac ?? 'no-address';
  const since = now - SEARCH_WINDOW_MS;
  const times = (recentSearches.get(client) ?? []).filter((t) => t > since);
  if (times.length >= SEARCHES_PER_WINDOW) throw new ServiceError('TOO_MANY_REQUESTS', 'Too many searches at once. Wait a few seconds and try again.');
  times.push(now);
  // A bounded map: past 10,000 clients it starts again (a flood of addresses cannot make each
  // search scan it, and a reset only forgives searches for one window).
  if (recentSearches.size >= 10_000 && !recentSearches.has(client)) recentSearches.clear();
  recentSearches.set(client, times);
}

/**
 * Role replay 2026-11-25 (P2-5): the group to show before People. A query of two or more words
 * ("hall sofia") whose words all start words of the first school, event, organization or lineage
 * (its name, and the city of a school or an event) while the first person's names do not: that
 * result is what was looked for, whatever its group. When several groups qualify, the name with the
 * fewest words left over wins (an exact name before a longer one).
 */
export function firstGroup(query: string, answer: Pick<SearchResultDto, 'people' | 'schools' | 'events' | 'organizations' | 'lineages'>): SearchResultDto['first'] {
  const words = foldLatin(query).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const covers = (...texts: (string | null | undefined)[]) => {
    const own = texts.flatMap((t) => (t ? foldLatin(t).split(' ') : []));
    return words.every((w) => own.some((o) => o.startsWith(w)));
  };
  const person = answer.people[0];
  if (person && (covers(person.displayName.value) || (person.matched && covers(person.matched.value)))) return null;
  // Of the first results that the words cover, the one with the fewest words of its name left
  // over: "federation north" is the federation of that name before its "… summer camp".
  const extra = (name: string) => foldLatin(name).split(' ').filter((o) => o && !words.some((w) => o.startsWith(w))).length;
  const candidates: { group: NonNullable<SearchResultDto['first']>; extra: number }[] = [];
  if (answer.schools[0] && covers(answer.schools[0].name, answer.schools[0].city)) candidates.push({ group: 'schools', extra: extra(answer.schools[0].name) });
  if (answer.events[0] && covers(answer.events[0].title, answer.events[0].city)) candidates.push({ group: 'events', extra: extra(answer.events[0].title) });
  if (answer.organizations[0] && covers(answer.organizations[0].name)) candidates.push({ group: 'organizations', extra: extra(answer.organizations[0].name) });
  if (answer.lineages[0] && covers(answer.lineages[0].name)) candidates.push({ group: 'lineages', extra: extra(answer.lineages[0].name) });
  // A stable sort: on a tie the order above (schools, events, organizations, lineages) decides.
  candidates.sort((a, b) => a.extra - b.extra);
  if (candidates[0]) return candidates[0].group;
  return null;
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
  if (forms.length === 0) return toPublicSearchResult({ query, people: [], morePeople: false, schools: [], organizations: [], lineages: [], events: [], place: null, first: null });
  const filters = { countryCode: parsed.data.country ?? null, lineageId: parsed.data.lineageId ?? null };
  const result = await getDb().transaction(async (tx) => {
    await setThresholds(tx);
    const people = await searchPeople(tx, forms, filters, query);
    const schools = await searchSchools(tx, forms, filters);
    const organizations = await searchOrganizations(tx, forms, filters);
    const lineages = await searchLineages(tx, forms, filters);
    const events = await searchEvents(tx, forms, filters);
    const place = await searchPlace(tx, forms, filters);
    // M14: each person's public photo (v_public_person: public people only, active photos only).
    const photos = await publicPhotoRefs(tx, people.people.map((p) => p.id));
    // ADR 0047: the rank and school of a featured profile, added after the order is set.
    const cards = await featuredSearchCards(tx, people.people.map((p) => p.id));
    return {
      query,
      people: people.people.map((p) => ({ ...p, photo: photoOf(photos.get(p.id)), rank: cards.get(p.id)?.rank ?? null, school: cards.get(p.id)?.school ?? null })),
      morePeople: people.more,
      schools,
      organizations: organizations.map((o) => ({ ...o, kindLabel: ORGANIZATION_KIND_LABELS[o.kind] })),
      lineages,
      events,
      place,
      first: null as SearchResultDto['first'],
    };
  });
  result.first = firstGroup(query, result);
  return toPublicSearchResult(result);
}
