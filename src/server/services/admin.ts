// The admin placeholder (milestone M02, In scope 7): for a staff session that proved the second
// factor, the number of e-mails that could not be delivered. Nothing personal: a count.

import { count, eq } from 'drizzle-orm';

import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { emailDelivery } from '../db/schema';

export interface AdminOverview {
  failedEmailDeliveries: number;
}

export async function adminOverview(principal: Principal | null): Promise<AdminOverview> {
  requireStaff2FA(principal);
  const [row] = await getDb().select({ n: count() }).from(emailDelivery).where(eq(emailDelivery.status, 'failed'));
  return { failedEmailDeliveries: row?.n ?? 0 };
}
