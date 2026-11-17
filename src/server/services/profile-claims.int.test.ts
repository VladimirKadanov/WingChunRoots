// "Is this you? Ask to claim this profile" (ADR 0037), against a migrated throwaway database:
//   - a claim from the profile page opens the same review case of kind person_claim, and the same
//     person_claim, an invitation's claim opens, without a relationship; the note stays in the
//     case, the deciders are told, the audit row carries ids only;
//   - only a public, unclaimed record of a living person can be claimed; a historical or deceased
//     person's record, a record kept by the archive, a claimed one and one that is not public are
//     refused in plain words (not public: 404, as on its page);
//   - only an account without a profile of its own, with no other claim waiting and the current
//     documents confirmed; at most SELF_CLAIMS_PER_DAY in 24 hours;
//   - approved, the record becomes the claimant's own and keeps its visibility; refused, it stays
//     as it was; with two claims of one record, only one can be approved.
// Fictional data only (D20): demo- slugs, example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, consentRecord, notification, person, personClaim, personName, reviewCase, reviewEvent, reviewNote } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { landingPath } from './account';
import { getPartyCase } from './cases';
import { grantConsents, REQUIRED_SIGN_UP_CONSENTS } from './consent';
import { getClaimOption, requestProfileClaim, SELF_CLAIMS_PER_DAY } from './profile-claims';
import { assignReviewCase, decideReviewCase, getReviewCase } from './review';
import { key, member, meta, staff } from './relationships.test-support';

const cache = vi.hoisted(() => ({ revalidated: [] as string[] }));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: (tag: string) => {
    cache.revalidated.push(tag);
  },
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string; message?: string } | null;
  return { code: error?.code ?? 'OK', message: error?.message ?? '' };
}

type RecordOptions = { kind?: 'living' | 'historical'; lifeStatus?: 'living' | 'deceased'; stewardship?: 'unclaimed' | 'platform'; visibility?: 'public' | 'involved_only' };

/** A record nobody has claimed: by default public, of a living person (as the demo records). */
async function record(label: string, opts: RecordOptions = {}) {
  const id = uuidv7();
  const slug = `demo-claimable-${label}-${randomBytes(4).toString('hex')}`;
  await getDb()
    .insert(person)
    .values({ id, slug, kind: opts.kind ?? 'living', lifeStatus: opts.lifeStatus ?? 'living', stewardship: opts.stewardship ?? 'unclaimed', visibility: opts.visibility ?? 'public' });
  await getDb().insert(personName).values({ personId: id, value: `Demo Claimable ${label.replace(/[^A-Za-z]+/g, ' ').trim()}`, script: 'Latn', lang: 'en', isPrimary: true });
  return { id, slug };
}

/** An account without a profile of its own, with the confirmations sign-up records. */
async function newcomer(label: string) {
  const m = await member(`self-claim-${label}`);
  await getDb().delete(person).where(eq(person.id, m.personId));
  await getDb().transaction((tx) => grantConsents(tx, m.account.id, 'user', REQUIRED_SIGN_UP_CONSENTS, meta));
  return m;
}

async function decide(reviewer: Awaited<ReturnType<typeof staff>>, caseId: string, decision: 'verify' | 'reject' | 'needs_info', reason: string | null = null) {
  await assignReviewCase(reviewer.principal, { caseId, assigneeId: reviewer.account.id, idempotencyKey: key() }, meta);
  return decideReviewCase(reviewer.principal, { caseId, decision, reason, idempotencyKey: key() }, meta);
}

const NOTE = 'I teach at the Demo Hall on Tuesdays; the hall’s owner can confirm it.';

async function claim(who: Awaited<ReturnType<typeof newcomer>>, personId: string, idempotencyKey = key()) {
  return requestProfileClaim(who.principal, { personId, note: NOTE, idempotencyKey }, meta);
}

async function notices(userId: string, template: string) {
  return getDb()
    .select({ payload: notification.payload })
    .from(notification)
    .where(and(eq(notification.userId, userId), eq(notification.template, template)))
    .orderBy(asc(notification.createdAt));
}

describe('claims.request: a claim from the profile page', () => {
  it('opens the same person_claim case an invitation opens, without a relationship; approved, the record is the claimant’s and stays public', async () => {
    const target = await record('approved');
    const claimant = await newcomer('approved');
    const archivist = await staff('self-claim-archivist', 'archivist');

    const before = await getClaimOption(claimant.principal, { slug: target.slug });
    expect(before).toMatchObject({ personId: target.id, claimable: true, recordRefusal: null, viewer: { refusal: null, waitingCaseId: null, waitingHere: false } });

    const sentKey = key();
    const sent = await claim(claimant, target.id, sentKey);
    expect(sent.replayed).toBe(false);
    // The same key again is the same claim.
    expect(await claim(claimant, target.id, sentKey)).toEqual({ caseId: sent.caseId, replayed: true });

    const [c] = await getDb().select().from(reviewCase).where(eq(reviewCase.id, sent.caseId));
    expect(c).toMatchObject({ kind: 'person_claim', status: 'open', personId: target.id, relationshipId: null, openedByUserId: claimant.account.id });
    const claims = await getDb().select().from(personClaim).where(eq(personClaim.reviewCaseId, sent.caseId));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ personId: target.id, userId: claimant.account.id, status: 'pending' });
    const notes = await getDb().select({ body: reviewNote.body, internal: reviewNote.isInternal }).from(reviewNote).where(eq(reviewNote.reviewCaseId, sent.caseId));
    expect(notes).toEqual([{ body: NOTE, internal: false }]);
    const events = await getDb().select({ action: reviewEvent.action, to: reviewEvent.toStatus }).from(reviewEvent).where(eq(reviewEvent.reviewCaseId, sent.caseId));
    expect(events).toEqual([{ action: 'open', to: 'open' }]);
    const audits = await getDb().select({ action: auditLog.action, after: auditLog.after }).from(auditLog).where(eq(auditLog.subjectId, target.id));
    expect(audits).toEqual([{ action: 'person.claim', after: { status: 'pending', caseId: sent.caseId, source: 'profile_page' } }]);
    // The note is in no audit row (plan §6.4); the deciders are told.
    expect(JSON.stringify(audits)).not.toContain('Tuesdays');
    expect((await notices(archivist.account.id, 'review.opened')).map((n) => (n.payload as { caseId: string }).caseId)).toContain(sent.caseId);

    // The claimant follows it on the case page, and the page says so.
    const party = await getPartyCase(claimant.principal, { id: sent.caseId });
    expect(party).toMatchObject({ kind: 'person_claim', role: 'claimant', relationship: null, record: { unclaimed: true }, open: true });
    expect((await getClaimOption(claimant.principal, { slug: target.slug })).viewer).toMatchObject({ waitingCaseId: sent.caseId, waitingHere: true });

    // The reviewer reads where it came from, and may decide it (no relationship to wait for).
    const view = await getReviewCase(archivist.principal, { id: sent.caseId });
    expect(view.subject?.facts).toEqual(
      expect.arrayContaining([
        { label: 'Source', value: expect.stringContaining('without an invitation') },
        { label: 'Other open claims of this record', value: '0' },
      ]),
    );
    expect(view.subject?.facts.map((f) => f.label)).not.toContain('Invitation');
    expect(view.decisions.verify.hint).not.toContain('student');

    cache.revalidated.length = 0;
    await decide(archivist, sent.caseId, 'verify');
    const [after] = await getDb().select().from(person).where(eq(person.id, target.id));
    expect(after).toMatchObject({ claimedByUserId: claimant.account.id, stewardship: 'self', visibility: 'public' });
    expect((await getDb().select({ status: personClaim.status }).from(personClaim).where(eq(personClaim.reviewCaseId, sent.caseId)))[0]!.status).toBe('approved');
    expect(cache.revalidated).toContain(`person:${target.id}`);
    // Told in words that fit: no student waits; the e-mail leads to Your profile.
    const decided = await notices(claimant.account.id, 'claim.decided');
    expect(decided.at(-1)!.payload).toEqual({ caseId: sent.caseId, decision: 'approved', self: true });
    const mail = await getDb().execute<{ data: EmailSendJob }>(sql`
      SELECT j.data FROM pgboss.job j JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
       WHERE j.name = 'email.send' AND d.template = 'claim-decided' AND d.to_email = ${claimant.account.email}`);
    expect(mail.rows).toHaveLength(1);
    const data = jobTemplateData(mail.rows[0]!.data) as { url: string; self?: boolean };
    expect(new URL(data.url).pathname).toBe('/dashboard/profile');
    expect(data.self).toBe(true);
    // The profile is the account's now: nothing more to claim.
    expect((await getClaimOption(claimant.principal, { slug: target.slug })).recordRefusal).toBe('This is your own profile already.');
  });

  it('refused, the record stays as it was and the account can ask again', async () => {
    const target = await record('refused');
    const claimant = await newcomer('refused');
    const archivist = await staff('self-claim-archivist-refuse', 'archivist');
    const sent = await claim(claimant, target.id);
    await decide(archivist, sent.caseId, 'reject', 'The fictional note does not show that the profile is yours.');
    const [after] = await getDb().select().from(person).where(eq(person.id, target.id));
    expect(after).toMatchObject({ claimedByUserId: null, stewardship: 'unclaimed', visibility: 'public' });
    expect((await notices(claimant.account.id, 'claim.decided')).at(-1)!.payload).toEqual({ caseId: sent.caseId, decision: 'rejected', self: true });
    const again = await claim(claimant, target.id);
    expect(again.caseId).not.toBe(sent.caseId);
  });

  it('refuses a record that cannot be claimed, in plain words', async () => {
    const claimant = await newcomer('records');
    const hidden = await record('hidden', { visibility: 'involved_only' });
    expect((await refusal(claim(claimant, hidden.id))).code).toBe('NOT_FOUND');
    expect((await refusal(getClaimOption(claimant.principal, { slug: hidden.slug }))).code).toBe('NOT_FOUND');
    expect((await refusal(claim(claimant, uuidv7()))).code).toBe('NOT_FOUND');
    expect((await refusal(getClaimOption(claimant.principal, { slug: 'Not A Slug' }))).code).toBe('NOT_FOUND');

    const historical = await record('historical', { kind: 'historical', lifeStatus: 'deceased' });
    const deceased = await record('deceased', { lifeStatus: 'deceased' });
    const archive = await record('archive', { stewardship: 'platform' });
    const owned = await member('self-claim-owned');
    for (const [target, words] of [
      [historical, 'historical teacher or of someone who has died'],
      [deceased, 'historical teacher or of someone who has died'],
      [archive, 'kept by the archive'],
      [{ id: owned.personId, slug: owned.slug }, 'already belongs to an account'],
    ] as const) {
      const refused = await refusal(claim(claimant, target.id));
      expect(refused.code, target.slug).toBe('CONFLICT');
      expect(refused.message).toContain(words);
      expect(await getClaimOption(claimant.principal, { slug: target.slug })).toMatchObject({ claimable: false, recordRefusal: refused.message });
    }
    // Nothing was opened.
    const opened = await getDb().select({ id: reviewCase.id }).from(reviewCase).where(eq(reviewCase.openedByUserId, claimant.account.id));
    expect(opened).toEqual([]);
  });

  it('refuses an account with a profile, a claim waiting, missing documents, a visitor, and an empty note', async () => {
    const target = await record('accounts');
    const other = await record('accounts-other');

    const withProfile = await member('self-claim-with-profile');
    const own = await refusal(requestProfileClaim(withProfile.principal, { personId: target.id, note: NOTE, idempotencyKey: key() }, meta));
    expect(own).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('already has its own profile') });

    const waiting = await newcomer('waiting');
    const first = await claim(waiting, target.id);
    const second = await refusal(claim(waiting, other.id));
    expect(second).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('waiting for the reviewers') });
    expect((await getClaimOption(waiting.principal, { slug: other.slug })).viewer).toMatchObject({ waitingCaseId: first.caseId, waitingHere: false, refusal: expect.stringContaining('waiting') });

    const unconfirmed = await newcomer('unconfirmed');
    await getDb().delete(consentRecord).where(eq(consentRecord.userId, unconfirmed.account.id));
    expect((await refusal(claim(unconfirmed, target.id))).message).toContain('confirm the current version');
    expect((await getClaimOption(unconfirmed.principal, { slug: target.slug })).viewer.confirmDocuments).toBe(true);

    expect((await refusal(requestProfileClaim(null, { personId: target.id, note: NOTE, idempotencyKey: key() }, meta))).code).toBe('UNAUTHORIZED');
    expect((await refusal(getClaimOption(null, { slug: target.slug }))).code).toBe('UNAUTHORIZED');
    const empty = await newcomer('empty-note');
    expect((await refusal(requestProfileClaim(empty.principal, { personId: target.id, note: '   ', idempotencyKey: key() }, meta))).code).toBe('BAD_REQUEST');
  });

  it(`allows at most ${SELF_CLAIMS_PER_DAY} claims from profile pages in 24 hours`, async () => {
    const claimant = await newcomer('limit');
    const archivist = await staff('self-claim-archivist-limit', 'archivist');
    for (let i = 0; i < SELF_CLAIMS_PER_DAY; i += 1) {
      const target = await record(`limit-${'abc'[i]}`);
      const sent = await claim(claimant, target.id);
      // Refused, so the next one is not held back by the waiting claim.
      await decide(archivist, sent.caseId, 'reject', 'The fictional note does not show it.');
    }
    const last = await record('limit-last');
    expect((await getClaimOption(claimant.principal, { slug: last.slug })).viewer.refusal).toContain('tomorrow');
    expect((await refusal(claim(claimant, last.id))).code).toBe('TOO_MANY_REQUESTS');
  });

  it('with two claims of one record, only one can be approved; a record that is no longer of a living person is not approved', async () => {
    const target = await record('two');
    const first = await newcomer('two-first');
    const second = await newcomer('two-second');
    const archivist = await staff('self-claim-archivist-two', 'archivist');
    const a = await claim(first, target.id);
    const b = await claim(second, target.id);
    expect((await getReviewCase(archivist.principal, { id: b.caseId })).subject?.facts).toEqual(expect.arrayContaining([{ label: 'Other open claims of this record', value: '1' }]));
    await decide(archivist, a.caseId, 'verify');
    expect((await refusal(decide(archivist, b.caseId, 'verify'))).code).toBe('CONFLICT');
    await decideReviewCase(archivist.principal, { caseId: b.caseId, decision: 'reject', reason: 'The profile was claimed by another account.', idempotencyKey: key() }, meta);

    const gone = await record('gone');
    const late = await newcomer('gone');
    const c = await claim(late, gone.id);
    await getDb().update(person).set({ lifeStatus: 'deceased' }).where(eq(person.id, gone.id));
    const refused = await refusal(decide(archivist, c.caseId, 'verify'));
    expect(refused).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('no longer of a living person') });
    expect((await getDb().select({ stewardship: person.stewardship }).from(person).where(eq(person.id, gone.id)))[0]!.stewardship).toBe('unclaimed');
  });
});

describe('sign-in on the way to a claim', () => {
  it('lands on the claim page, not on onboarding, for an account without a profile', async () => {
    const claimant = await newcomer('landing');
    expect(await landingPath(claimant.principal, '/people/demo-a-005/claim')).toBe('/people/demo-a-005/claim');
    // Any other page still goes through onboarding first.
    expect(await landingPath(claimant.principal, '/people/demo-a-005')).toBe(`/onboarding?next=${encodeURIComponent('/people/demo-a-005')}`);
  });
});
