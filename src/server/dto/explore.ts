// The public DTO of lineage.start (milestone M05): the lineages the explorer can start from, each
// with its public root. Only what the public views already show (plan §6.4).

import * as z from 'zod';

export const exploreStartSchema = z.object({
  lineages: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      name: z.string(),
      /** Public people with a public relationship in this lineage. */
      people: z.number().int(),
      /** Journey review P2-10 (ADR 0086): the shared teachers before the branches split, listed first. */
      commonRoots: z.boolean(),
      root: z.object({ id: z.uuid(), slug: z.string(), displayName: z.string() }),
    }),
  ),
});
export type ExploreStartDto = z.infer<typeof exploreStartSchema>;

/** The only way the answer leaves the service: through the schema, which strips anything else. */
export function toPublicExploreStart(value: ExploreStartDto): ExploreStartDto {
  return exploreStartSchema.parse(value);
}
