// The review fixes of milestone M02 (fix round 1) through Better Auth's HTTP API: who owns an
// address (pre-registration takeover, H1), no account enumeration in the sign-up answer, sealed
// tokens in the outbox, limits that changing the client address cannot dodge, one use per TOTP
// code, a lock for wrong codes inside a session, backup codes, and refused profile fields.
//
// This file: nobody can lock the owner out of an account. See hardening.int.test.ts for the rest.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestDatabase } from '../db/testing';
import { SIGN_IN_FAILURE_LIMIT } from './throttle';
import {
  authFetch,
  createAccount,
  deliveryCount,
  signIn,
  signInWith,
  signUp,
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

describe('nobody can lock the owner out of an account', () => {
  it('duplicate sign-ups do not use up the e-mails that get the owner back in', async () => {
    const owner = await createAccount({ label: 'notice-flood' });
    for (let i = 0; i < 5; i += 1) expect((await signUp(owner.email, `someone else tried ${i}`)).status).toBe(200);
    // The notice goes once an hour; repeats inside the hour are not sent again.
    expect(await deliveryCount('account-exists', owner.email)).toBe(1);
    expect((await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: owner.email } })).status).toBe(200);
    expect(await deliveryCount('reset-password', owner.email)).toBe(1);
  });

  it('a stranger who keeps an address locked and floods it with sign-ups cannot keep the owner out', async () => {
    const owner = await createAccount({ label: 'kept-out' });
    const lockAgain = async (round: number) => {
      for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) await signInWith(owner.email, `stranger ${round} guess ${i}`);
    };
    await lockAgain(1);
    for (let i = 0; i < 5; i += 1) await signUp(owner.email, `stranger sign-up ${i}`);
    expect((await signInWith(owner.email, owner.password)).status).toBe(429);

    // The owner asks for a reset: it is sent, whatever the stranger did.
    expect((await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: owner.email } })).status).toBe(200);
    const token = await tokenFromOutbox('reset-password', owner.email);
    const ownersBrowser = new TestBrowser();
    expect((await authFetch(ownersBrowser, '/reset-password', { body: { token, newPassword: 'the owner is back in' } })).status).toBe(200);

    // The stranger locks the address again right away; the owner's browser still signs in...
    await lockAgain(2);
    expect((await signInWith(owner.email, 'the owner is back in')).data?.code).toBe('TOO_MANY_ATTEMPTS');
    const back = await signInWith(owner.email, 'the owner is back in', ownersBrowser);
    expect(back.status).toBe(200);
    // ...and keeps doing so after the session ends, because the browser is now a known one.
    await lockAgain(3);
    const later = new TestBrowser();
    for (const [name, value] of ownersBrowser.cookies) if (name.includes('known_device')) later.cookies.set(name, value);
    expect((await signInWith(owner.email, 'the owner is back in', later)).status).toBe(200);
  });

  it('a known browser has a lock of its own: its failures never lock the address for others', async () => {
    const owner = await createAccount({ label: 'known-own-lock' });
    const { browser } = await signIn(owner);
    expect(browser.hasCookie('known_device')).toBe(true);
    // The same browser (its known-device cookie) from a new client address each time, so the
    // per-address rate limit of the endpoint never answers instead of the lock.
    const sameBrowser = () => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) expect((await signInWith(owner.email, `typo ${i}`, sameBrowser())).status).toBe(401);
    const locked = await signInWith(owner.email, owner.password, sameBrowser());
    expect(locked.status).toBe(429);
    expect(locked.data?.code).toBe('TOO_MANY_ATTEMPTS');
    // A new browser (no known-device cookie) is not affected by those failures.
    expect((await signInWith(owner.email, owner.password)).status).toBe(200);
  });

  it('a new password ends every known browser of the account but the one that chose it', async () => {
    const owner = await createAccount({ label: 'known-reset' });
    const knownOnly = (browser: TestBrowser) => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    // The owner's browser, and a browser of someone who learned the old password.
    const { browser: ownersOld } = await signIn(owner);
    const { browser: leaked } = await signIn(owner);
    await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: owner.email } });
    const token = await tokenFromOutbox('reset-password', owner.email);
    const chooser = new TestBrowser();
    expect((await authFetch(chooser, '/reset-password', { body: { token, newPassword: 'the new password of the owner' } })).status).toBe(200);
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) await signInWith(owner.email, `stranger guess ${i}`);
    // The cookies of the old password are not known any more: they share the address-wide lock.
    expect((await signInWith(owner.email, 'the new password of the owner', knownOnly(leaked))).data?.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await signInWith(owner.email, 'the new password of the owner', knownOnly(ownersOld))).data?.code).toBe('TOO_MANY_ATTEMPTS');
    // The browser that chose the new password is known for it.
    expect((await signInWith(owner.email, 'the new password of the owner', knownOnly(chooser))).status).toBe(200);
  });

  it('a known-device cookie of one address does nothing for another address', async () => {
    const first = await createAccount({ label: 'known-first' });
    const second = await createAccount({ label: 'known-second' });
    const { browser } = await signIn(first);
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) await signInWith(second.email, `stranger guess ${i}`);
    const refused = await signInWith(second.email, second.password, browser);
    expect(refused.status).toBe(429);
    expect(refused.data?.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('wrong passwords through a stolen session count toward the lock of the address', async () => {
    const owner = await createAccount({ label: 'session-guess' });
    const { browser } = await signIn(owner);
    // A thief with the session cookie only (not the owner's known-device cookie), from a new
    // client address per request.
    const thief = () => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (!name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    const guess = (i: number) =>
      authFetch(thief(), '/change-password', { body: { currentPassword: `thief guess ${i}`, newPassword: 'the thief wants this one' } });
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) expect((await guess(i)).data?.code).toBe('INVALID_PASSWORD');
    const locked = await guess(SIGN_IN_FAILURE_LIMIT);
    expect(locked.status).toBe(429);
    expect(locked.data?.code).toBe('TOO_MANY_ATTEMPTS');
    // The same lock as sign-in: strangers are refused there too, the owner's own browser is not.
    expect((await signInWith(owner.email, owner.password)).data?.code).toBe('TOO_MANY_ATTEMPTS');
    const ownBrowser = new TestBrowser();
    for (const [name, value] of browser.cookies) if (name.includes('known_device')) ownBrowser.cookies.set(name, value);
    expect((await signInWith(owner.email, owner.password, ownBrowser)).status).toBe(200);
  });
});
