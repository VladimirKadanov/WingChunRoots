// The internal cache revalidation (plan §6.4; milestone M09, In scope 5): POST
// /api/internal/revalidate, which the worker calls after each recompute of the counters, because the
// worker is a separate process and the 'use cache' entries live in the web process's memory.
//
// - A shared secret guards it. Without a dedicated INTERNAL_REVALIDATE_SECRET (at least 32
//   characters), the secret is derived from MAIL_SEAL_KEY, which the web process and the worker
//   already share: HMAC-SHA-256(MAIL_SEAL_KEY, "wingchunroots:internal-revalidate:v1"). The label
//   separates it from the sealing key, so knowing one gives nothing about the other, and no new
//   secret has to be added to every environment (docs/adr/0011-teacher-requests.md).
// - The secret travels as `Authorization: Bearer <secret>` and is compared in constant time; a
//   request without it is refused with 401 before its body is read.
// - The body is `{ "tags": [...] }`: only the tag shapes of src/server/cache.ts (person:<uuid>,
//   lineage:<uuid>, lineage-membership:<uuid>, explore-start), at most MAX_TAGS. Nothing else can be
//   revalidated through it. The worker sends only lineage-membership:<uuid> (M09 review, requirements-1).
// - Reachable only on the Compose network once the app runs there (M12: the route is not exposed
//   through the public proxy); in the tests on localhost (APP_URL).
//
// This module has no Next.js import: the route handler passes revalidateTag in, and the worker
// (src/server/jobs/lineage-recompute.ts) uses the secret and the address.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { appUrl } from './auth/env';
import { EXPLORE_START_TAG } from './cache-tags';

type Env = Record<string, string | undefined>;

export const REVALIDATE_PATH = '/api/internal/revalidate';
/** More than one change ever needs: a person with every teacher above them and the neighbours. */
export const MAX_TAGS = 2000;
const MIN_SECRET_LENGTH = 32;
const TAG = /^(person|lineage|lineage-membership):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class RevalidateSecretError extends Error {
  constructor() {
    super('internal revalidation: set INTERNAL_REVALIDATE_SECRET (32+ characters) or MAIL_SEAL_KEY');
    this.name = 'RevalidateSecretError';
  }
}

/** The shared secret of the internal route (see the top of this file). Throws when neither is set. */
export function revalidateSecret(env: Env = process.env): string {
  const own = env.INTERNAL_REVALIDATE_SECRET;
  if (own && own.length >= MIN_SECRET_LENGTH) return own;
  const seal = env.MAIL_SEAL_KEY;
  if (!seal || seal.length < MIN_SECRET_LENGTH) throw new RevalidateSecretError();
  return createHmac('sha256', seal).update('wingchunroots:internal-revalidate:v1').digest('hex');
}

/** Where the worker reaches the web process: INTERNAL_APP_URL (Compose, M12), else APP_URL. */
export function revalidateUrl(env: Env = process.env): string {
  const base = env.INTERNAL_APP_URL || appUrl(env);
  return new URL(REVALIDATE_PATH, base).toString();
}

/** Whether `tag` is one of the cache tags of src/server/cache.ts. */
export function isCacheTag(tag: unknown): tag is string {
  return typeof tag === 'string' && (tag === EXPLORE_START_TAG || TAG.test(tag));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Whether the request carries the shared secret (constant-time comparison). */
export function hasRevalidateSecret(request: Request, env: Env = process.env): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  let expected: string;
  try {
    expected = revalidateSecret(env);
  } catch {
    return false;
  }
  const given = Buffer.from(match[1]!);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Handles POST /api/internal/revalidate: 401 without the secret (the body is not read), 400 for a
 * body that is not `{ tags: [...] }` of known tags, else calls `revalidate` once per distinct tag.
 */
export async function handleRevalidate(request: Request, revalidate: (tag: string) => void, env: Env = process.env): Promise<Response> {
  if (!hasRevalidateSecret(request, env)) return json(401, { error: 'UNAUTHORIZED' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'BAD_REQUEST', message: 'The body must be JSON: { "tags": [...] }.' });
  }
  const tags = (body as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every(isCacheTag)) {
    return json(400, { error: 'BAD_REQUEST', message: `tags must be a list of at most ${MAX_TAGS} cache tags.` });
  }
  const unique = [...new Set(tags)];
  for (const tag of unique) revalidate(tag);
  return json(200, { revalidated: unique.length });
}
