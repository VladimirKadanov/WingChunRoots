// "My city is missing" (role replay 2026-11-25, P2-12; docs/adr/0071-cities-of-launch-countries.md):
// a member whose city or town is not in the GeoNames extract tells the admins its name and
// country. Each admin gets a dashboard notification ("place.missing"); the place is added by a new
// extract (pnpm geo:extract, then pnpm geo:load), never typed into the database by hand. Nothing
// personal is kept: the notification and the audit row hold the place's name and country, and the
// audit row the reporting account's id. At most PLACE_REPORTS_PER_DAY reports per account a day.

import { and, count, eq, gt, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { auditLog, authUser } from '../db/schema';
import { COUNTRIES } from './account';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notifyEach } from './notify';

export const PLACE_REPORTS_PER_DAY = 5;

const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

export const reportMissingPlaceInput = z.object({
  name: z
    .string({ error: 'Type the name of your city or town.' })
    .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, { error: 'Type the name of your city or town.' }).max(100, { error: 'Use at most 100 characters.' })),
  countryCode: z.string({ error: 'Choose the country.' }).refine((code) => COUNTRY_CODES.has(code), { error: 'Choose the country.' }),
});

export interface MissingPlaceOutcome {
  reported: true;
  /** How many admins were told. */
  notified: number;
}

export async function reportMissingPlace(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<MissingPlaceOutcome> {
  const p = requireUser(principal);
  const parsed = reportMissingPlaceInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'name');
      fields[key] ??= issue.message;
    }
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const { name, countryCode } = parsed.data;

  return getDb().transaction(async (tx) => {
    // One account at a time, so two reports at once count against the same day.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('place.missing_report'), hashtext(${p.user.id}))`);
    const [recent] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'place.missing_report'), eq(auditLog.actorUserId, p.user.id), gt(auditLog.occurredAt, new Date(Date.now() - 86_400_000))));
    if ((recent?.n ?? 0) >= PLACE_REPORTS_PER_DAY) {
      throw new ServiceError('TOO_MANY_REQUESTS', `You can tell us about ${PLACE_REPORTS_PER_DAY} missing places a day. Try again tomorrow.`);
    }
    const admins = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.role, 'admin'));
    if (admins.length > 0) await notifyEach(tx, admins.map((admin) => admin.id), 'place.missing', { name, countryCode });
    await writeAudit(tx, {
      action: 'place.missing_report',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'place',
      subjectId: countryCode,
      after: { name, countryCode, notifiedAdmins: admins.length },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { reported: true as const, notified: admins.length };
  });
}
