// The lineage card (owner decision 2026-11-18, docs/adr/0045-lineage-card.md): a designed card of a
// member's public routes of descent, from the earliest known teacher down to them, at
// /people/<slug>/card, with a share image and a print page (PDF through the browser).
//
// Only for a public person (v_public_person: consent to publication, ADR 0031, not taken down)
// whose account's plan includes `lineage_card`; for anyone else the answer is NOT_FOUND, the same
// as a missing person (plan §6.4). The routes are the public ones of lineage.paths (v_public_edge,
// both ends public): a teacher whose profile is not public is never on the card. Paying never
// shows anyone.
//
// The answer is the same for every viewer, so it is cached ('use cache', public DTO only). The
// plan can end by date, so the entry lives for minutes, as the school members page (ADR 0044).

import { sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import type { Principal } from '../auth/principal';
import { personTag, tagCacheEntry } from '../cache';
import { getDb, getPublicDb } from '../db';
import { SLUG_PATTERN } from '../db/schema/persons';
import { type LineageCardDto, toPublicLineageCard } from '../dto/public';
import { effectivePlansOf } from '../entitlements/access';
import { feature, type PlanCode } from '../entitlements/plans';
import { failOnce } from '../faults';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { NO_EXTRAS, pathsGraph, readTransaction, withoutRouteIds } from './lineage-graph';

/** Routes of descent a card offers to choose from (the longest is shown first). */
export const LINEAGE_CARD_ROUTES = 10;

export const lineageCardInput = z.object({
  slug: z
    .string()
    .min(1, { error: 'Must be a profile address.' })
    .max(120, { error: 'Must be a profile address.' })
    .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' }),
});
export type LineageCardInput = z.infer<typeof lineageCardInput>;

type CardPersonRow = { id: string; user_id: string | null } & Record<string, unknown>;

/** Whether this plan includes the lineage card (the matrix decides, ADR 0045). */
export function cardIncluded(plan: PlanCode | undefined): boolean {
  return plan !== undefined && feature('lineage_card').values[plan].included;
}

async function cachedLineageCard(slug: string): Promise<LineageCardDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const found = await db.execute<CardPersonRow>(sql`
    SELECT p.id, pe.claimed_by_user_id AS user_id
      FROM v_public_person p
      JOIN person pe ON pe.id = p.id AND pe.deleted_at IS NULL
     WHERE p.slug = ${slug}
     LIMIT 1`);
  const row = found.rows[0];
  if (!row) return null;
  tagCacheEntry([personTag(row.id)]);
  if (!row.user_id) return null;
  const plans = await effectivePlansOf(db, [row.user_id], new Date());
  if (!cardIncluded(plans.get(row.user_id))) return null;
  const graph = await readTransaction(getPublicDb(), (tx) => pathsGraph(tx, { focusId: row.id, limit: LINEAGE_CARD_ROUTES }, NO_EXTRAS));
  // Everyone on a route, so hiding any of them drops the entry (as lineage.paths).
  tagCacheEntry(graph.routePersonIds.map(personTag));
  return toPublicLineageCard({ personId: row.id, slug, paths: withoutRouteIds(graph) });
}

/** people.card: the lineage card of a public person whose plan includes it; NOT_FOUND otherwise. */
export async function lineageCard(_principal: Principal | null, input: LineageCardInput, meta?: RequestMeta): Promise<LineageCardDto> {
  failOnce(meta?.testFault, 'person-once');
  const parsed = lineageCardInput.safeParse(input);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such person.');
  const card = await cachedLineageCard(parsed.data.slug);
  if (!card) throw new ServiceError('NOT_FOUND', 'No such person.');
  return card;
}
