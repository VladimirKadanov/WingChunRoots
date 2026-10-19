// The separate source of the signed-in participant's own relationships (plan §6.4, DEFAULT D03;
// milestone M04). A pending request, a relationship under review or one whose other end is not
// public is visible only to the people involved: the student and the teacher of that
// relationship. This module reads them from app_rw for the signed-in account's own person only,
// per request, and its result never enters a 'use cache' function.
//
// Staff (reviewers) see these in the review queue from M09; the public pages of M04 give them no
// extra visibility.

import { sql } from 'drizzle-orm';

import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { ACTIVE_RELATIONSHIP_STATUSES } from '../db/schema/common';
import type { PublicName, PublicPeriod } from '../db/schema/views';
import type { RelationshipStatusDto } from '../dto/public';
import {
  type Executor,
  namesOf,
  NO_EXTRAS,
  type OwnEdge,
  type OwnNode,
  type ReadDeadline,
  readDeadline,
  readTransaction,
  type ViewerExtras,
} from './lineage-graph';

const ACTIVE = sql.raw(ACTIVE_RELATIONSHIP_STATUSES.map((s) => `'${s}'`).join(', '));

async function rows<T>(ex: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await ex.execute(query)).rows as T[];
}

export interface Viewer {
  extras: ViewerExtras;
  /** The viewer's own person is not public (it is shown to them only). */
  ownPersonHidden: boolean;
}

export const ANONYMOUS_VIEWER: Viewer = { extras: NO_EXTRAS, ownPersonHidden: false };

/** True when the answer for this viewer differs from the public one, so it must not be cached. */
export function isPersonalised(viewer: Viewer): boolean {
  return viewer.extras.edges.length > 0 || viewer.ownPersonHidden;
}

/** True when the viewer may see this person although it is not public (their own, or the other end of an own edge). */
export function mayViewHidden(viewer: Viewer, personId: string): boolean {
  return viewer.extras.nodes[personId] !== undefined;
}

/**
 * The viewer's own person, their active relationships that v_public_edge leaves out, and the
 * hidden people at the other end of those. Anonymous, or an account without a person: nothing.
 */
export async function loadViewer(principal: Principal | null, deadline: ReadDeadline = readDeadline()): Promise<Viewer> {
  if (!principal) return ANONYMOUS_VIEWER;
  return readTransaction(getDb(), async (tx) => {
    const [own] = await rows<{ id: string; is_public: boolean }>(
      tx,
      sql`SELECT p.id::text AS id, EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = p.id) AS is_public
            FROM person p WHERE p.claimed_by_user_id = ${principal.user.id}::uuid AND p.deleted_at IS NULL`,
    );
    if (!own) return ANONYMOUS_VIEWER;

    const edgeRows = await rows<{
      id: string;
      teacher_id: string;
      student_id: string;
      lineage_id: string;
      lineage_slug: string;
      lineage_name: string;
      lineage_root_person_id: string | null;
      status: RelationshipStatusDto;
      is_display_primary: boolean;
      periods: PublicPeriod[];
      requested_by_viewer: boolean;
    }>(
      tx,
      sql`
SELECT r.id::text AS id, r.teacher_person_id::text AS teacher_id, r.student_person_id::text AS student_id,
       r.requested_by_user_id IS NOT DISTINCT FROM ${principal.user.id}::uuid AS requested_by_viewer,
       l.id::text AS lineage_id, l.slug AS lineage_slug, l.name AS lineage_name,
       (SELECT vp.id::text FROM v_public_person vp WHERE vp.id = l.root_person_id) AS lineage_root_person_id,
       r.status, r.is_display_primary,
       COALESCE(
         (SELECT jsonb_agg(
                   jsonb_build_object('startsOn', tp.starts_on, 'endsOn', tp.ends_on,
                                      'precision', tp.precision, 'ongoing', tp.ongoing)
                   ORDER BY tp.sort_order, tp.starts_on NULLS FIRST, tp.id)
            FROM training_period tp WHERE tp.relationship_id = r.id),
         '[]'::jsonb) AS periods
  FROM teaching_relationship r
  JOIN lineage l ON l.id = r.lineage_id AND l.deleted_at IS NULL
  JOIN person t ON t.id = r.teacher_person_id AND t.deleted_at IS NULL
  JOIN person s ON s.id = r.student_person_id AND s.deleted_at IS NULL
 WHERE (r.teacher_person_id = ${own.id}::uuid OR r.student_person_id = ${own.id}::uuid)
   AND r.status IN (${ACTIVE})
   AND NOT EXISTS (SELECT 1 FROM v_public_edge pe WHERE pe.id = r.id)
 ORDER BY r.created_at, r.id`,
    );

    // The people the viewer may see although they are not public: their own person and the other
    // end of each own edge (with a primary name, as the public views require).
    const involved = [...new Set([own.id, ...edgeRows.flatMap((e) => [e.teacher_id, e.student_id])])];
    const nodeRows = await rows<{
      id: string;
      slug: string;
      kind: string;
      life_status: string;
      stewardship: string;
      country_code: string | null;
      city_name: string | null;
      display_name: string;
      alt_names: PublicName[];
      bio: string | null;
      is_public: boolean;
      created_by_viewer: boolean;
    }>(
      tx,
      sql`
SELECT p.id::text AS id, p.slug, p.kind, p.life_status, p.stewardship, p.country_code,
       p.created_by_user_id IS NOT DISTINCT FROM ${principal.user.id}::uuid AS created_by_viewer,
       (SELECT pl.name FROM place pl WHERE pl.id = p.place_id) AS city_name,
       pn.value AS display_name,
       COALESCE(
         (SELECT jsonb_agg(
                   jsonb_build_object('value', n.value, 'script', n.script, 'lang', n.lang,
                                      'kind', n.kind, 'romanization', n.romanization)
                   ORDER BY n.sort_order, n.id)
            FROM person_name n WHERE n.person_id = p.id AND NOT n.is_primary),
         '[]'::jsonb) AS alt_names,
       (SELECT b.body FROM person_bio b WHERE b.person_id = p.id ORDER BY (b.lang = 'en') DESC, b.lang LIMIT 1) AS bio,
       EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = p.id) AS is_public
  FROM person p
  JOIN person_name pn ON pn.person_id = p.id AND pn.is_primary
 WHERE p.id = ANY(${`{${involved.join(',')}}`}::uuid[]) AND p.deleted_at IS NULL`,
    );
    // The full hidden record of the other end only when its person has answered: plan §6.4 keeps a
    // record that is not public to the people it concerns. A request the viewer filed and nobody
    // has answered yet (pending_teacher, awaiting_claim) shows only the names that label the
    // edge, unless the viewer wrote that record themselves.
    const answered = new Set<string>();
    for (const e of edgeRows) {
      const unanswered = (e.status === 'pending_teacher' || e.status === 'awaiting_claim') && e.requested_by_viewer;
      if (!unanswered) answered.add(e.teacher_id === own.id ? e.student_id : e.teacher_id);
    }
    const nodes: Record<string, OwnNode> = {};
    for (const n of nodeRows) {
      if (n.is_public) continue;
      const full = n.id === own.id || n.created_by_viewer || answered.has(n.id);
      nodes[n.id] = {
        id: n.id,
        slug: n.slug,
        displayName: n.display_name,
        altNames: namesOf(n.alt_names),
        kind: n.kind,
        lifeStatus: full ? n.life_status : 'unknown',
        stewardship: n.stewardship,
        countryCode: full ? n.country_code : null,
        cityName: full ? n.city_name : null,
        bio: full ? n.bio : null,
        limited: !full,
      };
    }
    // An edge whose other end has no primary name cannot be drawn (the public views require one).
    const drawable = new Set(nodeRows.map((n) => n.id));
    const edges: OwnEdge[] = edgeRows
      .filter((e) => drawable.has(e.teacher_id) && drawable.has(e.student_id))
      .map((e) => ({
        id: e.id,
        teacherId: e.teacher_id,
        studentId: e.student_id,
        lineage: { id: e.lineage_id, slug: e.lineage_slug, name: e.lineage_name, rootPersonId: e.lineage_root_person_id },
        status: e.status,
        isDisplayPrimary: e.is_display_primary,
        periods: e.periods,
      }));
    return { extras: { personId: own.id, edges, nodes }, ownPersonHidden: !own.is_public };
  }, deadline);
}
