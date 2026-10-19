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
  readTransaction,
  studentPage,
  subtreeGraph,
} from './lineage-graph';
import { cachedAncestors, cachedEgo, cachedPaths, cachedProfile, cachedStudents, cachedSubtree } from './lineage-public';
import { isPersonalised, loadViewer, mayViewHidden, type Viewer } from './lineage-viewer';

// --- Input: every number bounded (query strings arrive as text, hence coerce) ---------------

const personId = z.uuid({ error: 'Must be a person id (a UUID).' });
const bounded = (min: number, max: number, fallback: number) =>
  z.coerce
    .number({ error: `Must be a whole number from ${min} to ${max}.` })
    .int({ error: `Must be a whole number from ${min} to ${max}.` })
    .min(min, { error: `Must be a whole number from ${min} to ${max}.` })
    .max(max, { error: `Must be a whole number from ${min} to ${max}.` })
    .default(fallback);

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

export const studentsInput = z.object({ slug, page: bounded(1, 1000, 1) });
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
async function resolveSlug(viewer: Viewer, value: string): Promise<string | null> {
  const id = await readTransaction(getPublicDb(), (tx) => publicPersonIdBySlug(tx, value));
  if (id) return id;
  return Object.values(viewer.extras.nodes).find((n) => n.slug === value)?.id ?? null;
}

// --- lineage.* ---------------------------------------------------------------------------------

export async function lineageEgo(principal: Principal | null, input: EgoInput, meta?: RequestMeta): Promise<LineageGraphDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const args = { focusId: input.focusId, up: input.up, down: input.down, fanoutLimit: input.fanoutLimit };
  const viewer = await loadViewer(principal);
  const graph = isPersonalised(viewer)
    ? await readTransaction(getPublicDb(), async (tx) =>
        (await visibleTo(viewer, tx, args.focusId)) ? egoGraph(tx, args, viewer.extras) : null,
      )
    : await cachedEgo(args);
  if (!graph) throw notFound();
  return graph;
}

export async function lineageAncestors(principal: Principal | null, input: AncestorsInput, meta?: RequestMeta): Promise<LineageGraphDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const viewer = await loadViewer(principal);
  const graph = isPersonalised(viewer)
    ? await readTransaction(getPublicDb(), async (tx) =>
        (await visibleTo(viewer, tx, input.focusId)) ? ancestorsGraph(tx, input.focusId, viewer.extras) : null,
      )
    : await cachedAncestors({ focusId: input.focusId });
  if (!graph) throw notFound();
  return graph;
}

export async function lineageSubtree(principal: Principal | null, input: SubtreeInput, meta?: RequestMeta): Promise<LineageGraphDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const args = { rootId: input.rootId, lineageId: input.lineageId ?? null, depth: input.depth };
  const viewer = await loadViewer(principal);
  const graph = isPersonalised(viewer)
    ? await readTransaction(getPublicDb(), async (tx) =>
        (await visibleTo(viewer, tx, args.rootId)) ? subtreeGraph(tx, args, viewer.extras) : null,
      )
    : await cachedSubtree(args);
  if (!graph) throw notFound();
  return graph;
}

export async function lineagePaths(principal: Principal | null, input: PathsInput, meta?: RequestMeta): Promise<LineagePathsDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const args = { focusId: input.focusId, limit: input.limit };
  const viewer = await loadViewer(principal);
  const graph = isPersonalised(viewer)
    ? await readTransaction(getPublicDb(), async (tx) =>
        (await visibleTo(viewer, tx, args.focusId)) ? pathsGraph(tx, args, viewer.extras) : null,
      )
    : await cachedPaths(args);
  if (!graph) throw notFound();
  return graph;
}

// --- people.* ----------------------------------------------------------------------------------

/** The profile header of /people/[slug]: names, life status, place (city level), counts, lineages. */
export async function personProfile(principal: Principal | null, input: PersonInput, meta?: RequestMeta): Promise<PersonProfileDto> {
  failOnce(meta?.testFault, 'person-once');
  const viewer = await loadViewer(principal);
  const id = await resolveSlug(viewer, input.slug);
  if (!id) throw notFound();
  const hidden = viewer.extras.nodes[id];
  if (!hidden) {
    const profile = await cachedProfile(id);
    if (!profile) throw notFound();
    return { ...profile, isOwn: viewer.extras.personId === id };
  }
  // A hidden person the viewer may see (their own, or the other end of their request): built
  // for this viewer only. Counts stay public-only, so they are 0 until a relationship is public.
  const counts = await readTransaction(getPublicDb(), (tx) => personCounts(tx, id));
  const own = viewer.extras.edges.filter((e) => e.teacherId === id || e.studentId === id);
  const lineages = new Map(own.map((e) => [e.lineage.id, e.lineage]));
  for (const l of await readTransaction(getPublicDb(), (tx) => lineageRefs(tx, counts.lineageIds))) lineages.set(l.id, l);
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
    counts: {
      teachers: counts.teachers,
      students: counts.students,
      descendants: counts.descendants,
      descendantsCapped: counts.descendantsCapped,
    },
    lineages: [...lineages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
  });
}

/** A page of a person's students for the list view (plan §4.10). */
export async function personStudents(principal: Principal | null, input: StudentsInput, meta?: RequestMeta): Promise<StudentsPageDto> {
  failOnce(meta?.testFault, 'lineage-once');
  const viewer = await loadViewer(principal);
  const id = await resolveSlug(viewer, input.slug);
  if (!id) throw notFound();
  const page = isPersonalised(viewer)
    ? await readTransaction(getPublicDb(), (tx) => studentPage(tx, id, input.page, viewer.extras))
    : await cachedStudents({ personId: id, page: input.page });
  if (!page) throw notFound();
  return page;
}
