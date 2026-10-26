// Where the explorer starts (milestone M05; plan §4.3): every lineage with a public root, as a way
// into /explore when no person is in focus yet, and the lineage view's root (plan §4.3: "one
// lineage" starts at its root). A cached public read: app_public_ro, v_public_* only, tagged
// lineage:<id>, person:<root id> and explore-start (plan §6.4): a renamed lineage, a hidden root, and
// any person or relationship that becomes public or stops being public (the counts) drop it.
// DEFAULT D22: a lineage whose root is unknown or not public is not offered here.
// src/server/services/explore-start.int.test.ts holds it to that: hidden people and relationships
// that are not public never change a public number.

import { sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';

import { EXPLORE_START_TAG, lineageTag, personTag, tagCacheEntry } from '../cache';
import { getPublicDb } from '../db';
import { type ExploreStartDto, toPublicExploreStart } from '../dto/explore';
import { failOnce } from '../faults';
import type { RequestMeta } from './context';

interface Row extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  root_id: string;
  root_slug: string;
  root_name: string;
  people: number;
}

async function cachedExploreStart(): Promise<ExploreStartDto> {
  'use cache';
  cacheLife('hours');
  const result = await getPublicDb().execute<Row>(sql`
    SELECT l.lineage_id AS id, l.lineage_slug AS slug, l.lineage_name AS name,
           p.id AS root_id, p.slug AS root_slug, p.display_name AS root_name,
           (SELECT count(*)::int FROM (
              SELECT e2.student_person_id AS pid FROM v_public_edge e2 WHERE e2.lineage_id = l.lineage_id
              UNION SELECT e3.teacher_person_id FROM v_public_edge e3 WHERE e3.lineage_id = l.lineage_id) members) AS people
      FROM (SELECT DISTINCT lineage_id, lineage_slug, lineage_name, lineage_root_person_id FROM v_public_edge
             WHERE lineage_root_person_id IS NOT NULL) l
      JOIN v_public_person p ON p.id = l.lineage_root_person_id
     ORDER BY l.lineage_name, l.lineage_id`);
  const lineages = result.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    people: r.people,
    root: { id: r.root_id, slug: r.root_slug, displayName: r.root_name },
  }));
  tagCacheEntry([EXPLORE_START_TAG, ...lineages.map((l) => lineageTag(l.id)), ...lineages.map((l) => personTag(l.root.id))]);
  return toPublicExploreStart({ lineages });
}

/** lineage.start: the public lineages with their roots, the explorer's starting points. */
export async function exploreStart(meta?: RequestMeta): Promise<ExploreStartDto> {
  // M04's test fault (src/server/faults.ts): the E2E test of /explore's error state.
  failOnce(meta?.testFault, 'lineage-once');
  return cachedExploreStart();
}
