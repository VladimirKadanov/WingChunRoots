// Queues search.keys.rebuild (milestone M07, In scope 2): `pnpm db:seed` after loading the demo
// data, and `pnpm search:rebuild` after a change to the key rules (src/server/search/keys.ts). A
// running worker (`pnpm worker`) rewrites the keys. The rebuild is idempotent, so a second job
// queued before the first ran only does the same work again.

import { getDb } from '../db';
import { enqueue } from './outbox';
import { QUEUE } from './queues';

/** Queues one rebuild and returns its job id. */
export async function queueSearchKeysRebuild(): Promise<string | null> {
  return getDb().transaction((tx) => enqueue(tx, QUEUE.searchKeysRebuild, {}));
}
