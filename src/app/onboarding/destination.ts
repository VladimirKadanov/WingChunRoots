// Where /onboarding goes afterwards, and what its role choice sends (the onboarding usability pass).
// A new member who has just set up their profile lands on their dashboard, as a normal sign-in does
// (account.landing); a page that sent them here (`?next=`: an invitation, a school's trial lesson
// form, a dashboard page) is kept and opened instead.

import type { AccountType } from '@/server/entitlements/plans';
import { safeNextPath } from '@/server/auth/guards';

/** Where onboarding ends without a `next` of its own. */
export const ONBOARDING_DEFAULT_NEXT = '/dashboard';

/** The `next` of /onboarding and its forms: a local path, /dashboard when there is none. */
export function onboardingNext(value: unknown): string {
  return safeNextPath(value, ONBOARDING_DEFAULT_NEXT);
}

/** The address of /onboarding with its `next` (none when it is the default). */
export function onboardingPage(next: string): string {
  return next === ONBOARDING_DEFAULT_NEXT ? '/onboarding' : `/onboarding?${new URLSearchParams({ next })}`;
}

/** Where to go once the profile is set up or the documents are confirmed: never back to /onboarding. */
export function afterOnboarding(next: string): string {
  return next === '/onboarding' || next.startsWith('/onboarding?') ? ONBOARDING_DEFAULT_NEXT : next;
}

/**
 * The account type chosen on the form ("I train" or "I teach"), or null when the form sent none
 * (a client that does not show the choice): then the account type is left as it is. Any other
 * value goes to account.setType as sent, which refuses it.
 */
export function chosenAccountType(form: FormData): AccountType | null {
  const value = form.get('accountType');
  if (typeof value !== 'string' || value === '') return null;
  return value.slice(0, 16) as AccountType;
}
