// Writing search keys (milestone M07, In scope 2): a person's keys are replaced whenever its names
// change, in the transaction of the change (onboarding, profile.update), and the job
// `search.keys.rebuild` (src/server/jobs) writes them for every person at once: the demo data after
// `pnpm db:seed`, and existing records after a change to the rules in ./keys.ts.
//
// Nothing here logs a name or a key (plan §6.4): only counts.

import { asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db';
import { person, personName, personNameKey } from '../db/schema';
import type { Executor } from '../entitlements/access';
import { keysForName } from './keys';

type NameRow = Pick<typeof personName.$inferSelect, 'id' | 'personId' | 'value' | 'script' | 'lang' | 'kind' | 'romanization' | 'isPrimary'>;

/** The key rows of these names (several names may give the same key: each keeps its own row). */
function keyRows(names: readonly NameRow[]): (typeof personNameKey.$inferInsert)[] {
  return names.flatMap((name) =>
    keysForName(name).map((k) => ({
      personId: name.personId,
      personNameId: name.id,
      key: k.key,
      keyKind: k.keyKind,
      source: k.source,
      isPrimary: name.isPrimary,
    })),
  );
}

const NAME_COLUMNS = {
  id: personName.id,
  personId: personName.personId,
  value: personName.value,
  script: personName.script,
  lang: personName.lang,
  kind: personName.kind,
  romanization: personName.romanization,
  isPrimary: personName.isPrimary,
};

/** Replaces the search keys of one person with those of its current names. Returns the number written. */
export async function writePersonKeys(db: Executor, personId: string): Promise<number> {
  const names = await db.select(NAME_COLUMNS).from(personName).where(eq(personName.personId, personId));
  await db.delete(personNameKey).where(eq(personNameKey.personId, personId));
  const rows = keyRows(names);
  if (rows.length > 0) await db.insert(personNameKey).values(rows);
  return rows.length;
}

const BATCH = 200;
const INSERT_CHUNK = 1000;

export interface RebuildResult {
  persons: number;
  keys: number;
}

/**
 * Rewrites the keys of every person, BATCH people per transaction (a long single transaction
 * would hold locks on the whole table). A person whose names change meanwhile is rewritten by its
 * own save as well, so the last writer leaves the current keys either way.
 */
export async function rebuildAllKeys(db: Database): Promise<RebuildResult> {
  const ids = (await db.select({ id: person.id }).from(person).orderBy(asc(person.id))).map((r) => r.id);
  let keys = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    keys += await db.transaction(async (tx) => {
      const names = await tx.select(NAME_COLUMNS).from(personName).where(inArray(personName.personId, batch));
      await tx.delete(personNameKey).where(inArray(personNameKey.personId, batch));
      const rows = keyRows(names);
      for (let j = 0; j < rows.length; j += INSERT_CHUNK) await tx.insert(personNameKey).values(rows.slice(j, j + INSERT_CHUNK));
      return rows.length;
    });
  }
  return { persons: ids.length, keys };
}
