import { describe, expect, it } from 'vitest';

import { afterOnboarding, chosenAccountType, ONBOARDING_DEFAULT_NEXT, onboardingNext, onboardingPage } from './destination';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
};

describe('where onboarding goes afterwards', () => {
  it('ends on the dashboard without a next, as a normal sign-in does', () => {
    expect(ONBOARDING_DEFAULT_NEXT).toBe('/dashboard');
    expect(onboardingNext(undefined)).toBe('/dashboard');
    expect(onboardingNext('')).toBe('/dashboard');
    expect(afterOnboarding(onboardingNext(undefined))).toBe('/dashboard');
  });

  it('keeps the page that sent the member here', () => {
    const invitation = `/invite/${'A'.repeat(43)}`;
    for (const next of [invitation, '/schools/demo-a/trial', '/dashboard/profile', '/account', '/schools?near=1']) {
      expect(afterOnboarding(onboardingNext(next))).toBe(next);
    }
  });

  it('never sends anywhere off the site', () => {
    for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', '/.//evil.example', 'javascript:alert(1)']) {
      expect(onboardingNext(next)).toBe('/dashboard');
    }
  });

  it('never goes back to onboarding itself', () => {
    expect(afterOnboarding('/onboarding')).toBe('/dashboard');
    expect(afterOnboarding('/onboarding?next=%2Fdashboard')).toBe('/dashboard');
  });

  it('names /onboarding with its next, and without one for the default', () => {
    expect(onboardingPage('/dashboard')).toBe('/onboarding');
    expect(onboardingPage('/schools/demo-a/trial')).toBe('/onboarding?next=%2Fschools%2Fdemo-a%2Ftrial');
  });
});

describe('the role chosen on the onboarding form', () => {
  it('sends the chosen type, and nothing when the form has no choice', () => {
    expect(chosenAccountType(form({ accountType: 'student' }))).toBe('student');
    expect(chosenAccountType(form({ accountType: 'sifu' }))).toBe('sifu');
    expect(chosenAccountType(form({ primaryName: 'Demo Person' }))).toBeNull();
    expect(chosenAccountType(form({ accountType: '' }))).toBeNull();
  });

  it('passes anything else on for account.setType to refuse, cut to a bounded length', () => {
    expect(chosenAccountType(form({ accountType: 'admin' }))).toBe('admin');
    expect(chosenAccountType(form({ accountType: 'x'.repeat(100) }))).toHaveLength(16);
  });
});
