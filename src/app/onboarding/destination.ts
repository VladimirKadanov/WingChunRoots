// Where /onboarding goes afterwards, and what its role choice sends (the onboarding usability pass).
// A new member who has just set up their profile lands on their dashboard, as a normal sign-in does
// (account.landing); a page that sent them here (`?next=`: an invitation, a school's trial lesson
// form, a dashboard page) is kept and opened instead.

import type { AccountType } from '@/server/entitlements/plans';
import { safeNextPath } from '@/server/auth/guards';

import { TAKES_PART, TEACHES, TRAINS } from './take-part';

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
 * Journey review 2026-11-26 (P1-1, ADR 0076): "How do you take part?" is two ticks, "I train" and
 * "I teach", because most teachers also train. The form says it shows them with takesPart=1.
 * "I teach" makes a Sifu account (it has a teacher list too), "I train" alone a Student account,
 * and neither is "I'm new to Wing Chun": a Student account that goes on to the school finder.
 */

/** What the ticks say, or null when the form did not show them. */
function ticks(form: FormData): { trains: boolean; teaches: boolean } | null {
  if (form.get(TAKES_PART) !== '1') return null;
  return { trains: form.get(TRAINS) === 'on', teaches: form.get(TEACHES) === 'on' };
}

/**
 * The account type chosen on the form, or null when the form sent no choice (a client that does
 * not show it): then the account type is left as it is. Without the ticks the older single choice
 * (`accountType`) is read; any other value goes to account.setType as sent, which refuses it.
 */
export function chosenAccountType(form: FormData): AccountType | null {
  const ticked = ticks(form);
  if (ticked) return ticked.teaches ? 'sifu' : 'student';
  const value = form.get('accountType');
  if (typeof value !== 'string' || value === '') return null;
  // "I'm new to Wing Chun" is a Student account (beginnerChoice() sends it on to the schools).
  if (value === BEGINNER) return 'student';
  return value.slice(0, 16) as AccountType;
}

/** The form says the member is new to Wing Chun: neither tick, or the older "new" choice. */
export function choseBeginner(form: FormData): boolean {
  const ticked = ticks(form);
  return ticked ? !ticked.trains && !ticked.teaches : form.get('accountType') === BEGINNER;
}

/** The value of "I'm new to Wing Chun" in the older single choice. */
export const BEGINNER = 'new';

/** Where a beginner goes after onboarding without a `next` of their own: the school finder. */
export const BEGINNER_NEXT = '/schools';

/** Where onboarding ends for this form: a beginner without a `next` of their own finds a school. */
export function afterOnboardingFor(form: FormData, next: string): string {
  const after = afterOnboarding(next);
  return choseBeginner(form) && after === ONBOARDING_DEFAULT_NEXT ? BEGINNER_NEXT : after;
}
