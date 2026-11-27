// Tests only: settle the naming requests that wait (review 2026-11-13, ADR 0088), as the named
// account (pending) or the archive team (in review) would, through the services themselves.

import { sql } from 'drizzle-orm';

import { getDb } from '../db';
import { answerNaming, reviewNaming } from './naming';
import { createUser, meta, principalOf } from './relationships.test-support';

/**
 * Accepts (or, with `accept: false`, declines) the waiting requests, optionally only of one kind or
 * one organization; returns how many it settled.
 */
export async function settleNaming(opts: { accept?: boolean; kind?: string; organizationId?: string } = {}): Promise<number> {
  const accept = opts.accept ?? true;
  const filters = [sql`true`];
  if (opts.kind) filters.push(sql`r.kind = ${opts.kind}`);
  if (opts.organizationId) filters.push(sql`r.organization_id = ${opts.organizationId}::uuid`);
  const { rows } = await getDb().execute<{ id: string; status: string; answerer: string | null }>(sql`
    SELECT r.id, r.status,
           coalesce((SELECT p.claimed_by_user_id FROM person p WHERE p.id = r.person_id),
                    (SELECT a.user_id FROM organization_admin a
                      WHERE a.organization_id = r.organization_id AND r.kind = 'entry_issuer' AND a.revoked_at IS NULL
                      ORDER BY a.created_at LIMIT 1),
                    (SELECT u.id FROM auth_user u WHERE lower(u.email) = r.email)) AS answerer
      FROM naming_request r WHERE ${sql.join(filters, sql` AND `)} ORDER BY r.created_at, r.id`);
  let settled = 0;
  let archivist: ReturnType<typeof principalOf> | null = null;
  for (const r of rows) {
    if (r.status === 'in_review') {
      archivist ??= principalOf(await createUser('naming-archivist', 'archivist'), 'archivist');
      await reviewNaming(archivist, { id: r.id, approve: accept }, meta);
      settled += 1;
    } else if (r.answerer) {
      const [u] = (await getDb().execute<{ email: string }>(sql`SELECT email FROM auth_user WHERE id = ${r.answerer}::uuid`)).rows;
      await answerNaming(principalOf({ id: r.answerer, email: u!.email }), { id: r.id, accept }, meta);
      settled += 1;
    }
  }
  return settled;
}

/** The current membership of a person in an organization (after a request was accepted). */
export async function membershipIdOf(organizationId: string, personId: string): Promise<string> {
  const { rows } = await getDb().execute<{ id: string }>(sql`
    SELECT id FROM organization_membership WHERE organization_id = ${organizationId}::uuid AND person_id = ${personId}::uuid AND ends_on IS NULL`);
  if (!rows[0]) throw new Error('no membership');
  return rows[0].id;
}

/** The active admin row of an account in an organization. */
export async function adminIdOf(organizationId: string, userId: string): Promise<string> {
  const { rows } = await getDb().execute<{ id: string }>(sql`
    SELECT id FROM organization_admin WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL`);
  if (!rows[0]) throw new Error('no admin');
  return rows[0].id;
}

/** A person's id by slug. */
export async function personIdOf(slug: string): Promise<string> {
  const { rows } = await getDb().execute<{ id: string }>(sql`SELECT id FROM person WHERE slug = ${slug}`);
  if (!rows[0]) throw new Error(`no person ${slug}`);
  return rows[0].id;
}
