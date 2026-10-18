import { describe, expect, it } from 'vitest';

import { EMAIL_MAX_LENGTH } from './account-limits';
import { emailValue, looksLikeEmail } from './form-data';

const form = (email: string) => {
  const data = new FormData();
  data.set('email', email);
  return data;
};

describe('emailValue and looksLikeEmail', () => {
  it('trims and lower-cases the address', () => {
    expect(emailValue(form('  Demo-Member@Example.TEST '))).toBe('demo-member@example.test');
  });

  it('accepts an address of exactly the limit', () => {
    const address = `${'a'.repeat(EMAIL_MAX_LENGTH - '@example.test'.length)}@example.test`;
    expect(address).toHaveLength(EMAIL_MAX_LENGTH);
    expect(looksLikeEmail(emailValue(form(address)))).toBe(true);
  });

  it('refuses a longer address instead of cutting it into a different, valid one', () => {
    // Cut at 254 characters this would end in "@example.te": still an address, but another one.
    const address = `${'a'.repeat(EMAIL_MAX_LENGTH - '@example.te'.length)}@example.test`;
    expect(address.length).toBeGreaterThan(EMAIL_MAX_LENGTH);
    expect(looksLikeEmail(address.slice(0, EMAIL_MAX_LENGTH))).toBe(true);
    expect(looksLikeEmail(emailValue(form(address)))).toBe(false);
  });
});
