// Sign-up, e-mail confirmation, sign-in and password reset through Better Auth's HTTP API
// (milestone M02, In scope 1, 4, 6): consents, the role field, the outbox e-mails, ip_hmac.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { auditLog, authSession, authUser, consentRecord, emailDelivery } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { LEGAL_DOCUMENTS } from '../legal/documents';
import { ipHmac } from './ip';
import {
  authFetch,
  deliveryCount,
  sessionCount,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TestBrowser,
  tokenFromOutbox,
} from './test-support';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const ALL_TICKS = { terms: true, privacy_ack: true, authenticity_declaration: true, age_18_plus: true };
const PASSWORD = 'a long demo password';
let n = 0;
const address = (label: string) => `demo-signup-${label}-${++n}@example.test`;

async function signUp(email: string, consents: Record<string, unknown> = ALL_TICKS, extra: Record<string, unknown> = {}) {
  return authFetch(new TestBrowser(), '/sign-up/email', { body: { name: '', email, password: PASSWORD, consents, ...extra } });
}

async function userByEmail(email: string) {
  const [row] = await getDb().select().from(authUser).where(eq(authUser.email, email));
  return row;
}

describe('sign-up', () => {
  it('stores each tick as a consent record with the version of its document', async () => {
    const email = address('consents');
    const result = await signUp(email);
    expect(result.status).toBe(200);
    const user = await userByEmail(email);
    expect(user).toBeDefined();
    expect(user!.emailVerified).toBe(false);
    expect(user!.role).toBe('user');
    const rows = await getDb().select().from(consentRecord).where(eq(consentRecord.userId, user!.id));
    expect(rows.map((r) => [r.kind, r.documentVersion, r.action]).sort()).toEqual(
      [
        ['age_18_plus', LEGAL_DOCUMENTS.terms.version, 'granted'],
        ['authenticity_declaration', LEGAL_DOCUMENTS.terms.version, 'granted'],
        ['privacy_ack', LEGAL_DOCUMENTS.privacy.version, 'granted'],
        ['terms', LEGAL_DOCUMENTS.terms.version, 'granted'],
      ].sort(),
    );
    const audit = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'consent.grant'), eq(auditLog.subjectId, user!.id)));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(email);
  });

  it('records the privacy acknowledgement only when it is ticked', async () => {
    const email = address('no-privacy-ack');
    expect((await signUp(email, { terms: true, authenticity_declaration: true, age_18_plus: true })).status).toBe(200);
    const user = await userByEmail(email);
    const kinds = (await getDb().select().from(consentRecord).where(eq(consentRecord.userId, user!.id))).map((r) => r.kind);
    expect(kinds.sort()).toEqual(['age_18_plus', 'authenticity_declaration', 'terms']);
  });

  it.each([
    ['age_18_plus', { terms: true, privacy_ack: true, authenticity_declaration: true }],
    ['terms', { privacy_ack: true, authenticity_declaration: true, age_18_plus: true }],
    ['authenticity_declaration', { terms: true, privacy_ack: true, age_18_plus: true }],
    ['a string instead of true', { terms: 'on', privacy_ack: true, authenticity_declaration: true, age_18_plus: true }],
    ['no consents at all', null],
  ])('is refused without %s, and no account is created', async (_label, consents) => {
    const email = address('refused');
    const result = await signUp(email, consents as Record<string, unknown>);
    expect(result.status).toBe(400);
    expect(result.data?.code).toBe('CONSENT_REQUIRED');
    expect(await userByEmail(email)).toBeUndefined();
  });

  it('refuses a role in the request and creates no account', async () => {
    const email = address('role');
    const result = await signUp(email, ALL_TICKS, { role: 'admin' });
    expect(result.status).toBe(400);
    expect(await userByEmail(email)).toBeUndefined();
    // Neither do the other server-only fields pass.
    // M08: nor the account type; a new account is a Student and chooses Sifu in its settings.
    for (const field of [{ twoFactorEnabled: true }, { emailVerified: true }, { banned: false }, { accountType: 'sifu' }]) {
      const other = address('field');
      const r = await signUp(other, ALL_TICKS, field);
      const user = await userByEmail(other);
      if (r.status === 200) {
        expect(user!.twoFactorEnabled).toBe(false);
        expect(user!.emailVerified).toBe(false);
        expect(user!.role).toBe('user');
        expect(user!.accountType).toBe('student');
      } else {
        expect(user).toBeUndefined();
      }
    }
  });

  it('queues the confirmation e-mail; sign-in waits for the confirmation', async () => {
    const email = address('confirm');
    await signUp(email);
    const user = await userByEmail(email);
    const deliveries = await getDb().select().from(emailDelivery).where(eq(emailDelivery.userId, user!.id));
    expect(deliveries.map((d) => d.template)).toEqual(['verify-email']);

    // Before the confirmation the right password is answered like a wrong one (fix round 3,
    // security-1), and a new confirmation link goes out.
    const browser = new TestBrowser();
    await new Promise((resolve) => setTimeout(resolve, 1000)); // a new second: a new link, not the same one again
    const early = await authFetch(browser, '/sign-in/email', { body: { email, password: PASSWORD } });
    expect(early.status).toBe(401);
    expect(early.data?.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(await deliveryCount('verify-email', email)).toBe(2);

    const token = await tokenFromOutbox('verify-email', email);
    const confirmed = await authFetch(browser, '/verify-email', { method: 'GET', query: { token } });
    expect(confirmed.status).toBe(200);
    expect((await userByEmail(email))!.emailVerified).toBe(true);
    // No automatic sign-in after the confirmation.
    expect(await sessionCount(user!.id)).toBe(0);

    const signedIn = await authFetch(browser, '/sign-in/email', { body: { email, password: PASSWORD } });
    expect(signedIn.status).toBe(200);
    expect(browser.hasCookie('wcr.session_token')).toBe(true);
    const [session] = await getDb().select().from(authSession).where(eq(authSession.userId, user!.id));
    // ip_hmac, never the address (plan §6.4).
    expect(session!.ipAddress).toMatch(/^[0-9a-f]{64}$/);
    expect(session!.ipAddress).not.toContain(browser.ip);
    // The same ip_hmac as the audit log gives this client (requestMeta: clientIp, then ipHmac).
    expect(session!.ipAddress).toBe(ipHmac(browser.ip));
    expect(session!.twoFactorVerifiedAt).toBeNull();
  });

  it('refuses a password shorter than 12 characters', async () => {
    const email = address('short');
    const result = await authFetch(new TestBrowser(), '/sign-up/email', {
      body: { name: '', email, password: 'short-pass', consents: ALL_TICKS },
    });
    expect(result.status).toBe(400);
    expect(await userByEmail(email)).toBeUndefined();
  });
});

describe('password reset', () => {
  it('sets a new password through the e-mailed token and ends every session', async () => {
    const email = address('reset');
    await signUp(email);
    const browser = new TestBrowser();
    await authFetch(browser, '/verify-email', { method: 'GET', query: { token: await tokenFromOutbox('verify-email', email) } });
    expect((await authFetch(browser, '/sign-in/email', { body: { email, password: PASSWORD } })).status).toBe(200);
    const user = await userByEmail(email);
    expect(await sessionCount(user!.id)).toBe(1);

    const other = new TestBrowser();
    expect((await authFetch(other, '/request-password-reset', { body: { email } })).status).toBe(200);
    const token = await tokenFromOutbox('reset-password', email);
    const newPassword = 'another long demo password';
    const reset = await authFetch(other, '/reset-password', { body: { token, newPassword } });
    expect(reset.status).toBe(200);
    expect(await sessionCount(user!.id)).toBe(0);
    expect((await authFetch(other, '/sign-in/email', { body: { email, password: PASSWORD } })).status).toBe(401);
    expect((await authFetch(other, '/sign-in/email', { body: { email, password: newPassword } })).status).toBe(200);
    // The token works once.
    expect((await authFetch(other, '/reset-password', { body: { token, newPassword: 'a third long password' } })).status).toBe(400);
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const email = address('unknown');
    const result = await authFetch(new TestBrowser(), '/request-password-reset', { body: { email } });
    expect(result.status).toBe(200);
    const rows = await getDb().select().from(emailDelivery).where(eq(emailDelivery.toEmail, email));
    expect(rows).toHaveLength(0);
  });
});
