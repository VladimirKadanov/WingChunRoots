// The hold of an impersonation report (ADR 0088, decision 1): once a moderator checked a report,
// the profile it is about does not change until the administrators decide, so nothing can be moved
// or hidden in the meantime. A leaf module (no service imports), so the services it guards can use it.

import { eq } from 'drizzle-orm';

import { person } from '../db/schema';
import type { Executor } from '../entitlements/access';
import { ServiceError } from './errors';

/** The refusal of any change to a profile on hold. */
export const HELD_MESSAGE = 'This profile is on hold while the administrators check who it belongs to. It can change again once they decide.';

/** Refuses while the person is on hold: renames, hiding, deletion, succession, a teacher's approval. */
export async function refuseWhileHeld(db: Executor, personId: string | null | undefined): Promise<void> {
  if (!personId) return;
  const [row] = await db.select({ held: person.identityHoldAt }).from(person).where(eq(person.id, personId));
  if (row?.held) throw new ServiceError('CONFLICT', HELD_MESSAGE);
}
