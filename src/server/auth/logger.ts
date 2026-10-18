// Better Auth's log lines without personal data (plan §6.4): Better Auth logs e-mail addresses
// (for example "Sign-up attempt for existing email: ...") and passes error objects that can carry
// them. Only the level, the message with addresses and IP addresses removed, and the name and code
// of an error are printed; never the other arguments. Control characters in a message are written
// as escapes, so text from a request (a callbackURL inside an error message) cannot start a line of
// its own that looks like ours (fix round 3, security-5).
//
// One path of Better Auth prints around this logger: when its adapter's fallback join fails, it
// logs "Failed to query fallback join for model …" here and then hands the error itself to
// console.error (@better-auth/core, db/adapter/factory.mjs), SQL text and parameters included (an
// id, possibly an address). Right after that line, the next console.error call of the same tick
// prints only the error's name and code.

import { redactAddresses } from '../mail/redact';

type Level = 'debug' | 'info' | 'warn' | 'error';

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// A whole token of hex digits, colons and dots with at least two colons: every IPv6 form, also
// compressed (2001:db8::1, fe80::1, ::1). It may also catch a clock time; over-redaction is safe.
const IPV6 = /(?<![\w:.])[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*(?![\w:.])/gi;

// C0 controls (CR and LF among them), DEL, C1 controls and the Unicode line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function escapeControl(text: string): string {
  return text.replace(CONTROL, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** A log message on one line, without e-mail or IP addresses. */
export function redactLogText(text: string): string {
  return escapeControl(redactAddresses(text).replace(IPV4, '<ip>').replace(IPV6, '<ip>'));
}

/** The adapter's line that it follows with a raw console.error of the query error (see the top). */
const RAW_ERROR_FOLLOWS = /^Failed to query fallback join for model /;

/** The next console.error call of this tick prints only the name and code of what it is given. */
function withholdNextConsoleError(): void {
  const original = console.error;
  const once = (...args: unknown[]) => {
    console.error = original;
    const details = args.map(describe).filter((d): d is string => d !== null);
    original(`auth error: query error withheld${details.length ? ` (${details.join(', ')})` : ''}`);
  };
  console.error = once;
  // Put back if the expected call does not come in this tick.
  queueMicrotask(() => {
    if (console.error === once) console.error = original;
  });
}

/** What may be printed of an extra log argument: the name and code of an error, nothing else. */
function describe(arg: unknown): string | null {
  if (arg instanceof Error) {
    const code = (arg as { code?: unknown }).code;
    return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? `${arg.name} ${code}` : arg.name;
  }
  return null;
}

export function logAuth(level: Level, message: string, ...args: unknown[]): void {
  const details = args.map(describe).filter((d): d is string => d !== null);
  const line = `auth ${level}: ${redactLogText(message)}${details.length ? ` (${details.join(', ')})` : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
  if (RAW_ERROR_FOLLOWS.test(message)) withholdNextConsoleError();
}

/**
 * Better Auth's onAPIError.onError: an expected refusal (an APIError below 500: wrong password,
 * expired link, ...) is not logged; anything else is, through logAuth (name and code only).
 */
export function logAuthApiError(error: unknown): void {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status < 500) return;
  logAuth('error', 'request failed', error);
}
