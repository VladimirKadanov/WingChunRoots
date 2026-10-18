// Onboarding and consents through the API (milestone M02, In scope 3 and 5): the account.me,
// consent.record and account.onboard procedures over /api/v1 with a bearer session (the future
// native app) and over /api/rpc with the cookie (the web), against a migrated throwaway database.

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAccount,
  signIn,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TEST_APP_URL,
  type TestAccount,
} from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, consentRecord, person, personName } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { LEGAL_DOCUMENTS } from '../legal/documents';
import { AuthError } from '../auth/guards';
import { principalFromHeaders } from '../auth/session';
import { handleApiRequest } from '../rpc/handler';
import { landingPath as landingPathOf } from './account';

let testDb: TestDatabase | undefined;
let hongKong: string;
let sofia: string;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  const insertPlace = async (geonamesId: number, name: string, country: string, lon: number, lat: number) => {
    const rows = await getDb().execute<{ id: string }>(sql`
      INSERT INTO place (geonames_id, name, ascii_name, country_code, centroid)
      VALUES (${geonamesId}, ${name}, ${name}, ${country}, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
      RETURNING id`);
    return rows.rows[0]!.id;
  };
  hongKong = await insertPlace(990001, 'Demo Harbour City', 'HK', 114.17, 22.3);
  sofia = await insertPlace(990002, 'Demo Sofia', 'BG', 23.32, 42.7);
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function call(token: string | null, method: 'GET' | 'POST', path: string, body?: unknown) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await handleApiRequest(
    new Request(`${TEST_APP_URL}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    'openapi',
  );
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

const REQUIRED = ['terms', 'authenticity_declaration', 'age_18_plus'];

async function readyAccount(label: string): Promise<{ account: TestAccount; token: string }> {
  const account = await createAccount({ label });
  const { token } = await signIn(account);
  const consent = await call(token, 'POST', '/consent/record', { kinds: [...REQUIRED, 'privacy_ack'] });
  expect(consent.status).toBe(200);
  return { account, token };
}

const fieldsOf = (data: Record<string, unknown> | null) => (data?.data as { fields?: Record<string, string> } | undefined)?.fields ?? {};

describe('consent.record and account.me', () => {
  it('an account without the sign-up consents is asked for them again, and they are stored with the version', async () => {
    const account = await createAccount({ label: 'consents' });
    const { token } = await signIn(account);

    const before = await call(token, 'GET', '/account/me');
    expect(before.status).toBe(200);
    expect([...(before.data!.missingConsents as string[])].sort()).toEqual([...REQUIRED].sort());

    const refused = await call(token, 'POST', '/account/onboard', { primaryName: 'Demo Onboarder' });
    expect(refused.status).toBe(400);
    expect(refused.data!.code).toBe('CONSENT_REQUIRED');
    expect(Object.keys(fieldsOf(refused.data)).sort()).toEqual([...REQUIRED].sort());

    const recorded = await call(token, 'POST', '/consent/record', { kinds: REQUIRED });
    expect(recorded.status).toBe(200);
    expect([...(recorded.data!.recorded as string[])].sort()).toEqual([...REQUIRED].sort());
    const again = await call(token, 'POST', '/consent/record', { kinds: REQUIRED });
    expect(again.data!.recorded).toEqual([]);

    const rows = await getDb().select().from(consentRecord).where(eq(consentRecord.userId, account.id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.action).toBe('granted');
      expect(row.documentVersion).toBe(LEGAL_DOCUMENTS.terms.version);
    }
    const after = await call(token, 'GET', '/account/me');
    expect(after.data!.missingConsents).toEqual([]);
    expect(after.data!.person).toBeNull();
  });

  it('refuses an unknown consent kind and a request without a session', async () => {
    const { token } = await readyAccount('consent-kind');
    expect((await call(token, 'POST', '/consent/record', { kinds: ['publication'] })).status).toBe(400);
    expect((await call(null, 'POST', '/consent/record', { kinds: REQUIRED })).status).toBe(401);
    expect((await call(null, 'GET', '/account/me')).status).toBe(401);
    expect((await call(null, 'POST', '/account/onboard', { primaryName: 'Demo Nobody' })).status).toBe(401);
  });
});

describe('account.onboard', () => {
  it('creates the account’s own person, private, with every name in its language', async () => {
    const { account, token } = await readyAccount('onboard');
    const result = await call(token, 'POST', '/account/onboard', {
      primaryName: '  So   Chuk-ching ',
      originalName: '蘇竹晴',
      originalLang: 'zh-Hant',
      jyutping: 'sou1 zuk1 cing4',
      pinyin: 'Sū Zhúqíng',
      countryCode: 'hk',
      placeId: hongKong,
      trainingStartYear: '1999',
    });
    expect(result.status).toBe(200);

    const [row] = await getDb().select().from(person).where(eq(person.claimedByUserId, account.id));
    expect(row).toMatchObject({
      stewardship: 'self',
      visibility: 'involved_only',
      kind: 'living',
      createdByUserId: account.id,
      countryCode: 'HK',
      placeId: hongKong,
      trainingStartYear: 1999,
    });
    expect(row!.slug).toMatch(/^so-chuk-ching-[0-9a-f]{8}$/);

    const names = await getDb().select().from(personName).where(eq(personName.personId, row!.id)).orderBy(personName.sortOrder);
    expect(names.map((n) => [n.kind, n.value, n.lang, n.script, n.romanization, n.isPrimary])).toEqual([
      ['name', 'So Chuk-ching', 'und-Latn', 'Latn', null, true],
      ['name', '蘇竹晴', 'zh-Hant', 'Hant', null, false],
      ['romanization', 'sou1 zuk1 cing4', 'yue-Latn', 'Latn', 'jyutping', false],
      ['romanization', 'Sū Zhúqíng', 'zh-Latn-pinyin', 'Latn', 'pinyin', false],
    ]);

    // The audit log records the creation without the names (plan §6.4); nothing is published.
    const [audit] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'person.create'), eq(auditLog.subjectId, row!.id)));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toMatch(/So Chuk-ching|蘇竹晴|sou1/);
    const publication = await getDb()
      .select()
      .from(consentRecord)
      .where(and(eq(consentRecord.userId, account.id), eq(consentRecord.kind, 'publication')));
    expect(publication).toEqual([]);

    const me = await call(token, 'GET', '/account/me');
    expect((me.data!.person as { names: unknown[] }).names).toHaveLength(4);

    const second = await call(token, 'POST', '/account/onboard', { primaryName: 'Demo Second' });
    expect(second.status).toBe(409);
    expect(second.data!.code).toBe('CONFLICT');
  });

  it('"Show my profile publicly" makes it public and records the publication consent', async () => {
    const { account, token } = await readyAccount('public');
    const result = await call(token, 'POST', '/account/onboard', { primaryName: 'Mira Probnova', showPublicly: true, placeId: sofia });
    expect(result.status).toBe(200);
    const [row] = await getDb().select().from(person).where(eq(person.claimedByUserId, account.id));
    expect(row).toMatchObject({ visibility: 'public', countryCode: 'BG' });
    const publication = await getDb()
      .select()
      .from(consentRecord)
      .where(and(eq(consentRecord.userId, account.id), eq(consentRecord.kind, 'publication')));
    expect(publication).toHaveLength(1);
    expect(publication[0]!.documentVersion).toBe(LEGAL_DOCUMENTS.privacy.version);
  });

  it('accepts the empty optional fields a web form sends', async () => {
    const { token } = await readyAccount('empty-fields');
    const result = await call(token, 'POST', '/account/onboard', {
      primaryName: 'Demo Form Sender',
      originalName: '',
      originalLang: '',
      jyutping: '',
      pinyin: '',
      countryCode: '',
      placeId: '',
      trainingStartYear: '',
    });
    expect(result.status).toBe(200);
  });

  it.each([
    [{ primaryName: '' }, 'primaryName'],
    [{ primaryName: '蘇竹晴' }, 'primaryName'],
    [{ primaryName: 'Мира Пробнова' }, 'primaryName'],
    [{ primaryName: 'Demo Name', originalName: '蘇竹晴' }, 'originalLang'],
    [{ primaryName: 'Demo Name', originalName: 'Mira', originalLang: 'zh-Hant' }, 'originalName'],
    [{ primaryName: 'Demo Name', originalName: 'Мира', originalLang: 'xx-Fake' }, 'originalLang'],
    [{ primaryName: 'Demo Name', jyutping: '蘇' }, 'jyutping'],
    [{ primaryName: 'Demo Name', pinyin: '蘇竹晴' }, 'pinyin'],
    [{ primaryName: 'Demo Name', countryCode: 'XX' }, 'countryCode'],
    [{ primaryName: 'Demo Name', trainingStartYear: 1850 }, 'trainingStartYear'],
    [{ primaryName: 'Demo Name', trainingStartYear: 9999 }, 'trainingStartYear'],
    [{ primaryName: 'x'.repeat(121) }, 'primaryName'],
  ])('refuses %j with a message for %s', async (input, field) => {
    const { token } = await readyAccount('refused');
    const result = await call(token, 'POST', '/account/onboard', input);
    expect(result.status).toBe(400);
    expect(fieldsOf(result.data)[field]).toEqual(expect.any(String));
  });

  it('refuses a city that is not in the chosen country, and an unknown city', async () => {
    const { token } = await readyAccount('city');
    const mismatch = await call(token, 'POST', '/account/onboard', { primaryName: 'Demo City', countryCode: 'BG', placeId: hongKong });
    expect(mismatch.status).toBe(400);
    expect(fieldsOf(mismatch.data).placeId).toMatch(/not in the chosen country/);
    const unknown = await call(token, 'POST', '/account/onboard', {
      primaryName: 'Demo City',
      placeId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.status).toBe(400);
    expect(fieldsOf(unknown.data).placeId).toEqual(expect.any(String));
  });
});

describe('landingPath', () => {
  it('is refused without a session, like every service', async () => {
    await expect(landingPathOf(null, '/account')).rejects.toBeInstanceOf(AuthError);
  });

  it('holds an account on /onboarding until it has a profile and the current documents are confirmed', async () => {
    const { account, token } = await readyAccount('landing');
    const principal = await principalFromHeaders(new Headers({ authorization: `Bearer ${token}` }));
    expect(principal?.user.id).toBe(account.id);
    const landingPath = (_id: string, next: unknown) => landingPathOf(principal, next);
    expect(await landingPath(account.id, undefined)).toBe('/onboarding');
    expect(await landingPath(account.id, '/schools')).toBe('/onboarding?next=%2Fschools');
    expect(await landingPath(account.id, '/account/security')).toBe('/account/security');

    expect((await call(token, 'POST', '/account/onboard', { primaryName: 'Demo Lander' })).status).toBe(200);
    expect(await landingPath(account.id, undefined)).toBe('/account');
    expect(await landingPath(account.id, '/onboarding')).toBe('/account');
    expect(await landingPath(account.id, '/schools')).toBe('/schools');
    // Never another site, also when dot segments would make the path protocol-relative.
    expect(await landingPath(account.id, '/.//example.test')).toBe('/account');
    expect(await landingPath(account.id, 'https://example.test/')).toBe('/account');

    // The terms get a new version: the grant the account gave is for the old one, so it is asked
    // again, even though it already has a profile.
    await getDb()
      .update(consentRecord)
      .set({ documentVersion: '2000-01-01-demo-old' })
      .where(and(eq(consentRecord.userId, account.id), eq(consentRecord.kind, 'terms')));
    expect((await call(token, 'GET', '/account/me')).data!.missingConsents).toEqual(['terms']);
    expect(await landingPath(account.id, undefined)).toBe('/onboarding');
    expect(await landingPath(account.id, '/schools')).toBe('/onboarding?next=%2Fschools');
    expect(await landingPath(account.id, '/account/security')).toBe('/account/security');
    // The exemption is decided on the normalised path, so dot segments do not get around it.
    expect(await landingPath(account.id, '/account/security/../../schools')).toBe('/onboarding?next=%2Fschools');

    expect((await call(token, 'POST', '/consent/record', { kinds: ['terms'] })).data!.recorded).toEqual(['terms']);
    expect(await landingPath(account.id, '/schools')).toBe('/schools');
  });

  it('is the account.landing procedure under /api/v1, which needs a session', async () => {
    const { token } = await readyAccount('landing-api');
    expect(await call(token, 'GET', '/account/landing?next=%2Fschools')).toEqual({
      status: 200,
      data: { path: '/onboarding?next=%2Fschools' },
    });
    expect((await call(null, 'GET', '/account/landing?next=%2Fschools')).status).toBe(401);
  });
});
