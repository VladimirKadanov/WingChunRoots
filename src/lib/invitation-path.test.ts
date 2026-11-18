import { describe, expect, it } from 'vitest';

import { isInvitationPath, isTrialPath, ridesInConfirmationLink } from './invitation-path';

const TOKEN = 'A'.repeat(43);

describe('the paths that ride in the confirmation link', () => {
  it('knows an invitation link', () => {
    expect(isInvitationPath(`/invite/${TOKEN}`)).toBe(true);
    expect(isInvitationPath(`/invite/${TOKEN}x`)).toBe(false);
    expect(isInvitationPath('/invite/short')).toBe(false);
    expect(isInvitationPath(undefined)).toBe(false);
  });

  it("knows a school's trial lesson page", () => {
    expect(isTrialPath('/schools/demo-sofia-centre/trial')).toBe(true);
    expect(isTrialPath('/schools/demo-sofia-centre')).toBe(false);
    expect(isTrialPath('/schools/Demo/trial')).toBe(false);
    expect(isTrialPath('/schools/demo/trial?x=1')).toBe(false);
    expect(isTrialPath('/schools/demo/trial/../../admin')).toBe(false);
    expect(isTrialPath('//evil.example/schools/demo/trial')).toBe(false);
  });

  it('carries only those two, never another local page or an address elsewhere', () => {
    expect(ridesInConfirmationLink(`/invite/${TOKEN}`)).toBe(true);
    expect(ridesInConfirmationLink('/schools/demo-a/trial')).toBe(true);
    for (const other of ['/', '/dashboard', '/account', '/admin', 'https://evil.example/', '', null, 42]) {
      expect(ridesInConfirmationLink(other)).toBe(false);
    }
  });
});
