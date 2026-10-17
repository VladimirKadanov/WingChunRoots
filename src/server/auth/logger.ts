// Better Auth's log lines without personal data (plan §6.4): Better Auth logs e-mail addresses
// (for example "Sign-up attempt for existing email: ...") and passes error objects that can carry
// them. Only the level, the message with addresses and IP addresses removed, and the name and code
// of an error are printed; never the other arguments.

import { redactAddresses } from '../mail/redact';

type Level = 'debug' | 'info' | 'warn' | 'error';

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// A whole token of hex digits, colons and dots with at least two colons: every IPv6 form, also
// compressed (2001:db8::1, fe80::1, ::1). It may also catch a clock time; over-redaction is safe.
const IPV6 = /(?<![\w:.])[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*(?![\w:.])/gi;

/** A log message without e-mail or IP addresses. */
export function redactLogText(text: string): string {
  return redactAddresses(text).replace(IPV4, '<ip>').replace(IPV6, '<ip>');
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
}
