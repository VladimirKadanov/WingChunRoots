// What a log line may carry (plan §6.4, CLAUDE.md §6; milestone M12): no names, e-mail addresses,
// IP addresses or coordinates, and no secrets. The pino logger (./index.ts) runs every field and
// every message through these functions before a line is written, so a careless call site cannot
// leak them:
//
//   - a field whose key names personal data or a secret (email, name, displayName, ip, address,
//     teacherAddress, lat, lng, coordinates, location, addressLine, publicPoint, password, token,
//     cookie, ...) becomes "[redacted]", at any
//     depth of the logged object;
//   - every other string has its e-mail addresses, IP addresses and coordinates replaced
//     (`<address>`, `<ip>`, `<coordinates>`), and its control characters escaped;
//   - an Error becomes its type and code only: its message and stack can quote SQL parameters,
//     an address or a name (src/server/rpc/failure-log.ts follows the same rule).
//
// A name inside free text cannot be recognised. Messages are therefore constant text with ids
// (a request id, a queue name, a SQLSTATE), never a value a person typed.

import { redactLogText } from '../auth/logger';

export const REDACTED = '[redacted]';

/** Keys (lower-case, without `-`, `_` and spaces) whose values are always replaced. */
const SENSITIVE_KEYS = new Set([
  // names
  'name', 'names', 'displayname', 'firstname', 'lastname', 'middlename', 'fullname', 'givenname', 'familyname',
  'personname', 'username', 'nickname', 'latinname', 'originalname', 'teachername', 'studentname',
  // M10b and M11: an invitee, the root of a lineage (a person's name) and a Latin transliteration
  'inviteename', 'lineagename', 'rootname', 'asciiname',
  // addresses of any kind
  'address', 'addresses', 'ip', 'ips', 'ipaddress', 'remoteaddress', 'clientip', 'clientaddress', 'xforwardedfor',
  'forwardedfor', 'xrealip', 'forwarded',
  // coordinates
  'lat', 'lng', 'lon', 'long', 'latitude', 'longitude', 'coords', 'coordinates', 'location', 'geo', 'geometry',
  'point', 'position', 'exactpoint', 'privatepoint', 'privatelocation',
  // M11: a school's street address, its pin as shown and a city's centre
  'addressline', 'streetaddress', 'publicpoint', 'centroid', 'pin',
  // secrets
  'authorization', 'cookie', 'cookies', 'setcookie', 'headers',
]);

/** Key fragments that mark personal data or a secret wherever they appear in a key. */
const SENSITIVE_PARTS = ['email', 'password', 'secret', 'token', 'apikey', 'phone'];

/** Key endings that mark an address of any kind (teacherAddress, ownAddress: an e-mail address in M10b). */
const SENSITIVE_ENDINGS = ['address'];

const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

export function isSensitiveKey(key: string): boolean {
  const normal = key.toLowerCase().replace(/[-_\s]/g, '');
  return (
    SENSITIVE_KEYS.has(normal) ||
    SENSITIVE_PARTS.some((part) => normal.includes(part)) ||
    SENSITIVE_ENDINGS.some((ending) => normal.endsWith(ending))
  );
}

// A decimal latitude/longitude pair ("42.6977, 23.3219"), a WKT or PostGIS point
// ("POINT(23.32 42.69)", "SRID=4326;POINT(...)") and a labelled value ("lat=42.69", "lng: 23.3").
const COORDINATE_PAIR = /(?<![\w.])-?\d{1,3}\.\d{2,}\s*[,;]\s*-?\d{1,3}\.\d{2,}(?![\w.])/g;
const WKT_POINT = /\bPOINT\s*Z?\s*\(\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)?\s*\)/gi;
const LABELLED_COORDINATE = /\b(lat|lng|lon|latitude|longitude)\b(\s*[=:]\s*)-?\d+(?:\.\d+)?/gi;

/** `text` with coordinates, e-mail and IP addresses removed and control characters escaped. */
export function redactText(text: string): string {
  const withoutCoordinates = text
    .replace(WKT_POINT, 'POINT(<coordinates>)')
    .replace(LABELLED_COORDINATE, '$1$2<coordinates>')
    .replace(COORDINATE_PAIR, '<coordinates>');
  return redactLogText(withoutCoordinates);
}

/** What a log line keeps of an error: its type and a well-formed code (a SQLSTATE, an ORPC code). */
export function errorFields(error: Error): { type: string; code?: string } {
  const code = (error as { code?: unknown }).code;
  const type = /^[\w$.-]{1,64}$/.test(error.name) ? error.name : 'Error';
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? { type, code } : { type };
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return typeof value === 'bigint' ? value.toString() : value;
  if (value instanceof Error) return errorFields(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[nested]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map((item) => redactValue(item, depth + 1, seen));
      return value.length > MAX_ITEMS ? [...items, `[${value.length - MAX_ITEMS} more]`] : items;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Any value with personal data and secrets removed: a string is scrubbed, an Error becomes its type
 * and code, an object or array is scrubbed at any depth (the logger runs every argument of a log
 * call through it, printf arguments included).
 */
export function redactAny(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}

/** The fields of a log line with personal data and secrets removed, at any depth. */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactValue(fields, 0, new WeakSet()) as Record<string, unknown>;
}
