// account.export (review 2026-11-13, ADR 0088): the account's own data as one JSON document; no
// secret and no other person's private detail; audited; refused without a session.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, authSession, invitation, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleAccountExport } from '../account-export-http';
import { exportAccountData } from './account-export';
import { member, meta, newLineage } from './relationships.test-support';

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

describe('account.export', () => {
  it('holds the account, the profile and the links, never a secret or an invitee address, and is audited', async () => {
    const student = await member('export-student');
    const teacher = await member('export-teacher', { sifu: true });
    const lineageId = await newLineage('export');
    const [link] = await getDb()
      .insert(teachingRelationship)
      .values({ teacherPersonId: teacher.personId, studentPersonId: student.personId, lineageId, status: 'verified', verificationPath: 'teacher_approval', requestedByUserId: student.account.id })
      .returning({ id: teachingRelationship.id });
    await getDb().insert(authSession).values({ token: 'demo-secret-session-token', userId: student.account.id, expiresAt: new Date(Date.now() + 3_600_000), userAgent: 'Demo Browser' });
    await getDb().insert(invitation).values({ personId: teacher.personId, relationshipId: link!.id, invitedByUserId: student.account.id, email: 'demo-invitee-secret@example.test', tokenHash: 'a'.repeat(64), status: 'pending', expiresAt: new Date(Date.now() + 86_400_000) });

    const data = await exportAccountData(student.principal, meta);
    expect(data.format).toBe('wingchunroots-account-export/1');
    expect(data.account).toMatchObject({ id: student.account.id, email: student.account.email });
    expect(data.profile?.person).toMatchObject({ slug: student.slug, visibility: 'public' });
    expect(data.profile?.names.map((n) => n.value)).toContain('Demo export student');
    expect(data.teachingLinks).toEqual([expect.objectContaining({ your_role: 'student', other_person: 'Demo export teacher', status: 'verified' })]);
    expect(data.sessions).toEqual([expect.objectContaining({ user_agent: 'Demo Browser' })]);
    expect(data.consents.map((c) => c.kind)).toContain('publication');
    expect(data.invitationsSent).toEqual([expect.objectContaining({ invited_person: 'Demo export teacher', status: 'pending' })]);
    const text = JSON.stringify(data);
    for (const secret of ['demo-secret-session-token', 'demo-invitee-secret@example.test', 'a'.repeat(64), 'ip_hmac', 'password']) expect(text).not.toContain(secret);

    const audited = await getDb().select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, 'account.export'), eq(auditLog.actorUserId, student.account.id)));
    expect(audited).toHaveLength(1);
  });

  it('refuses anonymous callers, and the download refuses another site', async () => {
    await expect(exportAccountData(null, meta)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const anonymous = await handleAccountExport(new Request('http://127.0.0.1:3000/api/account/export'));
    expect(anonymous.status).toBe(401);
    const foreign = await handleAccountExport(new Request('http://127.0.0.1:3000/api/account/export', { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('cache-control')).toBe('no-store');
  });
});
