// Names, search, consents and deletion requests against the seeded demo data (milestone M07, In
// scope 1–3, 5, 7): the job that writes the keys of existing records, search by every spelling and
// only of public records, the profile editor (own person only, a Latin-script primary name), the
// withdrawal of a consent and a deletion request. Fictional demo data only (D20).

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv } from '../auth/test-support';
import type { Principal } from '../auth/principal';
import { closeDb, getDb } from '../db';
import { auditLog, consentRecord, notification, person, personName, personNameKey, reviewCase } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { personHitSchema, searchResultSchema } from '../dto/search';
import { stopProducer } from '../jobs/boss';
import { searchKeysRebuildHandler } from '../jobs/worker';
import { handleApiRequest } from '../rpc/handler';
import { consentWithdraw, privacyOverview, requestAccountDeletion } from './privacy';
import { MISSING_PRIMARY_MESSAGE, profileGet, profileUpdate } from './profile';
import { searchQuery } from './search';

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
const ids: Record<string, string> = {};
const users: Record<string, string> = {};
const meta = { requestId: 'm07-int-test', ipHmac: null };

const SLUGS = ['demo-cjk-name', 'demo-latin-name', 'demo-cyrillic-name', 'demo-pending', 'demo-hub-a', 'demo-claim-only-teacher', 'demo-root-a'];

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  const rows = await getDb().execute<{ slug: string; id: string; claimed_by_user_id: string | null }>(
    sql`SELECT slug, id::text AS id, claimed_by_user_id::text AS claimed_by_user_id FROM person WHERE slug = ANY(${`{${SLUGS.join(',')}}`}::text[])`,
  );
  for (const r of rows.rows) {
    ids[r.slug] = r.id;
    if (r.claimed_by_user_id) users[r.slug] = r.claimed_by_user_id;
  }
  expect(Object.keys(ids).sort()).toEqual([...SLUGS].sort());
});

afterAll(async () => {
  await stopProducer();
  await closeDb();
  await testDb?.drop();
});

function principalOf(userId: string, role: Principal['user']['role'] = 'user'): Principal {
  return {
    user: { id: userId, email: 'demo@example.test', emailVerified: true, role, twoFactorEnabled: false },
    session: { id: 'test-session', expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: null },
    via: 'bearer',
  };
}

type RebuildJob = Parameters<ReturnType<typeof searchKeysRebuildHandler>>[0][number];
const job = { id: 'job-1', name: 'search.keys.rebuild', data: {}, retryCount: 0, retryLimit: 3 } as unknown as RebuildJob;
const peopleSlugs = async (q: string, filters: { country?: string; lineageId?: string } = {}) =>
  (await searchQuery(null, { q, ...filters })).people.map((p) => p.slug);

describe('search.keys.rebuild writes the keys of the existing demo data', () => {
  it('starts with no keys after db:seed, and the job writes them for every person', async () => {
    const [before] = await getDb().select({ n: sql<number>`count(*)::int` }).from(personNameKey);
    expect(before!.n).toBe(0);
    const lines: string[] = [];
    await searchKeysRebuildHandler(getDb(), (line) => lines.push(line))([job]);
    const [after] = await getDb().select({ n: sql<number>`count(*)::int` }).from(personNameKey);
    expect(after!.n).toBeGreaterThan(1000);
    expect(lines).toEqual([expect.stringMatching(/^search\.keys\.rebuild: wrote \d+ key\(s\) for \d+ person\(s\)$/)]);
    // Logs carry counts only: no name and no key.
    expect(lines.join('\n')).not.toMatch(/sou|testov|蘇/i);
    const cjk = await getDb().select({ key: personNameKey.key, kind: personNameKey.keyKind, source: personNameKey.source }).from(personNameKey).where(eq(personNameKey.personId, ids['demo-cjk-name']!));
    expect(cjk).toContainEqual({ key: 'sou cing laam', kind: 'jyutping', source: 'to-jyutping' });
    expect(cjk).toContainEqual({ key: 'su qing lan', kind: 'pinyin', source: 'pinyin-pro' });
    expect(cjk).toContainEqual({ key: '苏晴岚', kind: 'han', source: 'opencc-js' });
  });

  it('is idempotent: a second run leaves the same keys', async () => {
    const snapshot = async () =>
      (await getDb().execute<{ k: string }>(sql`SELECT person_name_id || ':' || key_kind || ':' || key AS k FROM person_name_key ORDER BY 1`)).rows.map((r) => r.k);
    const first = await snapshot();
    await searchKeysRebuildHandler(getDb(), () => undefined)([job]);
    expect(await snapshot()).toEqual(first);
  });
});

describe('search.query', () => {
  it('"Тестов" finds demo-latin-name through the Streamlined System', async () => {
    expect(await peopleSlugs('Тестов')).toContain('demo-latin-name');
  });

  it('a Jyutping query finds demo-cjk-name and shows its stored Jyutping name', async () => {
    const result = await searchQuery(null, { q: 'sou1 cing4 laam4' });
    const hit = result.people.find((p) => p.slug === 'demo-cjk-name');
    expect(hit).toBeDefined();
    expect(hit!.displayName).toEqual({ value: 'So Ching Laam', lang: 'yue-Latn', script: 'Latn' });
    expect(hit!.matched).toEqual({ value: 'sou1 cing4 laam4', lang: 'yue-Latn', script: 'Latn' });
  });

  it('Simplified and Traditional spellings, a prefix of the characters and toneless pinyin find the same person', async () => {
    expect((await peopleSlugs('蘇晴嵐'))[0]).toBe('demo-cjk-name');
    expect((await peopleSlugs('苏晴岚'))[0]).toBe('demo-cjk-name');
    expect(await peopleSlugs('蘇晴')).toContain('demo-cjk-name');
    expect(await peopleSlugs('su qing lan')).toContain('demo-cjk-name');
    expect(await peopleSlugs('Su Qinglan')).toContain('demo-cjk-name');
    expect(await peopleSlugs('So Ching')).toContain('demo-cjk-name');
  });

  it('a Cyrillic name is found in Cyrillic and in Latin letters', async () => {
    expect(await peopleSlugs('Примерова')).toContain('demo-cyrillic-name');
    expect(await peopleSlugs('primerova')).toContain('demo-cyrillic-name');
  });

  it('ranks an exact match on a primary name first', async () => {
    expect((await peopleSlugs('Ivan Testov'))[0]).toBe('demo-latin-name');
  });

  it('never returns a person that is not public, whatever its keys say', async () => {
    const hidden = await getDb()
      .select({ value: personName.value })
      .from(personName)
      .where(and(eq(personName.personId, ids['demo-claim-only-teacher']!), eq(personName.isPrimary, true)));
    const [pending] = await getDb().select({ visibility: person.visibility }).from(person).where(eq(person.id, ids['demo-pending']!));
    expect(pending!.visibility).toBe('involved_only');
    const pendingName = await getDb().select({ value: personName.value }).from(personName).where(and(eq(personName.personId, ids['demo-pending']!), eq(personName.isPrimary, true)));
    for (const q of [hidden[0]!.value, pendingName[0]!.value]) {
      const slugs = await peopleSlugs(q);
      expect(slugs).not.toContain('demo-claim-only-teacher');
      expect(slugs).not.toContain('demo-pending');
    }
  });

  it('a country filter returns only people and schools of that country', async () => {
    const [cjk] = await getDb().select({ country: person.countryCode }).from(person).where(eq(person.id, ids['demo-cjk-name']!));
    const country = cjk!.country ?? 'HK';
    if (!cjk!.country) await getDb().update(person).set({ countryCode: country }).where(eq(person.id, ids['demo-cjk-name']!));
    const other = country === 'BG' ? 'GB' : 'BG';
    const inCountry = await searchQuery(null, { q: 'So Ching Laam', country });
    expect(inCountry.people.map((p) => p.slug)).toContain('demo-cjk-name');
    for (const p of inCountry.people) expect(p.countryCode).toBe(country);
    for (const s of inCountry.schools) expect(s.countryCode).toBe(country);
    const elsewhere = await searchQuery(null, { q: 'So Ching Laam', country: other });
    expect(elsewhere.people.map((p) => p.slug)).not.toContain('demo-cjk-name');
    for (const p of elsewhere.people) expect(p.countryCode).toBe(other);
  });

  it('answers only the public DTO: no keys, no account ids, no private columns', async () => {
    const result = await searchQuery(null, { q: 'so' });
    expect(searchResultSchema.parse(result)).toEqual(result);
    for (const hit of result.people) expect(Object.keys(hit).sort()).toEqual(Object.keys(personHitSchema.shape).sort());
    const text = JSON.stringify((await searchQuery(null, { q: 'sou cing laam' })).people);
    // The generated keys (toneless, spaced or compact) never appear: only stored names.
    expect(text).not.toContain('"sou cing laam"');
    expect(text).not.toContain('soucinglaam');
    expect(text).not.toMatch(/claimed_by|claimedBy|birth|email|public_point|source/);
  });

  it('limits the searches of one client in a short window (429), and counts each client apart', async () => {
    const flood = { requestId: 'flood', ipHmac: 'demo-flood-client' };
    for (let i = 0; i < 40; i++) await searchQuery(null, { q: 'so' }, flood);
    await expect(searchQuery(null, { q: 'so' }, flood)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
    await expect(searchQuery(null, { q: 'so' }, { requestId: 'other', ipHmac: 'demo-other-client' })).resolves.toBeDefined();
  });

  it('reads the keys of public people only, through v_public_person_key', async () => {
    const counts = await getDb().execute<{ hidden: number }>(sql`
      SELECT count(*)::int AS hidden FROM v_public_person_key k JOIN person p ON p.id = k.person_id WHERE p.visibility <> 'public'`);
    expect(counts.rows[0]!.hidden).toBe(0);
    const pending = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_person_key WHERE person_id = ${ids['demo-claim-only-teacher']}::uuid`);
    expect(pending.rows[0]!.n).toBe(0);
  });

  it('refuses a query that is too long or a country that is not one, and answers an empty query with nothing', async () => {
    await expect(searchQuery(null, { q: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(searchQuery(null, { q: 'so', country: 'XX' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await searchQuery(null, { q: '   ' })).toEqual({ query: '', people: [], schools: [], lineages: [] });
  });

  it('is served at POST /api/v1/search to anonymous callers (the query never in a URL)', async () => {
    const response = await handleApiRequest(
      new Request('http://127.0.0.1:3100/api/v1/search', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3100' }, body: JSON.stringify({ q: 'Тестов' }) }),
      'openapi',
    );
    expect(response.status).toBe(200);
    const body = searchResultSchema.parse(await response.json());
    expect(body.people.map((p) => p.slug)).toContain('demo-latin-name');
  });
});

describe('profile.update', () => {
  const names = (primary = 'Demo Pending Example') => [
    { kind: 'name' as const, value: primary, script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true },
    { kind: 'name' as const, value: '測試雲', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: false },
    { kind: 'name' as const, value: 'Тест Облак', script: 'Cyrl', lang: 'bg-Cyrl', romanization: null, isPrimary: false },
    { kind: 'romanization' as const, value: 'caak1 si3 wan4', script: 'Latn', lang: 'yue-Latn', romanization: 'jyutping' as const, isPrimary: false },
  ];

  it('saves the own names in three scripts losslessly, rewrites the keys and audits without names', async () => {
    const p = principalOf(users['demo-pending']!);
    const result = await profileUpdate(p, { names: names(), bio: { body: 'A fictional biography.', lang: 'en' }, showPublicly: false }, meta);
    expect(result.profile.names.map((n) => n.value)).toEqual(['Demo Pending Example', '測試雲', 'Тест Облак', 'caak1 si3 wan4']);
    expect(result.profile.bio).toEqual({ body: 'A fictional biography.', lang: 'en' });
    const keys = await getDb().select({ key: personNameKey.key }).from(personNameKey).where(eq(personNameKey.personId, ids['demo-pending']!));
    expect(keys.map((k) => k.key)).toEqual(expect.arrayContaining(['demo pending example', '测试云', 'test oblak', 'caak si wan']));
    const [audit] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'person.update'), eq(auditLog.subjectId, ids['demo-pending']!)));
    expect(audit).toBeDefined();
    const logged = JSON.stringify(audit);
    for (const value of ['Demo Pending Example', '測試雲', 'Тест Облак', 'fictional biography']) expect(logged).not.toContain(value);
    expect(cache.revalidated).toContain(`person:${ids['demo-pending']}`);
    // Still private: the box was not ticked.
    expect(await peopleSlugs('Demo Pending Example')).not.toContain('demo-pending');
  });

  it('refuses another person (403) and a profile without a Latin-script primary name (400)', async () => {
    const p = principalOf(users['demo-pending']!);
    await expect(profileUpdate(p, { personId: ids['demo-hub-a'], names: names(), showPublicly: false }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    // Refused for being someone else's before its content is judged (a name in no Latin letters here).
    const noLatinAtAll = [{ kind: 'name' as const, value: '測試雲', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: true }];
    await expect(profileUpdate(p, { personId: ids['demo-cjk-name'], names: noLatinAtAll, showPublicly: false }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const noLatin = names().map((n) => ({ ...n, isPrimary: n.script === 'Hant' }));
    await expect(profileUpdate(p, { names: noLatin, showPublicly: false }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', message: MISSING_PRIMARY_MESSAGE });
    await expect(profileUpdate(p, { names: names().slice(1), showPublicly: false }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', message: MISSING_PRIMARY_MESSAGE });
    await expect(profileUpdate(null, { names: names(), showPublicly: false }, meta)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('"Show my profile publicly" publishes the self-stewarded profile with the publication consent, and makes it searchable', async () => {
    const userId = users['demo-pending']!;
    const result = await profileUpdate(principalOf(userId), { names: names(), showPublicly: true }, meta);
    expect(result.visibilityChanged).toBe(true);
    expect(result.profile.visibility).toBe('public');
    expect(await peopleSlugs('測試雲')).toContain('demo-pending');
    expect(await peopleSlugs('caak si wan')).toContain('demo-pending');
    const consents = await getDb().select().from(consentRecord).where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, 'publication')));
    expect(consents.map((c) => c.action)).toEqual(['granted']);
    const view = await profileGet(principalOf(userId));
    expect(view.profile!.visibility).toBe('public');
  });
});

describe('consent.withdraw and account.requestDeletion', () => {
  it('withdrawing publication records consent.withdraw and takes the profile out of public view', async () => {
    const userId = users['demo-pending']!;
    const result = await consentWithdraw(principalOf(userId), { kinds: ['publication'] }, meta);
    expect(result).toEqual({ withdrawn: ['publication'], profileHidden: true });
    const rows = await getDb().select({ action: consentRecord.action }).from(consentRecord).where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, 'publication')));
    expect(rows.map((r) => r.action).sort()).toEqual(['granted', 'withdrawn']);
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'consent.withdraw'), eq(auditLog.subjectId, userId)));
    expect(audits).toHaveLength(1);
    expect(await peopleSlugs('測試雲')).not.toContain('demo-pending');
    const overview = await privacyOverview(principalOf(userId));
    expect(overview.consents.find((c) => c.kind === 'publication')!.state).toBe('withdrawn');
    expect(overview.profile!.visibility).toBe('involved_only');
  });

  it('refuses to withdraw a required consent', async () => {
    await expect(consentWithdraw(principalOf(users['demo-pending']!), { kinds: ['terms'] }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a deletion request opens one review case, notifies every admin and is audited', async () => {
    const userId = users['demo-root-a']!;
    const first = await requestAccountDeletion(principalOf(userId), { confirm: true }, meta);
    expect(first.created).toBe(true);
    const again = await requestAccountDeletion(principalOf(userId), { confirm: true }, meta);
    expect(again).toEqual({ request: first.request, created: false });
    const cases = await getDb().select().from(reviewCase).where(and(eq(reviewCase.kind, 'deletion_request'), eq(reviewCase.openedByUserId, userId)));
    expect(cases).toHaveLength(1);
    expect(cases[0]!.personId).toBe(ids['demo-root-a']);
    const admins = await getDb().execute<{ id: string }>(sql`SELECT id FROM auth_user WHERE role = 'admin'`);
    const notes = await getDb().select().from(notification).where(eq(notification.template, 'account.deletion-requested'));
    expect(notes.map((n) => n.userId).sort()).toEqual(admins.rows.map((r) => r.id).sort());
    for (const n of notes) expect(n.payload).toEqual({ caseId: first.request.id });
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.deletion_request'), eq(auditLog.actorUserId, userId)));
    expect(audits).toHaveLength(1);
    expect((await privacyOverview(principalOf(userId))).deletionRequest).toEqual(first.request);
    await expect(requestAccountDeletion(principalOf(userId), { confirm: false }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
