// The public DTO of lineage.home (journey review 2026-11-26, P1-4; ADR 0078): one line of a public
// lineage, from its recorded root down, for the home page's living line. Only what the public
// views already show (plan §6.4): names, city, life status, the year training began and the link's
// public state.

import * as z from 'zod';

export const homeLineSchema = z.object({
  lineage: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
  /** From the root down; empty when no lineage has a public root with public students. */
  people: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      displayName: z.string(),
      /** The first name in another script, with its language tag. */
      original: z.object({ text: z.string(), lang: z.string() }).nullable(),
      city: z.string().nullable(),
      /** The year this person began training with the one above (null for the root, or not recorded). */
      startYear: z.number().int().nullable(),
      living: z.boolean(),
      /** Public students in this lineage. */
      students: z.number().int(),
    }),
  ),
  /** The link from each person to the next: its public state and, for an archive link, its certainty. */
  links: z.array(
    z.object({
      status: z.enum(['verified', 'in_arbitration']),
      certainty: z.enum(['documented', 'traditional', 'disputed']).nullable(),
    }),
  ),
});
export type HomeLineDto = z.infer<typeof homeLineSchema>;

/** The only way the answer leaves the service: through the schema, which strips anything else. */
export function toPublicHomeLine(value: HomeLineDto): HomeLineDto {
  return homeLineSchema.parse(value);
}
