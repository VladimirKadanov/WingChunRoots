// "My lineage is not listed" (journey review 2026-11-26, P2-2; docs/adr/0080-add-a-teacher.md): a
// member naming a teacher whose lineage is not in the list tells the archivists its name, as "My
// city is missing" tells the admins (services/places.ts). Each archivist and admin gets a
// dashboard notification ("lineage.missing"); an archivist adds the lineage in the archive editor.
// Nothing personal is kept: the notification and the audit row hold the lineage's name as typed,
// and the audit row the reporting account's id. At most LINEAGE_REPORTS_PER_DAY reports a day.

import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { auditLog, authUser } from '../db/schema';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notifyEach } from './notify';

export const LINEAGE_REPORTS_PER_DAY = 5;
export const LINEAGE_REPORT_NAME_MAX = 120;

export const reportMissingLineageInput = z.object({
  name: z
    .string({ error: 'Type the name of your lineage.' })
    .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, { error: 'Type the name of your lineage.' }).max(LINEAGE_REPORT_NAME_MAX, { error: `Use at most ${LINEAGE_REPORT_NAME_MAX} characters.` })),
});

export interface MissingLineageOutcome {
  reported: true;
  /** How many archivists and admins were told. */
  notified: number;
}

export async function reportMissingLineage(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<MissingLineageOutcome> {
  const p = requireUser(principal);
  const parsed = reportMissingLineageInput.safeParse(raw);
  if (!parsed.success) {
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { name: parsed.error.issues[0]?.message ?? 'Type the name of your lineage.' });
  }
  const { name } = parsed.data;
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lineage.missing_report'), hashtext(${p.user.id}))`);
    const [recent] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'lineage.missing_report'), eq(auditLog.actorUserId, p.user.id), gt(auditLog.occurredAt, new Date(Date.now() - 86_400_000))));
    if ((recent?.n ?? 0) >= LINEAGE_REPORTS_PER_DAY) {
      throw new ServiceError('TOO_MANY_REQUESTS', `You can tell us about ${LINEAGE_REPORTS_PER_DAY} missing lineages a day. Try again tomorrow.`);
    }
    const staff = await tx.select({ id: authUser.id }).from(authUser).where(inArray(authUser.role, ['archivist', 'admin']));
    if (staff.length > 0) await notifyEach(tx, staff.map((s) => s.id), 'lineage.missing', { name });
    await writeAudit(tx, {
      action: 'lineage.missing_report',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'lineage',
      // No lineage exists yet: the subject is the account that asked (its id only).
      subjectId: p.user.id,
      // Never the typed name, which often names a person (CLAUDE.md §6): the staff notice carries it.
      after: { nameLength: name.length, notifiedStaff: staff.length },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { reported: true as const, notified: staff.length };
  });
}
