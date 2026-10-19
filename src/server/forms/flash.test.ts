import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { decodeFormResult, decodeSignInEmail, outcomeUrl } from './flash';

const SECRET = 'flash-test-secret-000000000000000000';

beforeAll(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', SECRET);
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function cookieFor(body: unknown, secret = SECRET): string {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const mac = createHmac('sha256', `wcr-form-result:${secret}`).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

describe('outcomeUrl', () => {
  it('adds the outcome to the page and keeps its own query', () => {
    expect(outcomeUrl('/sign-in?next=%2Fadmin', 'abc')).toBe('/sign-in?next=%2Fadmin&outcome=abc#');
    expect(outcomeUrl('/sign-up', 'abc')).toBe('/sign-up?outcome=abc#');
  });

  it('never leaves the site', () => {
    expect(outcomeUrl('//example.test/x', 'abc')).toBe('/?outcome=abc#');
    expect(outcomeUrl('https://example.test/x', 'abc')).toBe('/?outcome=abc#');
  });

  it('ends with an empty fragment, so the redirect drops the posting page\'s fragment and autofocus works', () => {
    expect(outcomeUrl('/admin/grants#give-plan', 'abc')).toBe('/admin/grants?outcome=abc#');
  });

  it('opens the page at the anchor of the outcome, when it is a plain id', () => {
    expect(outcomeUrl('/admin/grants?q=a%40b.test#give-plan', 'abc', 'revoke-grant-0192-reason')).toBe(
      '/admin/grants?q=a%40b.test&outcome=abc#revoke-grant-0192-reason',
    );
    for (const anchor of ['', 'a b', 'x#y', '"><script>', 'é', 'x'.repeat(161)]) {
      expect(outcomeUrl('/admin/grants', 'abc', anchor), JSON.stringify(anchor)).toBe('/admin/grants?outcome=abc#');
    }
  });
});

describe('decodeFormResult', () => {
  const state = { status: 'error', message: 'Check the highlighted fields.', fields: { email: 'Enter your e-mail address.' }, values: { email: 'x' } };

  it('returns the state for its form and outcome', () => {
    expect(decodeFormResult(cookieFor({ id: 'o1', form: 'sign-up', state }), 'sign-up', 'o1')).toEqual(state);
  });

  it('ignores another form, another outcome, no outcome and a forged signature', () => {
    const raw = cookieFor({ id: 'o1', form: 'sign-up', state });
    expect(decodeFormResult(raw, 'sign-in', 'o1')).toBeNull();
    expect(decodeFormResult(raw, 'sign-up', 'o2')).toBeNull();
    expect(decodeFormResult(raw, 'sign-up', undefined)).toBeNull();
    expect(decodeFormResult(cookieFor({ id: 'o1', form: 'sign-up', state }, 'another-secret-000000000000000000000'), 'sign-up', 'o1')).toBeNull();
    expect(decodeFormResult(`${raw}x`, 'sign-up', 'o1')).toBeNull();
  });

  it('keeps only what a form renders again', () => {
    const raw = cookieFor({ id: 'o1', form: 'f', state: { ...state, data: { secret: 'never' }, values: { email: 3 } } });
    expect(decodeFormResult(raw, 'f', 'o1')).toEqual({ status: 'error', message: state.message, fields: state.fields });
    expect(decodeFormResult(cookieFor({ id: 'o1', form: 'f', state: { status: 'idle' } }), 'f', 'o1')).toBeNull();
  });
});

describe('decodeSignInEmail', () => {
  it('reads a signed address and refuses anything else', () => {
    const payload = Buffer.from('demo-member@example.test').toString('base64url');
    const mac = createHmac('sha256', `wcr-form-result:${SECRET}`).update(`email:${payload}`).digest('base64url');
    expect(decodeSignInEmail(`${payload}.${mac}`)).toBe('demo-member@example.test');
    expect(decodeSignInEmail(`${payload}.${mac.slice(1)}`)).toBeNull();
    expect(decodeSignInEmail(undefined)).toBeNull();
  });
});
