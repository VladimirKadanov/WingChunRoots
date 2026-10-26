// Names, search, consents and deletion requests against the seeded demo data (milestone M07, In
// scope 1–3, 5, 7): the job that writes the keys of existing records, search by every spelling and
// only of public records, the profile editor (own person only, a Latin-script primary name), the
// withdrawal of a consent and a deletion request. Fictional demo data only (D20).

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAccount, setTestAuthEnv } from '../auth/test-support';
import type { Principal } from '../auth/principal';
import { EXPLORE_START_TAG } from '../cache';
import { closeDb, getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, authUser, consentRecord, lineage, notification, person, personBio, personName, personNameKey, reviewCase, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { personHitSchema, searchResultSchema } from '../dto/search';
import { stopProducer } from '../jobs/boss';
import { searchKeysRebuildHandler } from '../jobs/worker';
import { handleApiRequest } from '../rpc/handler';
import { LIMITS } from '../search/query';
import { writePersonKeys } from '../search/store';
import { cancelDeletionFromCommandLine, carryOutDeletionFromCommandLine, consentWithdraw, privacyOverview, requestAccountDeletion } from './privacy';
import { MISSING_PRIMARY_MESSAGE, profileGet, profileUpdate } from './profile';
import { checkSearchRate, SEARCH_WINDOW_MS, SEARCHES_PER_WINDOW, searchQuery } from './search';

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

/** A public, fictional person with these names (the first is the primary) and its search keys. */
async function insertPublicPerson(slug: string, names: readonly { value: string; script: string; lang: string }[], id = uuidv7()): Promise<string> {
  await getDb().insert(person).values({ id, slug, kind: 'living', stewardship: 'unclaimed', visibility: 'public' });
  await getDb()
    .insert(personName)
    .values(names.map((n, i) => ({ personId: id, value: n.value, script: n.script, lang: n.lang, isPrimary: i === 0, sortOrder: i })));
  await writePersonKeys(getDb(), id);
  return id;
}
const latin = (value: string) => ({ value, script: 'Latn', lang: 'und-Latn' });

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

  it('a country filter returns only the schools of that country, and none where no school matches', async () => {
    // "kwoon" matches the demo schools of several countries (Athens, Berlin, Kowloon).
    const all = await searchQuery(null, { q: 'kwoon' });
    const countries = [...new Set(all.schools.map((s) => s.countryCode))];
    expect(countries.length).toBeGreaterThanOrEqual(2);
    for (const country of countries) {
      const only = await searchQuery(null, { q: 'kwoon', country });
      expect(only.schools.length, country).toBeGreaterThan(0);
      for (const s of only.schools) expect(s.countryCode, country).toBe(country);
    }
    expect(countries).not.toContain('BG');
    expect((await searchQuery(null, { q: 'kwoon', country: 'BG' })).schools).toEqual([]);
    // And "wing chun" the other way round: Sofia (BG) and London (GB).
    const bg = await searchQuery(null, { q: 'wing chun', country: 'BG' });
    expect(bg.schools.map((s) => s.countryCode)).toEqual(expect.arrayContaining(['BG']));
    for (const s of bg.schools) expect(s.countryCode).toBe('BG');
    expect((await searchQuery(null, { q: 'wing chun' })).schools.map((s) => s.countryCode)).toEqual(expect.arrayContaining(['BG', 'GB']));
  });

  it('a lineage filter returns only people with a public relationship in that lineage', async () => {
    const [b] = await getDb().select({ id: lineage.id }).from(lineage).where(eq(lineage.slug, 'demo-lineage-b'));
    // "So Ching" matches demo-cjk-name (lineage B) and namesakes recorded only in lineage A.
    const unfiltered = await searchQuery(null, { q: 'So Ching' });
    const onlyA = await getDb().execute<{ slug: string }>(sql`
      SELECT p.slug FROM v_public_person p
       WHERE p.slug = ANY(${`{${unfiltered.people.map((h) => h.slug).join(',')}}`}::text[])
         AND NOT EXISTS (SELECT 1 FROM v_public_edge e WHERE e.lineage_id = ${b!.id}::uuid AND p.id IN (e.student_person_id, e.teacher_person_id))`);
    expect(onlyA.rows.length).toBeGreaterThan(0);
    const filtered = await searchQuery(null, { q: 'So Ching', lineageId: b!.id });
    const slugs = filtered.people.map((h) => h.slug);
    expect(slugs).toContain('demo-cjk-name');
    for (const row of onlyA.rows) expect(slugs).not.toContain(row.slug);
    for (const hit of filtered.people) {
      const edges = await getDb().execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM v_public_edge e WHERE e.lineage_id = ${b!.id}::uuid AND ${hit.id}::uuid IN (e.student_person_id, e.teacher_person_id)`);
      expect(edges.rows[0]!.n, hit.slug).toBeGreaterThan(0);
    }
  });

  it('ranks a verified person above an equal match that is not verified', async () => {
    // Two fictional namesakes; the one without a verified relationship has the smaller id, so
    // only the verified bonus can put the other first (equal scores sort by name, then id).
    const now = Date.now();
    const plain = await insertPublicPerson('demo-rank-namesake-plain', [latin('Demo Rank Namesake')], uuidv7(now));
    const verified = await insertPublicPerson('demo-rank-namesake-verified', [latin('Demo Rank Namesake')], uuidv7(now + 1));
    expect(plain < verified).toBe(true);
    const [a] = await getDb().select({ id: lineage.id }).from(lineage).where(eq(lineage.slug, 'demo-lineage-a'));
    await getDb().insert(teachingRelationship).values({
      id: uuidv7(),
      teacherPersonId: ids['demo-root-a']!,
      studentPersonId: verified,
      lineageId: a!.id,
      status: 'verified',
      visibility: 'public',
    });
    const hits = (await searchQuery(null, { q: 'Demo Rank Namesake' })).people.filter((h) => h.slug.startsWith('demo-rank-namesake'));
    expect(hits.map((h) => [h.slug, h.verified])).toEqual([
      ['demo-rank-namesake-verified', true],
      ['demo-rank-namesake-plain', false],
    ]);
  });

  it('a two-letter surname finds a name that ends with it', async () => {
    await insertPublicPerson('demo-short-surname', [latin('Demo Siu Ming Ng')]);
    expect(await peopleSlugs('Ng')).toContain('demo-short-surname');
    expect(await peopleSlugs('ming ng')).toContain('demo-short-surname');
    // Still the start of a word only: "g" inside "ming" is not a word start.
    expect(await peopleSlugs('in')).not.toContain('demo-short-surname');
  });

  it('Chinese characters match at any point of a name, a prefix typed one character at a time, and a name followed by a title', async () => {
    // A fictional name whose last two characters are an OpenCC phrase (乾坤).
    await insertPublicPerson('demo-phrase-name', [latin('Demo Lei Kin Kwan'), { value: '李乾坤', script: 'Hant', lang: 'zh-Hant' }]);
    expect(await peopleSlugs('李乾')).toContain('demo-phrase-name');
    expect(await peopleSlugs('乾')).toContain('demo-phrase-name');
    expect(await peopleSlugs('李乾坤')).toContain('demo-phrase-name');
    // A name with a title after it (師傅, sifu).
    expect(await peopleSlugs('蘇晴嵐師傅')).toContain('demo-cjk-name');
  });

  it('shows the stored name written as the query was typed when two spellings share a key', async () => {
    const simplified = (await searchQuery(null, { q: '苏晴岚' })).people.find((h) => h.slug === 'demo-cjk-name');
    expect(simplified!.matched).toEqual({ value: '苏晴岚', lang: 'zh-Hans', script: 'Hans' });
    const traditional = (await searchQuery(null, { q: '蘇晴嵐' })).people.find((h) => h.slug === 'demo-cjk-name');
    expect(traditional!.matched).toEqual({ value: '蘇晴嵐', lang: 'zh-Hant', script: 'Hant' });
  });

  it('says when more people match than the answer lists', async () => {
    const many = await searchQuery(null, { q: 'so' });
    expect(many.people).toHaveLength(LIMITS.people);
    expect(many.morePeople).toBe(true);
    const one = await searchQuery(null, { q: 'Ivan Testov' });
    expect(one.people.length).toBeLessThan(LIMITS.people);
    expect(one.morePeople).toBe(false);
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
    // The limiter on a fixed clock a minute ago (a slow machine must not let early searches leave
    // the window, and nothing here stays in the window of the real-time calls after it).
    const flood = { requestId: 'flood', ipHmac: 'demo-flood-client' };
    const t0 = Date.now() - 60_000;
    for (let i = 0; i < SEARCHES_PER_WINDOW; i++) checkSearchRate(flood, t0 + i);
    expect(() => checkSearchRate(flood, t0 + 100)).toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS', status: 429 }));
    // Another client is counted apart, a request without a readable address shares one bucket, and
    // the window moves on.
    expect(() => checkSearchRate({ requestId: 'other', ipHmac: 'demo-other-client' }, t0 + 100)).not.toThrow();
    for (let i = 0; i < SEARCHES_PER_WINDOW; i++) checkSearchRate({ requestId: `n${i}`, ipHmac: null }, t0 + i);
    expect(() => checkSearchRate({ requestId: 'n', ipHmac: null }, t0 + 100)).toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }));
    expect(() => checkSearchRate(flood, t0 + SEARCH_WINDOW_MS + 100)).not.toThrow();
    // Through the service, at real time: a flooded client is refused with 429.
    const busy = { requestId: 'busy', ipHmac: 'demo-busy-client' };
    for (let i = 0; i < SEARCHES_PER_WINDOW; i++) checkSearchRate(busy);
    await expect(searchQuery(null, { q: 'so' }, busy)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
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
    expect(await searchQuery(null, { q: '   ' })).toEqual({ query: '', people: [], morePeople: false, schools: [], lineages: [] });
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

  it('is served to the web palette at POST /api/rpc/search/query, in the oRPC wire format', async () => {
    // As src/components/ui/search-palette.tsx sends it: { json: input } in, { json: output } out.
    const response = await handleApiRequest(
      new Request('http://127.0.0.1:3100/api/rpc/search/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3100' },
        body: JSON.stringify({ json: { q: 'Тестов' } }),
      }),
      'rpc',
    );
    expect(response.status).toBe(200);
    const body = searchResultSchema.parse(((await response.json()) as { json: unknown }).json);
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
    // The refused display name's own error says why, and what to change (as the editor's note does).
    const jyutpingFirst = names().map((n) => ({ ...n, isPrimary: n.romanization === 'jyutping' }));
    await expect(profileUpdate(p, { names: jyutpingFirst, showPublicly: false }, meta)).rejects.toMatchObject({
      fields: { 'names.3.isPrimary': 'Jyutping and pinyin help people find you; your display name is your everyday spelling.' },
    });
    await expect(profileUpdate(p, { names: noLatin, showPublicly: false }, meta)).rejects.toMatchObject({
      fields: { 'names.1.isPrimary': 'Choose “Latin letters” or “Cantonese, Hong Kong spelling” under “Written in” to use this name.' },
    });
    const alias = [{ kind: 'alias' as const, value: 'Demo Pending Alias', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true }];
    await expect(profileUpdate(p, { names: alias, showPublicly: false }, meta)).rejects.toMatchObject({
      fields: { 'names.0.isPrimary': 'A name marked “Also known as” cannot be your display name.' },
    });
    // The biography is English for now (In scope 1): another language is refused.
    await expect(profileUpdate(p, { names: names(), bio: { body: 'A fictional biography.', lang: 'bg' }, showPublicly: false }, meta)).rejects.toMatchObject({
      fields: { 'bio.lang': 'Choose the language of your biography.' },
    });
    await expect(profileUpdate(null, { names: names(), showPublicly: false }, meta)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('an API call that leaves out the biography, country, city or year keeps them, and showPublicly is required', async () => {
    const p = principalOf(users['demo-pending']!);
    await profileUpdate(p, { names: names(), bio: { body: 'A kept fictional biography.', lang: 'en' }, countryCode: 'BG', trainingStartYear: 2011, showPublicly: false }, meta);
    const result = await profileUpdate(p, { names: names(), showPublicly: false }, meta);
    expect(result.profile.bio).toEqual({ body: 'A kept fictional biography.', lang: 'en' });
    expect(result.profile.countryCode).toBe('BG');
    expect(result.profile.trainingStartYear).toBe(2011);
    // null clears them.
    const cleared = await profileUpdate(p, { names: names(), bio: null, countryCode: null, trainingStartYear: null, showPublicly: false }, meta);
    expect(cleared.profile.bio).toBeNull();
    expect(cleared.profile.countryCode).toBeNull();
    expect(cleared.profile.trainingStartYear).toBeNull();
    await expect(profileUpdate(p, { names: names() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
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

describe('the public cache of every teacher above a person whose visibility changes', () => {
  it('drops lineage:<id> of a grand-teacher in another lineage, and only on a visibility change', async () => {
    // A fictional chain across two lineages: G teaches T in demo-lineage-a, T teaches demo-pending
    // in demo-lineage-b. G's cached profile counts demo-pending among its public descendants and is
    // tagged person:G, lineage:G and lineage:<demo-lineage-a> only.
    const userId = users['demo-pending']!;
    const lineages = await getDb().select({ id: lineage.id, slug: lineage.slug }).from(lineage).where(sql`${lineage.slug} IN ('demo-lineage-a', 'demo-lineage-b')`);
    const lineageId = (slug: string) => lineages.find((l) => l.slug === slug)!.id;
    const grand = await insertPublicPerson('demo-cache-grand-teacher', [latin('Demo Cache Grand Teacher')]);
    const teacher = await insertPublicPerson('demo-cache-teacher', [latin('Demo Cache Teacher')]);
    await getDb()
      .insert(teachingRelationship)
      .values([
        { id: uuidv7(), teacherPersonId: grand, studentPersonId: teacher, lineageId: lineageId('demo-lineage-a'), status: 'verified', visibility: 'public' },
        { id: uuidv7(), teacherPersonId: teacher, studentPersonId: ids['demo-pending']!, lineageId: lineageId('demo-lineage-b'), status: 'verified', visibility: 'public' },
      ]);
    const p = principalOf(userId);
    const names = [{ kind: 'name' as const, value: 'Demo Pending Example', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true }];

    // explore-start too (M05): the explorer's start list counts the public people of each lineage
    // and lists a lineage only once its root is public, so a lineage this change makes eligible is
    // missing from every tag the cached list carries.
    cache.revalidated.length = 0;
    expect((await profileUpdate(p, { names, showPublicly: true }, meta)).visibilityChanged).toBe(true);
    expect(cache.revalidated).toEqual(expect.arrayContaining([`lineage:${grand}`, `lineage:${teacher}`, `person:${ids['demo-pending']}`, EXPLORE_START_TAG]));

    cache.revalidated.length = 0;
    expect((await consentWithdraw(p, { kinds: ['publication'] }, meta)).profileHidden).toBe(true);
    expect(cache.revalidated).toEqual(expect.arrayContaining([`lineage:${grand}`, `lineage:${teacher}`, EXPLORE_START_TAG]));

    // A save that changes only the names: every cached graph that shows the person is tagged
    // person:<id>, and no count above changes.
    cache.revalidated.length = 0;
    expect((await profileUpdate(p, { names, showPublicly: false }, meta)).visibilityChanged).toBe(false);
    expect(cache.revalidated).toContain(`person:${ids['demo-pending']}`);
    expect(cache.revalidated).not.toContain(`lineage:${grand}`);
    expect(cache.revalidated).not.toContain(EXPLORE_START_TAG);
  });
});

describe('pnpm account:delete carries out or cancels a deletion request', () => {
  const namesOf = async (personId: string) =>
    (await getDb().select({ value: personName.value, isPrimary: personName.isPrimary }).from(personName).where(eq(personName.personId, personId))).map((n) => n.value);
  const caseOf = async (caseId: string) => (await getDb().select().from(reviewCase).where(eq(reviewCase.id, caseId)))[0]!;
  const accountExists = async (userId: string) => (await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.id, userId))).length === 1;

  /** A fictional member with a public self-stewarded profile in two scripts and a biography. */
  async function member(slug: string): Promise<{ userId: string; personId: string; caseId: string }> {
    const account = await createAccount({ label: slug });
    const personId = uuidv7();
    await getDb().insert(person).values({ id: personId, slug, kind: 'living', stewardship: 'self', visibility: 'involved_only', claimedByUserId: account.id, createdByUserId: account.id });
    await getDb().insert(personName).values({ personId, value: 'Demo Leaving Member', script: 'Latn', lang: 'und-Latn', isPrimary: true });
    const p = principalOf(account.id);
    const names = [
      { kind: 'name' as const, value: 'Demo Leaving Member', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true },
      { kind: 'name' as const, value: '離雲', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: false },
    ];
    await profileUpdate(p, { names, bio: { body: 'A fictional biography to delete.', lang: 'en' }, trainingStartYear: 2015, showPublicly: true }, meta);
    const { request } = await requestAccountDeletion(p, { confirm: true }, meta);
    return { userId: account.id, personId, caseId: request.id };
  }

  it('deletes the account and its consents, keeps a public record with verified links under its Latin name, and closes the case', async () => {
    const userId = users['demo-root-a']!;
    const personId = ids['demo-root-a']!;
    const p = principalOf(userId);
    const own = (await profileGet(p)).profile!;
    const names = own.names.map(({ kind, value, script, lang, romanization, isPrimary }) => ({ kind, value, script, lang, romanization, isPrimary }));
    await profileUpdate(p, { names, bio: { body: 'A fictional biography to delete.', lang: 'en' }, trainingStartYear: 2004, showPublicly: true }, meta);
    expect((await namesOf(personId)).length).toBeGreaterThan(1);
    const caseId = (await privacyOverview(p)).deletionRequest!.id;

    const outcome = await carryOutDeletionFromCommandLine(caseId);
    // demo-root-a has verified relationships: the record stays public, as others confirmed it.
    expect(outcome).toEqual({ personId, visibility: 'public' });
    expect(await accountExists(userId)).toBe(false);
    expect(await getDb().select().from(consentRecord).where(eq(consentRecord.userId, userId))).toEqual([]);
    const [kept] = await getDb().select().from(person).where(eq(person.id, personId));
    expect(kept).toMatchObject({ claimedByUserId: null, createdByUserId: null, stewardship: 'unclaimed', visibility: 'public', placeId: null, trainingStartYear: null });
    expect(await namesOf(personId)).toEqual([names.find((n) => n.isPrimary)!.value]);
    expect(await getDb().select().from(personBio).where(eq(personBio.personId, personId))).toEqual([]);
    // Only the Latin display name's keys are left.
    const keys = await getDb().select({ nameId: personNameKey.personNameId }).from(personNameKey).where(eq(personNameKey.personId, personId));
    const [primary] = await getDb().select({ id: personName.id }).from(personName).where(eq(personName.personId, personId));
    expect(new Set(keys.map((k) => k.nameId))).toEqual(new Set([primary!.id]));
    expect(await caseOf(caseId)).toMatchObject({ status: 'resolved', resolution: 'approved', openedByUserId: null, resolvedAt: expect.any(Date) });
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, caseId)));
    expect(audit).toMatchObject({ actorUserId: null, subjectType: 'review_case' });
    expect(JSON.stringify(audit)).not.toMatch(/fictional biography|@example\.test/);
    // The earlier audit rows stay (append-only).
    expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.deletion_request'), eq(auditLog.actorUserId, userId)))).toHaveLength(1);

    await expect(carryOutDeletionFromCommandLine(caseId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('makes a record private when it was public by its owner\'s consent only', async () => {
    const { userId, personId, caseId } = await member('demo-deletion-only-consent');
    expect(await peopleSlugs('Demo Leaving Member')).toContain('demo-deletion-only-consent');
    expect(await carryOutDeletionFromCommandLine(caseId)).toEqual({ personId, visibility: 'involved_only' });
    expect(await accountExists(userId)).toBe(false);
    expect(await namesOf(personId)).toEqual(['Demo Leaving Member']);
    expect(await peopleSlugs('Demo Leaving Member')).not.toContain('demo-deletion-only-consent');
  });

  it('deletes nothing while another record still refers to the account', async () => {
    const { userId, personId, caseId } = await member('demo-deletion-referenced');
    const [edge] = await getDb().select({ id: teachingRelationship.id }).from(teachingRelationship).limit(1);
    await getDb().update(teachingRelationship).set({ requestedByUserId: userId }).where(eq(teachingRelationship.id, edge!.id));
    try {
      await expect(carryOutDeletionFromCommandLine(caseId)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('nothing was deleted') });
      expect(await accountExists(userId)).toBe(true);
      expect(await namesOf(personId)).toEqual(['Demo Leaving Member', '離雲']);
      expect(await caseOf(caseId)).toMatchObject({ status: 'open', openedByUserId: userId });
      expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, caseId)))).toEqual([]);
    } finally {
      await getDb().update(teachingRelationship).set({ requestedByUserId: null }).where(eq(teachingRelationship.id, edge!.id));
    }
  });

  it('--cancel closes the request and keeps the account', async () => {
    const { userId, personId, caseId } = await member('demo-deletion-cancelled');
    await cancelDeletionFromCommandLine(caseId);
    expect(await caseOf(caseId)).toMatchObject({ status: 'dismissed', resolvedAt: expect.any(Date), openedByUserId: userId });
    expect(await accountExists(userId)).toBe(true);
    expect(await namesOf(personId)).toEqual(['Demo Leaving Member', '離雲']);
    expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.deletion_cancel'), eq(auditLog.subjectId, caseId)))).toHaveLength(1);
    expect((await privacyOverview(principalOf(userId))).deletionRequest).toBeNull();
    await expect(cancelDeletionFromCommandLine(caseId)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(carryOutDeletionFromCommandLine(caseId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses an id that is not a deletion request', async () => {
    await expect(carryOutDeletionFromCommandLine('not-a-case')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(carryOutDeletionFromCommandLine(uuidv7())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(cancelDeletionFromCommandLine(uuidv7())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
