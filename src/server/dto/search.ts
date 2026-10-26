// The public DTO of search.query (milestone M07, In scope 3; plan §5.6, §6.4). Results are grouped
// People, Schools and Lineages, and carry only what a public profile already shows: no account,
// no birth date, no school point, never a generated search key. `matched` is the stored name
// (person_name) that the query matched, shown only when it is not the display name; a match on a
// generated pinyin or Jyutping key shows the stored name the key was made from.
//
// z.object() drops every key the schema does not name, so a column added to a query later cannot
// reach a response unless it is added here on purpose.

import * as z from 'zod';

export const searchNameSchema = z.object({
  value: z.string(),
  /** BCP 47 tag, for the `lang` attribute. */
  lang: z.string(),
  /** ISO 15924 script code. */
  script: z.string(),
});
export type SearchNameDto = z.infer<typeof searchNameSchema>;

export const personHitSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  /** The primary display name (Latin script, plan §5.3). */
  displayName: searchNameSchema,
  /** The stored name the query matched, when it is not the display name. */
  matched: searchNameSchema.nullable(),
  /** What tells namesakes apart: city and country, and the lineage they are recorded in. */
  city: z.string().nullable(),
  countryCode: z.string().nullable(),
  lineageName: z.string().nullable(),
  /** At least one verified public relationship. */
  verified: z.boolean(),
});
export type PersonHitDto = z.infer<typeof personHitSchema>;

export const schoolHitSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  city: z.string(),
  countryCode: z.string(),
  /** The public profile of the school's first public instructor, where the result leads until the school pages open (M11). */
  instructor: z.object({ slug: z.string(), displayName: searchNameSchema }).nullable(),
});
export type SchoolHitDto = z.infer<typeof schoolHitSchema>;

export const lineageHitSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  /** The public root of the lineage, whose list view the result opens. */
  root: z.object({ slug: z.string(), displayName: searchNameSchema }),
});
export type LineageHitDto = z.infer<typeof lineageHitSchema>;

export const searchResultSchema = z.object({
  /** The query as the search read it (trimmed, NFC). */
  query: z.string(),
  people: z.array(personHitSchema),
  /** True when more people match than `people` lists (at most 20): the query should be longer. */
  morePeople: z.boolean(),
  schools: z.array(schoolHitSchema),
  lineages: z.array(lineageHitSchema),
});
export type SearchResultDto = z.infer<typeof searchResultSchema>;

/** The only way a search answer leaves the service: through the schema, which strips anything else. */
export function toPublicSearchResult(value: SearchResultDto): SearchResultDto {
  return searchResultSchema.parse(value);
}
