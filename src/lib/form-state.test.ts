import { describe, expect, it } from 'vitest';

import { outcomeTarget } from './form-state';

describe('outcomeTarget', () => {
  it('names the element that shows the outcome', () => {
    const invalid = { status: 'error', fields: { reason: 'Give a reason.', email: 'Enter an address.' } } as const;
    expect(outcomeTarget('revoke-grant-1', invalid, true)).toBe('revoke-grant-1-reason');
    expect(outcomeTarget('create-grant', invalid, false)).toBe('create-grant-summary');
    expect(outcomeTarget('create-grant', { status: 'error', message: 'Refused.' }, false)).toBe('create-grant-message');
    expect(outcomeTarget('revoke-grant-1', { status: 'done', message: 'Revoked.', fields: { reason: 'stale' } }, true)).toBe('revoke-grant-1-message');
  });
});
