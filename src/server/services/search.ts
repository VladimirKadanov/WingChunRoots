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

/** search.query: grouped public results; an empty query answers with empty groups. */
export async function searchQuery(_principal: Principal | null, raw: unknown): Promise<SearchResultDto> {
  const parsed = searchInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'q')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the search.', fields);
  }
  const query = parsed.data.q.normalize('NFC').trim();
  const forms = queryForms(query);
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
