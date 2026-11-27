// "My lineage is not listed" (journey review 2026-11-26, P2-2; ADR 0080): every archivist and admin
// is told the name, nobody else; the audit row holds the name and the count, never who the member
// trains with; five a day per account.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, notification } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { LINEAGE_REPORTS_PER_DAY, reportMissingLineage } from './lineage-missing';
import { member, meta, staff } from './relationships.test-support';

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

describe('lineage.reportMissing', () => {
  it('tells every archivist and admin the name, audits it, and allows five a day', async () => {
    const archivist = await staff('missing-lineage-archivist', 'archivist');
    const admin = await staff('missing-lineage-admin', 'admin');
    const m = await member('missing-lineage-member');
    const outcome = await reportMissingLineage(m.principal, { name: '  Demo   Lineage of the North ' }, meta);
    expect(outcome.reported).toBe(true);
    for (const who of [archivist, admin]) {
      const notes = await getDb().select().from(notification).where(and(eq(notification.userId, who.account.id), eq(notification.template, 'lineage.missing')));
      expect(notes.map((n) => n.payload)).toEqual([{ name: 'Demo Lineage of the North' }]);
    }
    expect(await getDb().select().from(notification).where(and(eq(notification.userId, m.account.id), eq(notification.template, 'lineage.missing')))).toHaveLength(0);
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'lineage.missing_report'), eq(auditLog.actorUserId, m.account.id)));
    expect(audit?.after).toMatchObject({ nameLength: 'Demo Lineage of the North'.length });
    // The typed name may name a person: never in the audit row (CLAUDE.md §6).
    expect(JSON.stringify(audit)).not.toContain('Demo Lineage of the North');
    for (let i = 1; i < LINEAGE_REPORTS_PER_DAY; i += 1) await reportMissingLineage(m.principal, { name: `Demo Lineage ${i}` }, meta);
    await expect(reportMissingLineage(m.principal, { name: 'Demo Lineage Six' }, meta)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await expect(reportMissingLineage(m.principal, { name: ' ' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
