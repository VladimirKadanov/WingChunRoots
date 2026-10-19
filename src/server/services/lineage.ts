// The lineage service (plan §6.3, §6.4, §4.10; milestone M04): the reads behind lineage.ego,
// lineage.ancestors, lineage.subtree, lineage.paths, people.get and people.students. Every read
// is public, and this module decides what each viewer may see:
//
//   - an anonymous visitor, or an account without own involved_only relationships, gets the
//     public answer from lineage-public.ts ('use cache', app_public_ro, v_public_* only);
//   - a signed-in participant with own pending, under-review or otherwise non-public
//     relationships (DEFAULT D03) gets an answer computed for them, never cached, with those
//     relationships marked involved_only; counts stay public-only;
//   - a person the views leave out is "not found" (404, the same answer as a missing slug or id)
//     unless the viewer is that person or at the other end of one of their relationships.
//
// The test fault switch (src/server/faults.ts) can make one lineage read, or one profile read, fail.

import * as z from 'zod';

import type { Principal } from '../auth/principal';
import { getPublicDb } from '../db';
import { SLUG_PATTERN } from '../db/schema/persons';
import {
  type LineageGraphDto,
  type LineagePathsDto,
  type PersonProfileDto,
  type StudentsPageDto,
  toPublicProfile,
} from '../dto/public';
import { failOnce } from '../faults';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import {
  ancestorsGraph,
  egoGraph,
  type Executor,
  isPublicPerson,
  lineageRefs,
  MAX_DOWN,
  MAX_FANOUT,
  MAX_PATHS,
  MAX_SUBTREE_DEPTH,
  MAX_UP,
  pathsGraph,
  personCounts,
  publicPersonIdBySlug,
  readDeadline,
  type ReadDeadline,
  readTransaction,
  studentPage,
  STUDENTS_PAGE_SIZE,
  subtreeGraph,
  withoutRouteIds,
} from './lineage-graph';
import { cachedAncestors, cachedEgo, cachedPaths, cachedProfile, cachedStudents, cachedSubtree } from './lineage-public';
import { isPersonalised, loadViewer, mayViewHidden, type Viewer } from './lineage-viewer';

// --- Input: every number bounded and written as digits only ---------------------------------

const personId = z.uuid({ error: 'Must be a person id (a UUID).' });
/**
 * A whole number from `min` to `max`: a JSON number, or (a query string arrives as text) up to
 * four decimal digits. An empty value, a sign, an exponent or a hex string is an error, never a
 * silent 0 or a number that only z.coerce would read.
 */
const bounded = (min: number, max: number, fallback: number) => {
  const error = `Must be a whole number from ${min} to ${max}.`;
  const number = z.number({ error }).int({ error }).min(min, { error }).max(max, { error });
  return z.union([number, z.string().regex(/^\d{1,4}$/, { error }).transform(Number).pipe(number)], { error }).default(fallback);
};

export const egoInput = z.object({
  focusId: personId,
  /** Generations of teachers; 16 covers every recorded generation. */
  up: bounded(0, MAX_UP, MAX_UP),
  /** Generations of students. */
  down: bounded(0, MAX_DOWN, 2),
  /** Students shown per person; the rest are counted in hiddenCounts. */
  fanoutLimit: bounded(1, MAX_FANOUT, 50),
});
export type EgoInput = z.infer<typeof egoInput>;

export const ancestorsInput = z.object({ focusId: personId });
export type AncestorsInput = z.infer<typeof ancestorsInput>;

export const subtreeInput = z.object({
  rootId: personId,
  lineageId: z.uuid({ error: 'Must be a lineage id (a UUID).' }).optional(),
  depth: bounded(1, MAX_SUBTREE_DEPTH, 3),
});
export type SubtreeInput = z.infer<typeof subtreeInput>;

export const pathsInput = z.object({
  focusId: personId,
  limit: bounded(1, MAX_PATHS, 50),
});
export type PathsInput = z.infer<typeof pathsInput>;

const slug = z
  .string()
  .min(1, { error: 'Must be a profile address.' })
  .max(120, { error: 'Must be a profile address.' })
  .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' });

export const personInput = z.object({ slug });
export type PersonInput = z.infer<typeof personInput>;

export const studentsInput = z.object({
  slug,
  page: bounded(1, 1000, 1),
  /** Students per page; the profile asks for 12. */
  pageSize: bounded(1, STUDENTS_PAGE_SIZE, STUDENTS_PAGE_SIZE),
  /** 'name' (the list view) or 'seniority' (earliest dated training first, the profile). */
  order: z.enum(['name', 'seniority'], { error: "Must be 'name' or 'seniority'." }).default('name'),
});
export type StudentsInput = z.infer<typeof studentsInput>;

// --- Helpers -----------------------------------------------------------------------------------

/** One answer for a missing and a hidden person: nothing tells them apart (plan §6.4). */
function notFound(): ServiceError {
  return new ServiceError('NOT_FOUND', 'No such person.');
}

async function visibleTo(viewer: Viewer, tx: Executor, id: string): Promise<boolean> {
  return mayViewHidden(viewer, id) || (await isPublicPerson(tx, id));
}

/** The id behind a slug for this viewer: a public person, or a hidden one they may see. */
async function resolveSlug(viewer: Viewer, value: string, deadline: ReadDeadline): Promise<string | null> {
  const id = await readTransaction(getPublicDb(), (tx) => publicPersonIdBySlug(tx, value), deadline);
  if (id) return id;
  return Object.values(viewer.extras.nodes).find((n) => n.slug === value)?.id ?? null;
}

// --- lineage.* ---------------------------------------------------------------------------------

export async function lineageEgo(principal: Principal | null, input: EgoInput, meta?: RequestMeta): Promise<LineageGraphDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const args = { focusId: input.focusId, up: input.up, down: input.down, fanoutLimit: input.fanoutLimit };
  // One budget for the procedure's own reads (a cached read has its own, lineage-graph.ts).
  const deadline = readDeadline();
  const viewer = await loadViewer(principal, deadline);
  const graph = isPersonalised(viewer)
    ? await readTransaction(
        getPublicDb(),
        async (tx) => ((await visibleTo(viewer, tx, args.focusId)) ? egoGraph(tx, args, viewer.extras) : null),
        deadline,
      )
    : await cachedEgo(args);
  if (!graph) throw notFound();
  return graph;
}

export async function lineageAncestors(principal: Principal | null, input: AncestorsInput, meta?: RequestMeta): Promise<LineageGraphDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const deadline = readDeadline();
  const viewer = await loadViewer(principal, deadline);
  const graph = isPersonalised(viewer)
    ? await readTransaction(
        getPublicDb(),
        async (tx) => ((await visibleTo(viewer, tx, input.focusId)) ? ancestorsGraph(tx, input.focusId, viewer.extras) : null),
        deadline,
      )
    : await cachedAncestors({ focusId: input.focusId });
  if (!graph) throw notFound();
  return graph;
}

export async function lineageSubtree(principal: Principal | null, input: SubtreeInput, meta?: RequestMeta): Promise<LineageGraphDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const args = { rootId: input.rootId, lineageId: input.lineageId ?? null, depth: input.depth };
  const deadline = readDeadline();
  const viewer = await loadViewer(principal, deadline);
  const graph = isPersonalised(viewer)
    ? await readTransaction(
        getPublicDb(),
        async (tx) => ((await visibleTo(viewer, tx, args.rootId)) ? subtreeGraph(tx, args, viewer.extras) : null),
        deadline,
      )
    : await cachedSubtree(args);
  if (!graph) throw notFound();
  return graph;
}

export async function lineagePaths(principal: Principal | null, input: PathsInput, meta?: RequestMeta): Promise<LineagePathsDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const args = { focusId: input.focusId, limit: input.limit };
  const deadline = readDeadline();
  const viewer = await loadViewer(principal, deadline);
  const graph = isPersonalised(viewer)
    ? await readTransaction(
        getPublicDb(),
        async (tx) => ((await visibleTo(viewer, tx, args.focusId)) ? withoutRouteIds(await pathsGraph(tx, args, viewer.extras)) : null),
        deadline,
      )
    : await cachedPaths(args);
  if (!graph) throw notFound();
  return graph;
}

// --- people.* ----------------------------------------------------------------------------------

/** The profile header of /people/[slug]: names, life status, place (city level), counts, lineages. */
export async function personProfile(principal: Principal | null, input: PersonInput, meta?: RequestMeta): Promise<PersonProfileDto> {
  failOnce(meta?.testFault, 'person-once');
  const deadline = readDeadline();
  const viewer = await loadViewer(principal, deadline);
  const id = await resolveSlug(viewer, input.slug, deadline);
  if (!id) throw notFound();
  const hidden = viewer.extras.nodes[id];
  if (!hidden) {
    const profile = await cachedProfile(id);
    if (!profile) throw notFound();
    return { ...profile, isOwn: viewer.extras.personId === id };
  }
  // A hidden person the viewer may see (their own, or the other end of their request): built
  // for this viewer only. Counts stay public-only, so they are 0 until a relationship is public.
  const { counts, refs } = await readTransaction(
    getPublicDb(),
    async (tx) => {
      const c = await personCounts(tx, id);
      return { counts: c, refs: await lineageRefs(tx, c.lineageIds) };
    },
    deadline,
  );
  const own = viewer.extras.edges.filter((e) => e.teacherId === id || e.studentId === id);
  const lineages = new Map(own.map((e) => [e.lineage.id, e.lineage]));
  for (const l of refs) lineages.set(l.id, l);
  return toPublicProfile({
    id,
    slug: hidden.slug,
    displayName: hidden.displayName,
    altNames: hidden.altNames,
    kind: hidden.kind,
    lifeStatus: hidden.lifeStatus,
    claimState: hidden.stewardship === 'self' ? 'claimed' : hidden.stewardship === 'platform' ? 'platform' : 'unclaimed',
    countryCode: hidden.countryCode,
    cityName: hidden.cityName,
    bio: hidden.bio,
    visibility: 'involved_only',
    isOwn: viewer.extras.personId === id,
    limited: hidden.limited,
    counts: {
      teachers: counts.teachers,
      students: counts.students,
      descendants: counts.descendants,
      descendantsCapped: counts.descendantsCapped,
    },
    lineages: [...lineages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
  });
}

/**
 * Whether /people/<slug> (and its list view) shows a person to this viewer: a public person, or a
 * hidden one the viewer may see, the same rule as people.get. src/proxy.ts asks before the page
 * streams, so a missing, malformed or hidden address answers 404 (plan §6.4: one answer for all
 * three). The session is read only when the slug is not public (`principalOf` is called lazily).
 */
export async function personPageVisible(principalOf: () => Promise<Principal | null>, input: { slug: string }): Promise<boolean> {
  const parsed = personInput.safeParse(input);
  if (!parsed.success) return false;
  const deadline = readDeadline();
  if (await readTransaction(getPublicDb(), (tx) => publicPersonIdBySlug(tx, parsed.data.slug), deadline)) return true;
  const principal = await principalOf();
  if (!principal) return false;
  const viewer = await loadViewer(principal, deadline);
  return Object.values(viewer.extras.nodes).some((n) => n.slug === parsed.data.slug);
}

/** A page of a person's students for the list view (plan §4.10). */
export async function personStudents(principal: Principal | null, input: StudentsInput, meta?: RequestMeta): Promise<StudentsPageDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const deadline = readDeadline();
  const viewer = await loadViewer(principal, deadline);
  const id = await resolveSlug(viewer, input.slug, deadline);
  if (!id) throw notFound();
  const options = { page: input.page, pageSize: input.pageSize, order: input.order };
  const page = isPersonalised(viewer)
    ? await readTransaction(getPublicDb(), (tx) => studentPage(tx, id, options, viewer.extras), deadline)
    : await cachedStudents({ personId: id, ...options });
  if (!page) throw notFound();
  return page;
}
