// The tags of the public cache (src/server/cache.ts), without Next.js: the worker builds and sends
// them too (src/server/jobs/lineage-recompute.ts, POST /api/internal/revalidate; milestone M09).

export const personTag = (personId: string) => `person:${personId}`;
export const lineageTag = (id: string) => `lineage:${id}`;
/** The derived lineage_membership rows of one lineage: the only tag the worker revalidates (M09). */
export const lineageMembershipTag = (lineageId: string) => `lineage-membership:${lineageId}`;
export const EXPLORE_START_TAG = 'explore-start';
/**
 * Every public answer about schools (M11): the finder's list and the school pages. Dropped by any
 * change to a listing, to a Professional Sifu grant (the pin, DEFAULT D08/D18) or to an account type.
 */
export const SCHOOLS_TAG = 'schools';
/**
 * M15: every public answer about organizations: the list and the organization pages. Dropped by an
 * approval, an edit of an approved organization, a member or a school link that changes.
 */
export const ORGANIZATIONS_TAG = 'organizations';
/**
 * M17: every public answer about events: the calendar, the event pages and the "Upcoming events" of
 * a profile or a school. Dropped by any change to an event, and by the changes that decide who or
 * what an event may show (a person, a school or an organization made public or hidden).
 */
export const EVENTS_TAG = 'events';
