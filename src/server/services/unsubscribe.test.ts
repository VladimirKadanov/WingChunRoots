// Unsubscribe tokens (milestone M18, In scope 4): an HMAC over the account, the category and the
// preference version; anything else, or another key, reads as nothing.

import { describe, expect, it } from 'vitest';

import { readUnsubscribeToken, signUnsubscribeToken, UNSUBSCRIBE_TOKEN_MAX } from './unsubscribe';

const KEY = 'demo-unsubscribe-test-key-0123456789abcdef';
const USER = '0192f0c4-0000-7000-8000-000000000001';

describe('unsubscribe tokens', () => {
  it('reads back what it signed', () => {
    const token = signUnsubscribeToken({ userId: USER, category: 'events', version: 3 }, KEY);
    expect(token.startsWith(`v1.${USER}.events.3.`)).toBe(true);
    expect(token.length).toBeLessThanOrEqual(UNSUBSCRIBE_TOKEN_MAX);
    expect(readUnsubscribeToken(token, KEY)).toEqual({ userId: USER, category: 'events', version: 3 });
  });

  it('refuses another key, a changed field or a changed signature', () => {
    const token = signUnsubscribeToken({ userId: USER, category: 'plan', version: 0 }, KEY);
    expect(readUnsubscribeToken(token, `${KEY}-other`)).toBeNull();
    expect(readUnsubscribeToken(token.replace('.plan.', '.teaching.'), KEY)).toBeNull();
    expect(readUnsubscribeToken(token.replace('.0.', '.1.'), KEY)).toBeNull();
    expect(readUnsubscribeToken(token.replace(USER, '0192f0c4-0000-7000-8000-000000000002'), KEY)).toBeNull();
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(readUnsubscribeToken(`${token.slice(0, -1)}${last}`, KEY)).toBeNull();
  });

  it('refuses malformed input without throwing', () => {
    for (const bad of [undefined, null, 42, '', 'v1', 'v2.a.b.c.d', `v1.${USER}.security-x.0.abc`, `v1.${USER}.plan.-1.abc`, 'x'.repeat(UNSUBSCRIBE_TOKEN_MAX + 1)]) {
      expect(readUnsubscribeToken(bad, KEY)).toBeNull();
    }
  });

  it('signs only a user id, a known category and a version from 0', () => {
    expect(() => signUnsubscribeToken({ userId: 'not-a-uuid', category: 'plan', version: 0 }, KEY)).toThrow();
    expect(() => signUnsubscribeToken({ userId: USER, category: 'nope' as never, version: 0 }, KEY)).toThrow();
    expect(() => signUnsubscribeToken({ userId: USER, category: 'plan', version: -1 }, KEY)).toThrow();
  });
});
