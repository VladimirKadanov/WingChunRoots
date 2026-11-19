// The featured profile (ADR 0047): links of a public person whose plan includes them, staff
// removing one with a reason, the longer biography, the training periods on the full timeline and
// the rank and school of the search card. Paying never shows a person who is not public.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, entitlementGrant, notification, passportRank, personBio, personLink, place, school, teachingRelationship, trainingPeriod } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { cleanLinkUrl, featuredSearchCards, myProfileLinks, profileLinks, removeProfileLink, setProfileLinks } from './featured-profile';
import { passportGet } from './passport';
import { profileGet, profileUpdate } from './profile';
import { member, meta, newLineage, staff } from './relationships.test-support';

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

const grant = async (userId: string, planCode: 'premium_student' | 'pro_sifu' = 'premium_student') => {
  const [row] = await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode, source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: ADR 0047 test plan' })
    .returning({ id: entitlementGrant.id });
  return row!.id;
};
const endGrant = (id: string) => getDb().update(entitlementGrant).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(entitlementGrant.id, id));

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'answered',
    (error: { code?: string }) => error.code,
  );

const NAMES = (label: string) => [{ value: `Demo ${label}`, script: 'Latn', lang: 'en', isPrimary: true }];

describe('the address of a link', () => {
  it('takes https only, without credentials or a port, on a host with a dot', () => {
    expect(cleanLinkUrl(' https://example.test/kwoon ')).toBe('https://example.test/kwoon');
    expect(cleanLinkUrl('http://example.test/')).toBeNull();
    expect(cleanLinkUrl('javascript:alert(1)')).toBeNull();
    expect(cleanLinkUrl('https://user:secret@example.test/')).toBeNull();
    expect(cleanLinkUrl('https://example.test:8443/')).toBeNull();
    expect(cleanLinkUrl('https://localhost/')).toBeNull();
    expect(cleanLinkUrl('https://example.test/a b')).toBeNull();
    expect(cleanLinkUrl(`https://example.test/${'x'.repeat(600)}`)).toBeNull();
  });
});

describe('profile links (ADR 0047)', () => {
  it('are saved on a featured plan only, shown while public, and kept but not shown after the plan ends', async () => {
    const student = await member('links-student');
    const links = [
      { label: 'Demo school site', url: 'https://example.test/school' },
      { label: '  Demo   page ', url: 'https://example.test/me' },
    ];
    expect(await codeOf(setProfileLinks(student.principal, { links }, meta))).toBe('ENTITLEMENT_REQUIRED');
    expect((await myProfileLinks(student.principal)).allowed).toBe(false);

    const grantId = await grant(student.account.id);
    const saved = await setProfileLinks(student.principal, { links }, meta);
    expect(saved.links.map((l) => [l.label, l.url])).toEqual([
      ['Demo school site', 'https://example.test/school'],
      ['Demo page', 'https://example.test/me'],
    ]);
    expect((await profileLinks(null, { slug: student.slug })).links.map((l) => l.label)).toEqual(['Demo school site', 'Demo page']);
    const audited = await getDb().select({ action: auditLog.action, after: auditLog.after }).from(auditLog).where(eq(auditLog.subjectId, student.personId));
    expect(audited).toContainEqual({ action: 'person.links', after: { links: 2 } });

    // Field errors name the row; nothing is saved.
    const bad = (await setProfileLinks(student.principal, { links: [links[0]!, { label: '', url: 'http://example.test/' }] }, meta).catch((e: unknown) => e)) as {
      code: string;
      fields: Record<string, string>;
    };
    expect(bad.code).toBe('BAD_REQUEST');
    expect(Object.keys(bad.fields).sort()).toEqual(['links.1.label', 'links.1.url']);
    expect(await codeOf(setProfileLinks(student.principal, { links: Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: `https://example.test/${i}` })) }, meta))).toBe('BAD_REQUEST');

    await endGrant(grantId);
    expect((await profileLinks(null, { slug: student.slug })).links).toEqual([]);
    const own = await myProfileLinks(student.principal);
    expect(own.allowed).toBe(false);
    expect(own.links).toHaveLength(2);
  });

  it('are NOT_FOUND for a person who is not public, whatever the plan', async () => {
    const hidden = await member('links-hidden', { hidden: true });
    await grant(hidden.account.id);
    await setProfileLinks(hidden.principal, { links: [{ label: 'Demo', url: 'https://example.test/' }] }, meta);
    expect(await codeOf(profileLinks(null, { slug: hidden.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(profileLinks(null, { slug: 'Not a slug!' }))).toBe('NOT_FOUND');
  });

  it('can be removed by staff with a verified second factor and a reason the owner is sent', async () => {
    const owner = await member('links-owner');
    await grant(owner.account.id);
    const { links } = await setProfileLinks(
      owner.principal,
      {
        links: [
          { label: 'Demo one', url: 'https://example.test/1' },
          { label: 'Demo two', url: 'https://example.test/2' },
          { label: 'Demo three', url: 'https://example.test/3' },
        ],
      },
      meta,
    );
    const moderator = await staff('links-moderator');
    const unverified = await staff('links-unverified', 'moderator', { unverified: true });
    const reason = 'Demo: the address leads to an unrelated shop.';
    expect(await codeOf(removeProfileLink(owner.principal, { id: links[1]!.id, reason }, meta))).toBe('FORBIDDEN');
    expect(await codeOf(removeProfileLink(unverified.principal, { id: links[1]!.id, reason }, meta))).not.toBe('answered');
    expect(await codeOf(removeProfileLink(moderator.principal, { id: links[1]!.id, reason: ' ' }, meta))).toBe('BAD_REQUEST');

    expect(await removeProfileLink(moderator.principal, { id: links[1]!.id, reason }, meta)).toEqual({ id: links[1]!.id, removed: true });
    const left = await getDb().select({ label: personLink.label, position: personLink.position }).from(personLink).where(eq(personLink.personId, owner.personId)).orderBy(personLink.position);
    expect(left).toEqual([
      { label: 'Demo one', position: 0 },
      { label: 'Demo three', position: 1 },
    ]);
    const [audit] = await getDb().select({ reason: auditLog.reason }).from(auditLog).where(and(eq(auditLog.subjectId, links[1]!.id), eq(auditLog.action, 'person.link_remove')));
    expect(audit?.reason).toBe(reason);
    const told = await getDb().select({ template: notification.template }).from(notification).where(and(eq(notification.userId, owner.account.id), eq(notification.template, 'content.removed')));
    expect(told).toHaveLength(1);
    expect(await codeOf(removeProfileLink(moderator.principal, { id: links[1]!.id, reason }, meta))).toBe('NOT_FOUND');
  });
});

describe('the longer biography (ADR 0047)', () => {
  it('takes 2,000 characters on a featured plan; on a lower plan it may stay as long as it is, never longer', async () => {
    const student = await member('bio-student');
    const long = 'x'.repeat(1500);
    expect((await profileGet(student.principal)).options.bioMaxLength).toBe(1000);
    expect(await codeOf(profileUpdate(student.principal, { names: NAMES('bio student'), showPublicly: true, bio: { body: long, lang: 'en' } }, meta))).toBe('BAD_REQUEST');

    const grantId = await grant(student.account.id);
    expect((await profileGet(student.principal)).options.bioMaxLength).toBe(2000);
    await profileUpdate(student.principal, { names: NAMES('bio student'), showPublicly: true, bio: { body: long, lang: 'en' } }, meta);
    expect(await codeOf(profileUpdate(student.principal, { names: NAMES('bio student'), showPublicly: true, bio: { body: 'x'.repeat(2001), lang: 'en' } }, meta))).toBe('BAD_REQUEST');

    await endGrant(grantId);
    expect((await profileGet(student.principal)).options.bioMaxLength).toBe(1500);
    // Saving the profile again keeps the biography as written.
    await profileUpdate(student.principal, { names: NAMES('bio student'), showPublicly: true, bio: { body: long, lang: 'en' } }, meta);
    const [bio] = await getDb().select({ body: personBio.body }).from(personBio).where(eq(personBio.personId, student.personId));
    expect(bio?.body).toHaveLength(1500);
    expect(await codeOf(profileUpdate(student.principal, { names: NAMES('bio student'), showPublicly: true, bio: { body: 'x'.repeat(1600), lang: 'en' } }, meta))).toBe('BAD_REQUEST');
  });
});

describe('the training timeline and the search card (ADR 0047)', () => {
  it('show when the student began with each teacher, and where, and the rank and school, only on a featured plan', async () => {
    const db = getDb();
    const teacher = await member('timeline-teacher', { sifu: true });
    const student = await member('timeline-student');
    const lineageId = await newLineage('timeline');
    const [city] = await db
      .insert(place)
      .values({ geonamesId: 800000 + Math.floor(Math.random() * 90000), name: 'Demo Timeline City', asciiName: 'Demo Timeline City', countryCode: 'BG', centroid: { lng: 23.3, lat: 42.7 } })
      .returning({ id: place.id, centroid: place.centroid });
    const [kwoon] = await db
      .insert(school)
      .values({ slug: `demo-timeline-kwoon-${Date.now()}`, name: 'Demo Timeline Kwoon', placeId: city!.id, locationPrivacy: 'city_only', publicPoint: city!.centroid, status: 'active', createdByUserId: null })
      .returning({ id: school.id });
    const [rel] = await db
      .insert(teachingRelationship)
      .values({ teacherPersonId: teacher.personId, studentPersonId: student.personId, lineageId, status: 'verified', visibility: 'public', confirmedAt: new Date() })
      .returning({ id: teachingRelationship.id });
    await db.insert(trainingPeriod).values({ relationshipId: rel!.id, startsOn: '2018-03-01', precision: 'month', ongoing: true, schoolId: kwoon!.id });
    await db.insert(passportRank).values({ personId: student.personId, rank: 'Demo timeline level', on: '2021-06-01', precision: 'month', visibility: 'public' });

    // Free Student: no training entries (and no full timeline), no card.
    const free = await passportGet(null, { slug: student.slug });
    expect(free.timeline.flatMap((y) => y.items).filter((e) => e.kind === 'training')).toEqual([]);
    expect((await featuredSearchCards(db, [student.personId])).get(student.personId)).toBeUndefined();

    await grant(student.account.id);
    const featured = await passportGet(null, { slug: student.slug });
    const training = featured.timeline.flatMap((y) => y.items).filter((e) => e.kind === 'training');
    expect(training).toHaveLength(1);
    expect(training[0]).toMatchObject({ date: '2018-03', title: 'Began training with Demo timeline teacher', school: { name: 'Demo Timeline Kwoon' }, teacher: { slug: teacher.slug } });
    expect((await featuredSearchCards(db, [student.personId, teacher.personId])).get(student.personId)).toEqual({ rank: 'Demo timeline level', school: { slug: expect.any(String), name: 'Demo Timeline Kwoon' } });
    expect((await featuredSearchCards(db, [teacher.personId])).has(teacher.personId)).toBe(false);
  });
});
