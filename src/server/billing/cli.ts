// `pnpm billing:test-clock --email <address> [--step period_end|grace_end]` or
// `pnpm billing:test-clock --subscription <id> [--step …]` (milestone M22; docs/adr/0025-billing.md):
// the test provider's clock from the command line, as on /admin/billing/[id]. It moves the live
// subscription of an account (or the one named) to the end of its period (the default) or of its
// grace period. The provider's events are stored and queued here; a running worker (pnpm worker)
// applies them.
//
// Local only: refused with NODE_ENV=production, for a database not on this machine, and unless the
// provider is the test provider. Prints no address and no secret. Values come from the environment,
// then from .env.

import path from 'node:path';

import { and, eq, inArray } from 'drizzle-orm';

import { assertLocalEnvironment } from '../auth/admin-create';
import { closeDb, getDb } from '../db';
import { loadDotEnv } from '../db/dotenv';
import { authUser, billingSubscription } from '../db/schema';
import { isServiceError } from '../services/errors';
import { runTestClock } from '../services/billing';
import { billingProviderName } from './config';

const USAGE = 'usage: pnpm billing:test-clock (--email <address> | --subscription <id>) [--step period_end|grace_end]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function argument(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  const value = at >= 0 ? args[at + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const email = argument(args, '--email');
  const id = argument(args, '--subscription');
  const step = argument(args, '--step') ?? 'period_end';
  if ((!email && !id) || (id && !UUID.test(id)) || (step !== 'period_end' && step !== 'grace_end')) {
    console.error(USAGE);
    return 2;
  }
  loadDotEnv(path.resolve('.env'));
  assertLocalEnvironment();
  if (billingProviderName() !== 'test') {
    console.error('billing:test-clock: the test clock works only with BILLING_PROVIDER=test.');
    return 1;
  }
  try {
    let subscriptionId = id;
    if (!subscriptionId) {
      const [row] = await getDb()
        .select({ id: billingSubscription.id })
        .from(billingSubscription)
        .innerJoin(authUser, eq(authUser.id, billingSubscription.subjectUserId))
        .where(and(eq(authUser.email, email!.trim().toLowerCase()), inArray(billingSubscription.status, ['active', 'past_due'])));
      if (!row) {
        console.error('billing:test-clock: that account has no live subscription.');
        return 1;
      }
      subscriptionId = row.id;
    }
    await runTestClock({ subscriptionId, step }, { actorUserId: null, actorRole: null, meta: { requestId: 'billing-test-clock-cli', ipHmac: null } });
    console.log(`billing:test-clock: subscription ${subscriptionId} moved to the end of its ${step === 'period_end' ? 'period' : 'grace period'}.`);
    console.log('billing:test-clock: the provider events are queued; a running worker (pnpm worker) applies them within seconds.');
    return 0;
  } catch (error) {
    if (!isServiceError(error)) throw error;
    console.error(`billing:test-clock: ${error.message}`);
    return 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`billing:test-clock: ${error instanceof Error ? error.name : 'error'}`);
    process.exit(1);
  });
