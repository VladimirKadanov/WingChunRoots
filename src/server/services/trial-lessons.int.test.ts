// Trial lessons, the schedule and fees, and the basic school stats (milestone M21;
// docs/adr/0024-trial-lessons.md) against PostGIS, on the seeded demo data: who may send a request
// (signed-in, confirmed adults with a profile, never at their own school or at a school that is not
// public), the limits (one open request per school, 5 a day), who reads a request (the sender, the
// listing account and the admins of a linked organization; never staff, never a public answer),
// the answers and their notices, the schedule as listing activity, the counters and who they leave
// out, the Professional Sifu gate of the stats, and the retention of both. Fictional data only
// (D20): demo- slugs and example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEMO_STAT_DAYS, DEMO_STATS_LAST_DAY } from '../../fixtures/generate';
import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { createRoleDatabase, getDb } from '../db';
import { rolePassword } from '../db/env';
import { auditLog, authUser, emailDelivery, entitlementGrant, notification, school, schoolInstructor, schoolStatDay, trialInquiry } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { SIGN_UP_CONSENTS } from '../legal/documents';
import { recordConsents } from './consent';
import { member, meta, staff } from './relationships.test-support';
import { purgeOldTrialData } from './retention';
import { schoolSchedule, updateSchoolSchedule } from './school-schedule';
import { countSchoolEvent, schoolStats, trackSchoolEvent } from './school-stats';
import { mySchools, schoolGet } from './schools';
import { answerTrial, closeTrial, declineTrial, myTrialInquiries, requestTrial, TRIAL_DAILY_LIMIT, trialInbox, trialOptions, withdrawTrial } from './trial-lessons';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

/** A member who accepted the sign-up documents (an adult with a confirmed address), so may ask. */
async function sender(label: string) {
  const m = await member(`m21-${label}`);
  await recordConsents(m.principal, { kinds: [...SIGN_UP_CONSENTS] }, meta);
  return m;
}

async function proGrant(userId: string) {
  await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode: 'pro_sifu', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M21 test plan' });
}

/** A listed (public) city-only school of a new Sifu, Professional Sifu unless `pro` is false; a draft when `draft`. */
async function listedSchool(label: string, opts: { pro?: boolean; draft?: boolean } = {}) {
  const sifu = await member(`m21-${label}-sifu`, { sifu: true });
  await recordConsents(sifu.principal, { kinds: [...SIGN_UP_CONSENTS] }, meta);
  if (opts.pro !== false) await proGrant(sifu.account.id);
  const city = await getDb().execute<{ id: string; lat: number; lng: number }>(sql`
    SELECT id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM place WHERE name = 'Plovdiv' AND country_code = 'BG'
     ORDER BY population DESC NULLS LAST LIMIT 1`);
  const c = city.rows[0]!;
  const slug = `demo-m21-${label}-${randomBytes(3).toString('hex')}`;
  const point = sql`ST_SetSRID(ST_MakePoint(${c.lng}::float8, ${c.lat}::float8), 4326)::geography`;
  const inserted = await getDb().execute<{ id: string }>(sql`
    INSERT INTO school (slug, name, place_id, location_privacy, public_point, status, created_by_user_id, last_activity_at)
    VALUES (${slug}, ${`Demo M21 ${label} Hall`}, ${c.id}::uuid, 'city_only', ${point}, ${opts.draft ? 'draft' : 'active'}, ${sifu.account.id}::uuid, now() - interval '30 days')
    RETURNING id`);
  const id = inserted.rows[0]!.id;
  await getDb().execute(sql`INSERT INTO school_private_location (school_id, exact_point) VALUES (${id}::uuid, ${point})`);
  await getDb().insert(schoolInstructor).values({ schoolId: id, personId: sifu.personId, role: 'head_instructor' });
  return { id, slug, sifu };
}

const noticesOf = (userId: string, template?: string) =>
  getDb()
    .select()
    .from(notification)
    .where(and(eq(notification.userId, userId), template ? eq(notification.template, template) : undefined));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'THROWN';
  }
}

async function counters(schoolId: string) {
  const rows = await getDb().select().from(schoolStatDay).where(eq(schoolStatDay.schoolId, schoolId));
  return rows.reduce(
    (t, r) => ({ pageViews: t.pageViews + r.pageViews, pinOpens: t.pinOpens + r.pinOpens, contactClicks: t.contactClicks + r.contactClicks, trialInquiries: t.trialInquiries + r.trialInquiries }),
    { pageViews: 0, pinOpens: 0, contactClicks: 0, trialInquiries: 0 },
  );
}

describe('trial lesson requests: who may send one', () => {
  it('a confirmed adult with a profile sends one to a public school; its owner is told in-app and by e-mail (schools category)', async () => {
    const s = await listedSchool('send');
    const student = await sender('send-student');
    expect((await trialOptions(student.principal, { slug: s.slug })).state).toBe('ready');
    const sent = await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'phone', phone: '+000 000 0001', preferredTimes: 'Weekday evenings', message: 'A fictional request.' }, meta);
    expect(sent.status).toBe('open');
    const notices = await noticesOf(s.sifu.account.id, 'school.trial-requested');
    expect(notices).toHaveLength(1);
    // The notice names the school and the request, never the sender's contact or message.
    expect(JSON.stringify(notices[0]!.payload)).not.toContain('+000 000 0001');
    expect(JSON.stringify(notices[0]!.payload)).not.toContain('fictional request');
    // The notice goes by e-mail too (the `schools` category is mailed).
    expect(await getDb().select().from(emailDelivery).where(eq(emailDelivery.userId, s.sifu.account.id))).toHaveLength(1);
    // The audit row has ids and states only.
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'trial.request'), eq(auditLog.subjectId, sent.id)));
    expect(JSON.stringify(audit)).not.toContain('+000 000 0001');
    expect(JSON.stringify(audit)).not.toContain('fictional request');
    // The sender sees it, with the contact they chose.
    const mine = await myTrialInquiries(student.principal);
    expect(mine.inquiries.map((q) => [q.id, q.status, q.contactValue])).toEqual([[sent.id, 'open', '+000 000 0001']]);
  });

  it('without a session the options say sign in and a request is refused', async () => {
    const s = await listedSchool('anonymous');
    const options = await trialOptions(null, { slug: s.slug });
    expect(options.state).toBe('sign_in');
    expect(options.sender).toBeNull();
    expect(await codeOf(requestTrial(null, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('UNAUTHORIZED');
  });

  it('never at the own school, never without the sign-up confirmations or a profile, never at a school that is not public', async () => {
    const s = await listedSchool('refusals');
    expect((await trialOptions(s.sifu.principal, { slug: s.slug })).state).toBe('own_school');
    expect(await codeOf(requestTrial(s.sifu.principal, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('CONFLICT');

    const unconfirmed = await member('m21-unconfirmed');
    expect((await trialOptions(unconfirmed.principal, { slug: s.slug })).state).toBe('unconfirmed');
    expect(await codeOf(requestTrial(unconfirmed.principal, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('FORBIDDEN');
    const unverified = await sender('unverified');
    await getDb().update(authUser).set({ emailVerified: false }).where(eq(authUser.id, unverified.account.id));
    const asUnverified = { ...unverified.principal, user: { ...unverified.principal.user, emailVerified: false } };
    expect(await codeOf(requestTrial(asUnverified, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('FORBIDDEN');

    const moderator = await staff('m21-moderator');
    await recordConsents(moderator.principal, { kinds: [...SIGN_UP_CONSENTS] }, meta);
    expect((await trialOptions(moderator.principal, { slug: s.slug })).state).toBe('no_profile');
    expect(await codeOf(requestTrial(moderator.principal, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('CONFLICT');

    const draft = await listedSchool('draft', { draft: true });
    const student = await sender('refusals-student');
    expect(await codeOf(trialOptions(student.principal, { slug: draft.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(requestTrial(student.principal, { schoolId: draft.id, contactMethod: 'email' }, meta))).toBe('NOT_FOUND');
    // A listed school whose Sifu lost Professional Sifu is off the public map: no requests either.
    const unpaid = await listedSchool('unpaid', { pro: false });
    expect(await codeOf(requestTrial(student.principal, { schoolId: unpaid.id, contactMethod: 'email' }, meta))).toBe('NOT_FOUND');
    expect(await getDb().select().from(trialInquiry).where(eq(trialInquiry.senderUserId, student.account.id))).toEqual([]);
  });

  it('checks its fields: a phone is needed for "by phone", the message is at most 1000 characters', async () => {
    const s = await listedSchool('fields');
    const student = await sender('fields-student');
    await expect(requestTrial(student.principal, { schoolId: s.id, contactMethod: 'phone' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { phone: expect.any(String) } });
    await expect(requestTrial(student.principal, { schoolId: s.id, contactMethod: 'phone', phone: '(-----)' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { phone: expect.any(String) } });
    await expect(requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email', message: 'x'.repeat(1001) }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { message: expect.any(String) } });
    // By e-mail, the contact is the account's own address, whatever else is sent.
    const sent = await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email', phone: `+000 000 0002 ${'0'.repeat(60)}` }, meta);
    const [row] = await getDb().select().from(trialInquiry).where(eq(trialInquiry.id, sent.id));
    expect(row!.contactValue).toBe(student.account.email);
  });
});

describe('trial lesson requests: the limits', () => {
  it('one open request per sender and school: a second waits until the first is answered', async () => {
    const s = await listedSchool('one-open');
    const student = await sender('one-open-student');
    const first = await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    expect((await trialOptions(student.principal, { slug: s.slug })).state).toBe('open');
    expect(await codeOf(requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('CONFLICT');
    // Two at once: one is stored, the other refused.
    const other = await listedSchool('one-open-race');
    const both = await Promise.all([0, 1].map(() => codeOf(requestTrial(student.principal, { schoolId: other.id, contactMethod: 'email' }, meta))));
    expect(both.sort()).toEqual(['CONFLICT', 'ok']);
    await answerTrial(s.sifu.principal, { inquiryId: first.id, reply: null }, meta);
    expect((await trialOptions(student.principal, { slug: s.slug })).state).toBe('ready');
  });

  it(`at most ${TRIAL_DAILY_LIMIT} a day, across schools`, async () => {
    const student = await sender('limit-student');
    for (let i = 0; i < TRIAL_DAILY_LIMIT; i++) {
      const s = await listedSchool(`limit-${i}`);
      await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    }
    const next = await listedSchool('limit-next');
    expect((await trialOptions(student.principal, { slug: next.slug })).state).toBe('limit');
    expect(await codeOf(requestTrial(student.principal, { schoolId: next.id, contactMethod: 'email' }, meta))).toBe('TOO_MANY_REQUESTS');
    // A day later the next one goes.
    await getDb().execute(sql`UPDATE trial_inquiry SET created_at = created_at - interval '25 hours' WHERE sender_user_id = ${student.account.id}::uuid`);
    expect(await codeOf(requestTrial(student.principal, { schoolId: next.id, contactMethod: 'email' }, meta))).toBe('ok');
  });
});

describe('trial lesson requests: who reads and answers one', () => {
  it('the listing account and the admins of a linked organization see the inbox; the sender, others and staff get 404', async () => {
    const s = await listedSchool('inbox');
    const student = await sender('inbox-student');
    const sent = await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'phone', phone: '+000 000 0003', message: 'A fictional request.' }, meta);
    const orgAdmin = await member('m21-org-admin');
    const org = await getDb().execute<{ id: string }>(sql`SELECT id FROM organization WHERE status = 'active' ORDER BY slug LIMIT 1`);
    const organizationId = org.rows[0]!.id;
    await getDb().execute(sql`INSERT INTO organization_admin (organization_id, user_id, role) VALUES (${organizationId}::uuid, ${orgAdmin.account.id}::uuid, 'admin')`);
    await getDb().execute(sql`INSERT INTO organization_school (organization_id, school_id, status, answered_at) VALUES (${organizationId}::uuid, ${s.id}::uuid, 'accepted', now())`);

    const own = await trialInbox(s.sifu.principal, { schoolId: s.id });
    expect(own.role).toBe('owner');
    expect(own.counts.open).toBe(1);
    expect(own.inquiries.map((q) => [q.id, q.senderName, q.contactValue])).toEqual([[sent.id, 'Demo m21 inbox student', '+000 000 0003']]);
    expect((await trialInbox(orgAdmin.principal, { schoolId: s.id })).role).toBe('organization');

    const outsider = await sender('inbox-outsider');
    for (const p of [student.principal, outsider.principal, (await staff('m21-inbox-moderator')).principal, (await staff('m21-inbox-admin', 'admin')).principal]) {
      expect(await codeOf(trialInbox(p, { schoolId: s.id }))).toBe('NOT_FOUND');
      expect(await codeOf(answerTrial(p, { inquiryId: sent.id, reply: 'No' }, meta))).toBe('NOT_FOUND');
      expect(await codeOf(declineTrial(p, { inquiryId: sent.id, reason: 'No' }, meta))).toBe('NOT_FOUND');
      expect(await codeOf(closeTrial(p, { inquiryId: sent.id }, meta))).toBe('NOT_FOUND');
    }
    // Neither the public page nor the trial options carry the request.
    const page = JSON.stringify(await schoolGet(null, { slug: s.slug }));
    expect(page).not.toContain('+000 000 0003');
    expect(page).not.toContain('fictional request');
    const asOther = JSON.stringify(await trialOptions(outsider.principal, { slug: s.slug }));
    expect(asOther).not.toContain('+000 000 0003');
    expect(asOther).not.toContain(student.account.email);
  });

  it('an admin of a linked organization handles the requests and sends none there; an admin of two linked organizations is told once', async () => {
    const s = await listedSchool('org-self');
    const orgAdmin = await sender('org-self-admin');
    const student = await sender('org-self-student');
    const orgs = await getDb().execute<{ id: string }>(sql`SELECT id FROM organization WHERE status = 'active' AND deleted_at IS NULL ORDER BY slug LIMIT 2`);
    expect(orgs.rows).toHaveLength(2);
    for (const org of orgs.rows) {
      await getDb().execute(sql`INSERT INTO organization_admin (organization_id, user_id, role) VALUES (${org.id}::uuid, ${orgAdmin.account.id}::uuid, 'admin')`);
      await getDb().execute(sql`INSERT INTO organization_school (organization_id, school_id, status, answered_at) VALUES (${org.id}::uuid, ${s.id}::uuid, 'accepted', now())`);
    }
    expect((await trialOptions(orgAdmin.principal, { slug: s.slug })).state).toBe('own_school');
    await expect(requestTrial(orgAdmin.principal, { schoolId: s.id, contactMethod: 'email' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    expect(await noticesOf(orgAdmin.account.id, 'school.trial-requested')).toHaveLength(1);
    expect(await noticesOf(s.sifu.account.id, 'school.trial-requested')).toHaveLength(1);
  });

  it('answer, decline and close: the sender is told of an answer (with the reply) and a decline (with the reason), never of a close', async () => {
    const s = await listedSchool('decide');
    const a = await sender('decide-a');
    const b = await sender('decide-b');
    const c = await sender('decide-c');
    const qa = await requestTrial(a.principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    const qb = await requestTrial(b.principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    const qc = await requestTrial(c.principal, { schoolId: s.id, contactMethod: 'email' }, meta);

    expect((await answerTrial(s.sifu.principal, { inquiryId: qa.id, reply: 'Come on Monday at 18:30.' }, meta)).status).toBe('answered');
    // A repeat is a replay, not a second notice.
    await answerTrial(s.sifu.principal, { inquiryId: qa.id, reply: 'Come on Monday at 18:30.' }, meta);
    const answered = await noticesOf(a.account.id, 'school.trial-answered');
    expect(answered).toHaveLength(1);
    expect(JSON.stringify(answered[0]!.payload)).toContain('Come on Monday at 18:30.');
    expect((await myTrialInquiries(a.principal)).inquiries[0]).toMatchObject({ status: 'answered', reply: 'Come on Monday at 18:30.' });
    // An answered request can be closed, but not declined.
    expect(await codeOf(declineTrial(s.sifu.principal, { inquiryId: qa.id, reason: null }, meta))).toBe('CONFLICT');
    expect((await closeTrial(s.sifu.principal, { inquiryId: qa.id }, meta)).status).toBe('closed');

    await declineTrial(s.sifu.principal, { inquiryId: qb.id, reason: 'The beginners class is full this month.' }, meta);
    const declined = await noticesOf(b.account.id, 'school.trial-declined');
    expect(declined).toHaveLength(1);
    expect(JSON.stringify(declined[0]!.payload)).toContain('full this month');
    expect(await codeOf(answerTrial(s.sifu.principal, { inquiryId: qb.id, reply: null }, meta))).toBe('CONFLICT');

    await closeTrial(s.sifu.principal, { inquiryId: qc.id }, meta);
    expect(await noticesOf(c.account.id)).toEqual([]);

    const inbox = await trialInbox(s.sifu.principal, { schoolId: s.id });
    expect(inbox.counts).toEqual({ open: 0, answered: 0, declined: 1, closed: 2, withdrawn: 0 });
    const rows = await getDb().select().from(trialInquiry).where(eq(trialInquiry.schoolId, s.id));
    for (const row of rows) expect(row.closedAt).not.toBeNull();
    const audits = await getDb().select({ action: auditLog.action }).from(auditLog).where(inArray(auditLog.subjectId, rows.map((r) => r.id)));
    expect(audits.map((x) => x.action).sort()).toEqual(['trial.answer', 'trial.close', 'trial.close', 'trial.decline', 'trial.request', 'trial.request', 'trial.request']);
  });

  it('mySchools counts the open requests of each school', async () => {
    const s = await listedSchool('count');
    await requestTrial((await sender('count-a')).principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    await requestTrial((await sender('count-b')).principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    const mine = await mySchools(s.sifu.principal);
    expect(mine.schools.find((x) => x.id === s.id)!.openTrialRequests).toBe(2);
  });
});

describe('trial lesson requests: the sender withdraws one (review 2026-11, ADR 0032)', () => {
  it('removes the name, contact, times and message at once, tells nobody, frees the slot, and a second press changes nothing', async () => {
    const s = await listedSchool('withdraw');
    const student = await sender('withdraw-student');
    const sent = await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'phone', phone: '+000 000 0002', preferredTimes: 'Weekday evenings', message: 'A fictional request.' }, meta);
    const noticesBefore = (await noticesOf(student.account.id)).length;

    const done = await withdrawTrial(student.principal, { inquiryId: sent.id }, meta);
    expect(done).toMatchObject({ id: sent.id, schoolId: s.id, status: 'withdrawn', replayed: false });
    // The row stays as a withdrawn request without any of the sender's words.
    const [row] = await getDb().select().from(trialInquiry).where(eq(trialInquiry.id, sent.id));
    expect(row).toMatchObject({ status: 'withdrawn', senderName: null, contactValue: null, preferredTimes: null, message: null, reply: null, handledByUserId: null });
    expect(row!.closedAt).not.toBeNull();
    expect(row!.scrubbedAt).not.toBeNull();
    // The sender sees it as withdrawn; the school sees it without a name or a contact.
    expect((await myTrialInquiries(student.principal)).inquiries[0]).toMatchObject({ id: sent.id, status: 'withdrawn', statusLabel: 'Withdrawn', contactValue: null, message: null, scrubbed: true });
    const inbox = await trialInbox(s.sifu.principal, { schoolId: s.id });
    expect(inbox.counts).toMatchObject({ open: 0, withdrawn: 1 });
    expect(inbox.inquiries[0]).toMatchObject({ id: sent.id, status: 'withdrawn', senderName: null, contactValue: null, scrubbed: true });
    expect((await mySchools(s.sifu.principal)).schools.find((x) => x.id === s.id)!.openTrialRequests).toBe(0);
    expect((await trialInbox(s.sifu.principal, { schoolId: s.id, status: 'withdrawn' })).inquiries).toHaveLength(1);
    // Nobody is told, and the audit row carries ids and states only.
    expect((await noticesOf(student.account.id)).length).toBe(noticesBefore);
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'trial.withdraw'), eq(auditLog.subjectId, sent.id)));
    expect(audit).toMatchObject({ actorUserId: student.account.id, before: { status: 'open' }, after: { status: 'withdrawn', schoolId: s.id } });
    expect(JSON.stringify(audit)).not.toContain('+000 000 0002');
    // A second press is a replay: nothing changes, nothing is audited twice.
    expect(await withdrawTrial(student.principal, { inquiryId: sent.id }, meta)).toMatchObject({ status: 'withdrawn', replayed: true });
    expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'trial.withdraw'), eq(auditLog.subjectId, sent.id)))).toHaveLength(1);
    // The slot is free again (the daily limit still counts it).
    expect((await trialOptions(student.principal, { slug: s.slug })).state).toBe('ready');
    expect(await codeOf(requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email' }, meta))).toBe('ok');
    // The school cannot answer, decline or close it any more.
    // Started one at a time: a call started early and awaited later would reject with nobody listening.
    for (const call of [
      () => answerTrial(s.sifu.principal, { inquiryId: sent.id, reply: null }, meta),
      () => declineTrial(s.sifu.principal, { inquiryId: sent.id, reason: null }, meta),
      () => closeTrial(s.sifu.principal, { inquiryId: sent.id }, meta),
    ]) {
      expect(await codeOf(call())).toBe('CONFLICT');
    }
  });

  it('is for the sender alone and for an open request: others get 404, an answered request cannot be withdrawn', async () => {
    const s = await listedSchool('withdraw-who');
    const student = await sender('withdraw-who-student');
    const other = await sender('withdraw-who-other');
    const sent = await requestTrial(student.principal, { schoolId: s.id, contactMethod: 'email', message: 'A fictional request.' }, meta);
    expect(await codeOf(withdrawTrial(null, { inquiryId: sent.id }, meta))).toBe('UNAUTHORIZED');
    expect(await codeOf(withdrawTrial(other.principal, { inquiryId: sent.id }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(withdrawTrial(s.sifu.principal, { inquiryId: sent.id }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(withdrawTrial(student.principal, { inquiryId: 'not-an-id' }, meta))).toBe('BAD_REQUEST');
    // Untouched by all of that.
    const [row] = await getDb().select().from(trialInquiry).where(eq(trialInquiry.id, sent.id));
    expect(row).toMatchObject({ status: 'open', message: 'A fictional request.', scrubbedAt: null });

    await answerTrial(s.sifu.principal, { inquiryId: sent.id, reply: 'Come on Monday.' }, meta);
    expect(await codeOf(withdrawTrial(student.principal, { inquiryId: sent.id }, meta))).toBe('CONFLICT');
    expect((await myTrialInquiries(student.principal)).inquiries[0]).toMatchObject({ status: 'answered', reply: 'Come on Monday.', scrubbed: false });
  });
});

describe('the schedule and fees', () => {
  it('the owner saves them, with no plan; the public page shows them; the edit is listing activity and audited', async () => {
    const s = await listedSchool('schedule', { pro: true });
    await getDb().execute(sql`UPDATE school SET activity_stage = 'awaiting_confirmation', activity_awaiting_since = now() - interval '3 days' WHERE id = ${s.id}::uuid`);
    const saved = await updateSchoolSchedule(
      s.sifu.principal,
      {
        id: s.id,
        slots: [
          { weekday: 3, startsAt: '19:00', endsAt: '20:30', label: 'Advanced' },
          { weekday: 1, startsAt: '18:30', endsAt: '20:00', label: 'Beginners' },
        ],
        fees: 'A fictional monthly fee.',
        firstTrialFree: true,
      },
      meta,
    );
    expect(saved.changed).toEqual(['schedule', 'fees', 'firstTrialFree']);
    const view = await schoolSchedule(s.sifu.principal, { id: s.id });
    expect(view.slots.map((x) => [x.weekdayLabel, x.startsAt, x.endsAt, x.label])).toEqual([
      ['Monday', '18:30', '20:00', 'Beginners'],
      ['Wednesday', '19:00', '20:30', 'Advanced'],
    ]);
    const page = await schoolGet(null, { slug: s.slug });
    expect(page.schedule).toHaveLength(2);
    expect(page).toMatchObject({ fees: 'A fictional monthly fee.', firstTrialFree: true, timezone: 'Europe/Sofia' });
    const [row] = await getDb().select({ stage: school.activityStage, lastActivityAt: school.lastActivityAt, status: school.status }).from(school).where(eq(school.id, s.id));
    expect(row!.stage).toBe('current');
    expect(row!.status).toBe('active');
    expect(Date.now() - row!.lastActivityAt.getTime()).toBeLessThan(60_000);
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'school.schedule_update'), eq(auditLog.subjectId, s.id)));
    expect(audit!.after).toMatchObject({ changed: ['schedule', 'fees', 'firstTrialFree'] });
    expect(JSON.stringify(audit)).not.toContain('fictional monthly fee');
    // Saving the same again changes nothing.
    expect((await updateSchoolSchedule(s.sifu.principal, { id: s.id, slots: view.slots, fees: 'A fictional monthly fee.', firstTrialFree: true }, meta)).changed).toEqual([]);
  });

  it('a Free Sifu saves them too; nobody else reaches them; the fields are checked', async () => {
    const s = await listedSchool('schedule-free', { pro: false });
    expect((await updateSchoolSchedule(s.sifu.principal, { id: s.id, slots: [{ weekday: 6, startsAt: '10:00', endsAt: '12:00' }] }, meta)).changed).toEqual(['schedule']);
    const other = await sender('schedule-other');
    expect(await codeOf(schoolSchedule(other.principal, { id: s.id }))).toBe('NOT_FOUND');
    expect(await codeOf(updateSchoolSchedule(other.principal, { id: s.id, slots: [] }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(schoolSchedule((await staff('m21-schedule-admin', 'admin')).principal, { id: s.id }))).toBe('NOT_FOUND');
    await expect(updateSchoolSchedule(s.sifu.principal, { id: s.id, slots: [{ weekday: 1, startsAt: '20:00', endsAt: '19:00' }] }, meta)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      fields: { 'slots.0.endsAt': expect.any(String) },
    });
    const many = Array.from({ length: 31 }, () => ({ weekday: 1, startsAt: '10:00', endsAt: '11:00' }));
    await expect(updateSchoolSchedule(s.sifu.principal, { id: s.id, slots: many }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(updateSchoolSchedule(s.sifu.principal, { id: s.id, fees: 'x'.repeat(501) }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { fees: expect.any(String) } });
  });
});

describe('the school stats', () => {
  it('counts a visitor, never the listing account, staff, a bot or a school that is not public', async () => {
    const s = await listedSchool('track');
    const visitor = await sender('track-visitor');
    expect(await trackSchoolEvent(null, { schoolId: s.id, event: 'page_view' }, meta)).toEqual({ counted: true });
    expect(await trackSchoolEvent(visitor.principal, { schoolId: s.id, event: 'pin_open' }, meta)).toEqual({ counted: true });
    expect(await trackSchoolEvent(visitor.principal, { schoolId: s.id, event: 'contact_click' }, meta)).toEqual({ counted: true });
    expect(await trackSchoolEvent(s.sifu.principal, { schoolId: s.id, event: 'page_view' }, meta)).toEqual({ counted: false });
    expect(await trackSchoolEvent((await staff('m21-track-moderator')).principal, { schoolId: s.id, event: 'page_view' }, meta)).toEqual({ counted: false });
    expect(await trackSchoolEvent(null, { schoolId: s.id, event: 'page_view' }, { ...meta, likelyBot: true })).toEqual({ counted: false });
    // The browser cannot report a trial inquiry: the server counts those.
    await expect(trackSchoolEvent(null, { schoolId: s.id, event: 'trial_inquiry' as never }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const draft = await listedSchool('track-draft', { draft: true });
    expect(await trackSchoolEvent(null, { schoolId: draft.id, event: 'page_view' }, meta)).toEqual({ counted: false });
    await requestTrial(visitor.principal, { schoolId: s.id, contactMethod: 'email' }, meta);
    expect(await counters(s.id)).toEqual({ pageViews: 1, pinOpens: 1, contactClicks: 1, trialInquiries: 1 });
    expect(await counters(draft.id)).toEqual({ pageViews: 0, pinOpens: 0, contactClicks: 0, trialInquiries: 0 });
    // Counts only: the table has no column for the visitor.
    const columns = await getDb().execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'school_stat_day' ORDER BY column_name`);
    expect(columns.rows.map((r) => r.column_name)).toEqual(['contact_clicks', 'created_at', 'day', 'page_views', 'pin_opens', 'school_id', 'trial_inquiries', 'updated_at']);
  });

  it('the owner on Professional Sifu sees 12 ISO weeks; on Free Sifu no numbers and the upgrade offer; nobody else reaches them', async () => {
    const s = await listedSchool('stats');
    await getDb().execute(sql`
      INSERT INTO school_stat_day (school_id, day, page_views, pin_opens, contact_clicks, trial_inquiries) VALUES
        (${s.id}::uuid, (now() AT TIME ZONE 'UTC')::date, 5, 2, 1, 0),
        (${s.id}::uuid, (now() AT TIME ZONE 'UTC')::date - 7, 3, 1, 0, 1),
        (${s.id}::uuid, (now() AT TIME ZONE 'UTC')::date - 100, 50, 0, 0, 0)`);
    const view = await schoolStats(s.sifu.principal, { id: s.id });
    expect(view.available).toBe(true);
    expect(view.weeks).toHaveLength(12);
    expect(new Date(`${view.weeks[11]!.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(view.weeks[11]!.pageViews).toBe(5);
    expect(view.weeks[10]!.pageViews).toBe(3);
    expect(view.totals).toEqual({ pageViews: 8, pinOpens: 3, contactClicks: 1, trialInquiries: 1 });
    expect(view.later).toBe(false);
    expect(view.earlier).toBe(true);
    // Earlier weeks: the day 100 days back is among them.
    const earlier = await schoolStats(s.sifu.principal, { id: s.id, weekOf: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10) });
    expect(earlier.totals!.pageViews).toBe(50);
    expect(earlier.later).toBe(true);
    // A day in the future counts as today.
    expect((await schoolStats(s.sifu.principal, { id: s.id, weekOf: '2999-01-01' })).lastWeekStart).toBe(view.lastWeekStart);

    const free = await listedSchool('stats-free', { pro: false });
    await countSchoolEvent(getDb(), free.id, 'page_view');
    const gated = await schoolStats(free.sifu.principal, { id: free.id });
    expect(gated).toMatchObject({ available: false, weeks: [], totals: null });
    expect(gated.upgrade).toMatchObject({ feature: 'school_business', to: { code: 'pro_sifu' } });
    expect(JSON.stringify(gated)).not.toMatch(/"pageViews"/);

    for (const p of [(await sender('stats-other')).principal, (await staff('m21-stats-admin', 'admin')).principal]) {
      expect(await codeOf(schoolStats(p, { id: s.id }))).toBe('NOT_FOUND');
    }
    expect(await codeOf(schoolStats(null, { id: s.id }))).toBe('UNAUTHORIZED');
  });
});

describe('retention (the daily retention.purge job), as app_rw', () => {
  it('deletes requests a year after they closed and counters older than 400 days, and nothing else', async () => {
    const db = createRoleDatabase('app_rw', testDb!.url, rolePassword('app_rw'));
    try {
      const s = await listedSchool('retention');
      const ids: Record<string, string> = {};
      for (const [label, status, closedAgo] of [
        ['closed-old', 'closed', '366 days'],
        ['declined-old', 'declined', '400 days'],
        ['answered-new', 'answered', '364 days'],
        ['open-old', 'open', null],
      ] as const) {
        const who = await sender(`retention-${label}`);
        const [row] = await getDb()
          .insert(trialInquiry)
          .values({
            schoolId: s.id,
            senderUserId: who.account.id,
            senderName: 'Demo Sender',
            contactMethod: 'email',
            contactValue: who.account.email,
            status,
            createdAt: sql`now() - interval '500 days'`,
            closedAt: closedAgo ? sql`now() - ${closedAgo}::interval` : null,
          })
          .returning({ id: trialInquiry.id });
        ids[label] = row!.id;
      }
      await getDb().execute(sql`
        INSERT INTO school_stat_day (school_id, day, page_views) VALUES
          (${s.id}::uuid, (now() AT TIME ZONE 'UTC')::date - 401, 1),
          (${s.id}::uuid, (now() AT TIME ZONE 'UTC')::date - 400, 1),
          (${s.id}::uuid, (now() AT TIME ZONE 'UTC')::date - 1, 1)`);
      const purged = await purgeOldTrialData(db, { batchSize: 1 });
      expect(purged.inquiries).toBeGreaterThanOrEqual(2);
      expect(purged.counters).toBeGreaterThanOrEqual(1);
      const left = await getDb().select({ id: trialInquiry.id }).from(trialInquiry).where(eq(trialInquiry.schoolId, s.id));
      expect(left.map((r) => r.id).sort()).toEqual([ids['answered-new'], ids['open-old']].sort());
      const days = await getDb().execute<{ age: number }>(sql`SELECT ((now() AT TIME ZONE 'UTC')::date - day) AS age FROM school_stat_day WHERE school_id = ${s.id}::uuid ORDER BY day`);
      expect(days.rows.map((r) => Number(r.age))).toEqual([400, 1]);
      // Idempotent.
      expect(await purgeOldTrialData(db)).toEqual({ inquiries: 0, counters: 0 });
    } finally {
      await db.$client.end();
    }
  });
});

describe('the demo data', () => {
  it('demo-school-sofia has a schedule, fees, one open and one answered request, and weeks of counters', async () => {
    const [sofia] = await getDb().select().from(school).where(eq(school.slug, 'demo-school-sofia'));
    expect(sofia!.firstTrialFree).toBe(true);
    expect(sofia!.feesText).toMatch(/fictional/i);
    const page = await schoolGet(null, { slug: 'demo-school-sofia' });
    expect(page.schedule.length).toBeGreaterThanOrEqual(3);
    const inquiries = await getDb().select({ status: trialInquiry.status }).from(trialInquiry).where(eq(trialInquiry.schoolId, sofia!.id));
    expect(inquiries.map((r) => r.status).sort()).toEqual(['answered', 'open']);
    const days = await getDb().select().from(schoolStatDay).where(eq(schoolStatDay.schoolId, sofia!.id));
    expect(days).toHaveLength(DEMO_STAT_DAYS);
    expect(days.map((d) => d.day).sort().at(-1)).toBe(DEMO_STATS_LAST_DAY);
  });
});
