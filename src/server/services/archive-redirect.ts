// Journey review P2-10 (ADR 0086): the address of an archive record that was merged into another
// one. Its own small module, so that src/proxy.ts loads only this read and not the merge itself.

import { sql } from 'drizzle-orm';

import { getDb } from '../db';

/**
 * The address a merged record now answers at (person_redirect), only when the kept record is public
 * (v_public_person): src/proxy.ts sends /people/<old> there with a permanent redirect.
 */
export async function mergedRecordTarget(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) return null;
  const rows = await getDb().execute<{ slug: string }>(sql`
    SELECT v.slug FROM person_redirect r JOIN v_public_person v ON v.id = r.person_id WHERE r.from_slug = ${slug} LIMIT 1`);
  return rows.rows[0]?.slug ?? null;
}
