// The result of a form submitted without JavaScript (milestone M02 fix round 1, finding H5).
//
// With JavaScript, React posts a Server Action with fetch (the `Next-Action` header) and the form
// shows the state the action returns. Without it, or before the page has hydrated, the browser
// posts the form itself, and Next.js renders the page with that state only when the whole page is
// rendered in one pass: a page with a prerendered shell (Cache Components: every account page)
// resumes the shell, which was rendered without the state, so the visitor saw an empty form again.
//
// So a plain form post is answered post/redirect/get: the action keeps its state for two minutes
// in a signed, httpOnly cookie and redirects (303) to the form's page with `?outcome=<id>`; the page
// reads the state back with readFormResult() and renders the form with it. The id ties the state
// to that one address, so the same page opened later (or in another tab) starts empty, while a
// reload of the outcome address shows the same outcome. Only form messages, field errors and the
// values the form shows again are kept (never passwords or codes, which no FormState holds), and
// only in the visitor's own browser.
//
// Only pages and Server Actions import this file (it reads next/headers).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { FormState } from '../../lib/form-state';
import { appUrl, authSecret } from '../auth/env';

export const FORM_RESULT_COOKIE = 'wcr.form';
export const OUTCOME_PARAM = 'outcome';
const MAX_AGE_S = 120;
const MAX_COOKIE_LENGTH = 3800;

/** Which form, and the local address of the page that shows it (with its own query string). */
export interface FormPlace {
  form: string;
  page: string;
}

function signature(payload: string): Buffer {
  return createHmac('sha256', `wcr-form-result:${authSecret()}`).update(payload).digest();
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string');

/** The parts of a FormState a page may render again; anything else is dropped. */
function cleanState(value: unknown): FormState | null {
  if (!value || typeof value !== 'object') return null;
  const { status, message, fields, values } = value as Record<string, unknown>;
  if (status !== 'error' && status !== 'done') return null;
  return {
    status,
    ...(typeof message === 'string' ? { message } : {}),
    ...(isStringRecord(fields) ? { fields } : {}),
    ...(isStringRecord(values) ? { values } : {}),
  };
}

/** Whether React posted this Server Action with fetch (JavaScript), not the browser a plain form. */
export async function postedByReact(): Promise<boolean> {
  return (await headers()).has('next-action');
}

/** The address of `page` with `?outcome=<id>`: always a path on this site. */
export function outcomeUrl(page: string, id: string): string {
  const url = new URL(page.startsWith('/') && !page.startsWith('//') ? page : '/', 'http://local.invalid');
  url.searchParams.set(OUTCOME_PARAM, id);
  return `${url.pathname}${url.search}`;
}

/**
 * The answer of a Server Action: `state` for a fetch by React; for a plain form post, the state is
 * kept for the page and the browser is sent there (this never returns then).
 */
export async function formResult(place: FormPlace, state: FormState): Promise<FormState> {
  if (await postedByReact()) return state;
  const clean = cleanState(state);
  if (!clean) redirect(place.page);
  const id = randomBytes(12).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ id, form: place.form, state: clean })).toString('base64url');
  const value = `${payload}.${signature(payload).toString('base64url')}`;
  if (value.length <= MAX_COOKIE_LENGTH) {
    (await cookies()).set(FORM_RESULT_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE_S,
      secure: appUrl().startsWith('https:'),
    });
  }
  redirect(outcomeUrl(place.page, id));
}

/** Reads a kept result without the request (the unit tests): the state, or null. */
export function decodeFormResult(raw: string | undefined, form: string, outcome: unknown): FormState | null {
  if (!raw || typeof outcome !== 'string' || !outcome) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = signature(payload);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { id?: unknown; form?: unknown; state?: unknown };
    if (parsed.id !== outcome || parsed.form !== form) return null;
    return cleanState(parsed.state);
  } catch {
    return null;
  }
}

/** The result a plain form post of `form` left for this page (`?outcome=`), or null. */
export async function readFormResult(form: string, outcome: unknown): Promise<FormState | null> {
  if (typeof outcome !== 'string' || !outcome) return null;
  return decodeFormResult((await cookies()).get(FORM_RESULT_COOKIE)?.value, form, outcome);
}

// --- The address for the sign-in form -------------------------------------------------------------

export const SIGN_IN_EMAIL_COOKIE = 'wcr.sign-in-email';
const SIGN_IN_EMAIL_MAX_AGE_S = 600;

/**
 * Remembers the address an account has just confirmed, for ten minutes and only for /sign-in, so
 * the sign-in form that follows starts with it. httpOnly and signed: a page script cannot read it,
 * and a cookie set by anyone else is ignored.
 */
export async function rememberSignInEmail(email: string): Promise<void> {
  const payload = Buffer.from(email).toString('base64url');
  (await cookies()).set(SIGN_IN_EMAIL_COOKIE, `${payload}.${signature(`email:${payload}`).toString('base64url')}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/sign-in',
    maxAge: SIGN_IN_EMAIL_MAX_AGE_S,
    secure: appUrl().startsWith('https:'),
  });
}

/** Reads a remembered address without the request (the unit tests). */
export function decodeSignInEmail(raw: string | undefined): string | null {
  const [payload, mac] = (raw ?? '').split('.');
  if (!payload || !mac) return null;
  const expected = signature(`email:${payload}`);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/** The address rememberSignInEmail() kept for this browser, or null. */
export async function readSignInEmail(): Promise<string | null> {
  return decodeSignInEmail((await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value);
}
