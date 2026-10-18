// The cached public answers of the lineage API (plan §6.4; milestone M04). Each function here is
// a 'use cache' function: its arguments are the validated input only (no session, cookies or
// roles), it reads through app_public_ro, and it returns a public DTO (src/server/dto/public.ts)
// tagged person:<id> and lineage:<id> (src/server/cache.ts). An answer for a viewer with their
// own involved_only relationships never comes from here (lineage.ts decides).
//
// `null` means "no public person with this id"; it is tagged person:<id> as well, so the entry
// goes when that person becomes public.

import { cacheLife } from 'next/cache';

import { lineageTag, personTag, tagCacheEntry } from '../cache';
import { getPublicDb } from '../db';
import {
  type LineageGraphDto,
  type LineagePathsDto,
  type PersonProfileDto,
  type StudentsPageDto,
  toPublicGraph,
  toPublicPaths,
  toPublicProfile,
  toPublicStudents,
} from '../dto/public';
import {
  ancestorsGraph,
  claimStateOf,
  egoGraph,
  isPublicPerson,
  lineageRefs,
  namesOf,
  NO_EXTRAS,
  pathsGraph,
  personCounts,
  publicProfileRow,
  readTransaction,
  studentPage,
  subtreeGraph,
} from './lineage-graph';

function graphTags(graph: { nodes: { id: string }[]; lineages: { id: string }[] } | null, ...extra: string[]): string[] {
  return [...extra, ...(graph?.nodes.map((n) => personTag(n.id)) ?? []), ...(graph?.lineages.map((l) => lineageTag(l.id)) ?? [])];
}

export async function cachedEgo(input: { focusId: string; up: number; down: number; fanoutLimit: number }): Promise<LineageGraphDto | null> {
  'use cache';
  cacheLife('hours');
  const graph = await readTransaction(getPublicDb(), async (tx) =>
    (await isPublicPerson(tx, input.focusId)) ? egoGraph(tx, input, NO_EXTRAS) : null,
  );
  tagCacheEntry(graphTags(graph, personTag(input.focusId)));
  return graph ? toPublicGraph(graph) : null;
}

export async function cachedAncestors(input: { focusId: string }): Promise<LineageGraphDto | null> {
  'use cache';
  cacheLife('hours');
  const graph = await readTransaction(getPublicDb(), async (tx) =>
    (await isPublicPerson(tx, input.focusId)) ? ancestorsGraph(tx, input.focusId, NO_EXTRAS) : null,
  );
  tagCacheEntry(graphTags(graph, personTag(input.focusId)));
  return graph ? toPublicGraph(graph) : null;
}

export async function cachedSubtree(input: { rootId: string; lineageId: string | null; depth: number }): Promise<LineageGraphDto | null> {
  'use cache';
  cacheLife('hours');
  const graph = await readTransaction(getPublicDb(), async (tx) =>
    (await isPublicPerson(tx, input.rootId)) ? subtreeGraph(tx, input, NO_EXTRAS) : null,
  );
  tagCacheEntry(graphTags(graph, personTag(input.rootId), lineageTag(input.rootId)));
  return graph ? toPublicGraph(graph) : null;
}

export async function cachedPaths(input: { focusId: string; limit: number }): Promise<LineagePathsDto | null> {
  'use cache';
  cacheLife('hours');
  const graph = await readTransaction(getPublicDb(), async (tx) =>
    (await isPublicPerson(tx, input.focusId)) ? pathsGraph(tx, input, NO_EXTRAS) : null,
  );
  tagCacheEntry(graphTags(graph, personTag(input.focusId)));
  return graph ? toPublicPaths(graph) : null;
}

/** The public profile of a public person (isOwn is always false here; lineage.ts sets it). */
export async function cachedProfile(personId: string): Promise<PersonProfileDto | null> {
  'use cache';
  cacheLife('hours');
  const profile = await readTransaction(getPublicDb(), async (tx) => {
    const row = await publicProfileRow(tx, personId);
    if (!row) return null;
    const counts = await personCounts(tx, personId);
    const lineages = await lineageRefs(tx, counts.lineageIds);
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      altNames: namesOf(row.alt_names),
      kind: row.kind,
      lifeStatus: row.life_status,
      claimState: claimStateOf(row.stewardship),
      countryCode: row.country_code,
      cityName: row.city_name,
      bio: row.bio,
      visibility: 'public' as const,
      isOwn: false,
      counts: {
        teachers: counts.teachers,
        students: counts.students,
        descendants: counts.descendants,
        descendantsCapped: counts.descendantsCapped,
      },
      lineages: lineages.sort((a, b) => a.name.localeCompare(b.name, 'en')),
    };
  });
  // lineage:<personId>: the descendant count changes with anything below this person.
  tagCacheEntry([personTag(personId), lineageTag(personId), ...(profile?.lineages.map((l) => lineageTag(l.id)) ?? [])]);
  return profile ? toPublicProfile(profile) : null;
}

/** One page of a public person's public students. */
export async function cachedStudents(input: { personId: string; page: number }): Promise<StudentsPageDto | null> {
  'use cache';
  cacheLife('hours');
  const page = await readTransaction(getPublicDb(), async (tx) =>
    (await isPublicPerson(tx, input.personId)) ? studentPage(tx, input.personId, input.page, NO_EXTRAS) : null,
  );
  tagCacheEntry([
    personTag(input.personId),
    ...(page ? [...page.active, ...page.historical].map((s) => personTag(s.person.id)) : []),
    ...(page?.lineages.map((l) => lineageTag(l.id)) ?? []),
  ]);
  return page ? toPublicStudents(page) : null;
}
