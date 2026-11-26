// Claim links of an organization's imported members (role replay 2026-11-25, P2-6, ADR 0074),
// against a migrated throwaway database:
//   - a link for each imported member whose record is still unclaimed, made by the organization's
//     admins only (404 for another organization's admin and a member); the same link every time
//     the list is read; nothing is sent; the audit rows carry counts and ids only;
//   - opening a link never signs anyone in or makes the record theirs: accepting opens the same
//     person_claim review case a claim from a profile page opens; the link is then used up;
//   - a replaced, used or unknown token answers 404; an account with a profile cannot claim;
//   - approved, the record becomes the claimant's own and the member leaves the list.
// Fictional data only (D20): demo- names, example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, notification, organizationClaimLink, person, personClaim, reviewCase } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { grantConsents, REQUIRED_SIGN_UP_CONSENTS } from './consent';
import { acceptClaimLink, getClaimLink, listClaimLinks, makeClaimLinks, replaceClaimLink } from './organization-claim-links';
import { grantOrganizationPlan } from './organization-grants';
import { commitImport, previewImport } from './organization-import';
import { applyOrganization } from './organizations';
import { createUser, key, member, meta, principalOf, staff } from './relationships.test-support';
import { assignReviewCase, decideReviewCase } from './review';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  return error?.code ?? 'OK';
}

let admin: Awaited<ReturnType<typeof staff>> | undefined;

/** An approved organization with a test Federation plan and one committed import of `rows` members. */
async function importedOrganization(rows: number) {
  const owner = principalOf(await createUser('claim-link-owner'));
  const applied = await applyOrganization(
    owner,
    { name: `Demo ${randomBytes(2).toString('hex')} Federation`, kind: 'federation', leaderName: 'Demo Leader', leaderTitle: null, websiteUrl: null, countryCode: 'BG', schoolsEstimate: 3, evidenceIds: [], note: null, idempotencyKey: key() },
    meta,
  );
  await getDb().execute(sql`UPDATE organization SET status = 'active', approved_at = now() WHERE id = ${applied.organizationId}::uuid`);
  await getDb().execute(sql`UPDATE review_case SET status = 'resolved', resolution = 'approved', resolved_at = now() WHERE id = ${applied.caseId}::uuid`);
  admin ??= await staff('claim-link-admin', 'admin');
  await grantOrganizationPlan(admin.principal, { organizationId: applied.organizationId, reason: 'ADR 0074 test plan (fictional)' }, meta);
  const tag = randomBytes(3).toString('hex').replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!);
  const lines = Array.from({ length: rows }, (_, i) => `Demo,Linked ${tag} ${'abcdefghij'[i]},demo-linked-${i}@example.test`);
  const csv = ['First_Name,Last_Name,Email', ...lines].join('\n');
  const preview = await previewImport(owner, { organizationId: applied.organizationId, contentBase64: Buffer.from(csv).toString('base64') }, meta);
  await commitImport(owner, { organizationId: applied.organizationId, importId: preview.id }, meta);
  return { owner, organizationId: applied.organizationId };
}

/** An account without a profile of its own, with the confirmations sign-up records. */
async function newcomer(label: string) {
  const m = await member(`claim-link-${label}`);
  await getDb().delete(person).where(eq(person.id, m.personId));
  await getDb().transaction((tx) => grantConsents(tx, m.account.id, 'user', REQUIRED_SIGN_UP_CONSENTS, meta));
  return m;
}

const tokenOf = (path: string) => path.slice('/claim/'.length);

describe('the organization makes claim links', () => {
  it('one stable link per imported member, by its admins only, with nothing sent', async () => {
    const org = await importedOrganization(2);
    const before = await listClaimLinks(org.owner, { organizationId: org.organizationId });
    expect(before.members).toHaveLength(2);
    expect(before.withoutLink).toBe(2);
    expect(before.members.every((m) => m.link === null)).toBe(true);

    const mails = await getDb().select({ n: sql<number>`count(*)::int` }).from(notification);
    expect(await makeClaimLinks(org.owner, { organizationId: org.organizationId }, meta)).toEqual({ made: 2 });
    expect(await makeClaimLinks(org.owner, { organizationId: org.organizationId }, meta)).toEqual({ made: 0 });
    expect(await getDb().select({ n: sql<number>`count(*)::int` }).from(notification)).toEqual(mails);

    const first = await listClaimLinks(org.owner, { organizationId: org.organizationId });
    const again = await listClaimLinks(org.owner, { organizationId: org.organizationId });
    expect(first.withoutLink).toBe(0);
    expect(first.members.map((m) => m.link!.path)).toEqual(again.members.map((m) => m.link!.path));
    for (const m of first.members) expect(m.link!.path).toMatch(/^\/claim\/[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored.
    const stored = await getDb().select({ hash: organizationClaimLink.tokenHash }).from(organizationClaimLink).where(eq(organizationClaimLink.organizationId, org.organizationId));
    expect(stored.map((s) => s.hash)).not.toContain(tokenOf(first.members[0]!.link!.path));

    const [audit] = await getDb()
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'organization.claim_links'), eq(auditLog.subjectId, org.organizationId)));
    expect(audit!.after).toEqual({ made: 2 });

    const other = await importedOrganization(1);
    const stranger = await member('claim-link-stranger');
    expect(await refusal(listClaimLinks(other.owner, { organizationId: org.organizationId }))).toBe('NOT_FOUND');
    expect(await refusal(makeClaimLinks(stranger.principal, { organizationId: org.organizationId }, meta))).toBe('NOT_FOUND');
    expect(await refusal(replaceClaimLink(other.owner, { organizationId: org.organizationId, personId: first.members[0]!.personId }, meta))).toBe('NOT_FOUND');
  });

  it('a replaced link stops working; the new one opens the record', async () => {
    const org = await importedOrganization(1);
    await makeClaimLinks(org.owner, { organizationId: org.organizationId }, meta);
    const [m] = (await listClaimLinks(org.owner, { organizationId: org.organizationId })).members;
    const old = tokenOf(m!.link!.path);
    const replaced = await replaceClaimLink(org.owner, { organizationId: org.organizationId, personId: m!.personId }, meta);
    expect(replaced.path).not.toBe(m!.link!.path);
    expect(await refusal(getClaimLink(null, { token: old }))).toBe('NOT_FOUND');
    const view = await getClaimLink(null, { token: tokenOf(replaced.path) });
    expect(view.state).toBe('open');
    expect(view.viewer.signedIn).toBe(false);
    expect(view.name.value).toContain('Demo Linked');
  });
});

describe('the member claims with the link', () => {
  it('opens a person_claim review case, never signs in, uses the link up; approved, the record is theirs', async () => {
    const org = await importedOrganization(1);
    await makeClaimLinks(org.owner, { organizationId: org.organizationId }, meta);
    const [m] = (await listClaimLinks(org.owner, { organizationId: org.organizationId })).members;
    const token = tokenOf(m!.link!.path);

    expect(await refusal(getClaimLink(null, { token: 'A'.repeat(43) }))).toBe('NOT_FOUND');
    expect(await refusal(getClaimLink(null, { token: 'short' }))).toBe('NOT_FOUND');

    const withProfile = await member('claim-link-has-profile');
    expect((await getClaimLink(withProfile.principal, { token })).viewer.refusal).toMatch(/already has its own profile/);
    expect(await refusal(acceptClaimLink(withProfile.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');

    const claimant = await newcomer('claimant');
    const idempotencyKey = key();
    const accepted = await acceptClaimLink(claimant.principal, { token, note: 'I train on Tuesdays (fictional).', idempotencyKey }, meta);
    expect(accepted.replayed).toBe(false);
    expect(await acceptClaimLink(claimant.principal, { token, idempotencyKey }, meta)).toEqual({ caseId: accepted.caseId, replayed: true });

    const [kase] = await getDb().select({ kind: reviewCase.kind, personId: reviewCase.personId }).from(reviewCase).where(eq(reviewCase.id, accepted.caseId));
    expect(kase).toEqual({ kind: 'person_claim', personId: m!.personId });
    const [record] = await getDb().select({ claimedBy: person.claimedByUserId }).from(person).where(eq(person.id, m!.personId));
    expect(record!.claimedBy).toBeNull();
    const [link] = await getDb().select({ status: organizationClaimLink.status, usedBy: organizationClaimLink.usedByUserId }).from(organizationClaimLink).where(eq(organizationClaimLink.personId, m!.personId));
    expect(link).toEqual({ status: 'used', usedBy: claimant.account.id });

    // Used: the claimant reads their claim, anyone else gets "not found".
    const yours = await getClaimLink(claimant.principal, { token });
    expect(yours.state).toBe('yours');
    expect(yours.viewer.caseId).toBe(accepted.caseId);
    expect(yours.viewer.claimStatus).toBe('pending');
    expect(await refusal(getClaimLink(null, { token }))).toBe('NOT_FOUND');
    const late = await newcomer('late');
    expect(await refusal(acceptClaimLink(late.principal, { token, idempotencyKey: key() }, meta))).toBe('NOT_FOUND');

    const waiting = await listClaimLinks(org.owner, { organizationId: org.organizationId });
    expect(waiting.members[0]!.claimWaiting).toBe(true);

    const archivist = await staff('claim-link-archivist', 'archivist');
    await assignReviewCase(archivist.principal, { caseId: accepted.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    await decideReviewCase(archivist.principal, { caseId: accepted.caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta);
    const [after] = await getDb().select({ claimedBy: person.claimedByUserId }).from(person).where(eq(person.id, m!.personId));
    expect(after!.claimedBy).toBe(claimant.account.id);
    const [claimRow] = await getDb().select({ status: personClaim.status }).from(personClaim).where(eq(personClaim.reviewCaseId, accepted.caseId));
    expect(claimRow!.status).toBe('approved');
    expect((await listClaimLinks(org.owner, { organizationId: org.organizationId })).members).toHaveLength(0);
  });
});
