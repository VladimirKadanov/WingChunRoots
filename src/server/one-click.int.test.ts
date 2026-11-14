// POST /unsubscribe/one-click (src/server/one-click.ts; milestone M18, In scope 4; review 2026-11-13,
// auth.md 1): the one-click form is read within ONE_CLICK_BODY_MAX_BYTES and no further. A body of
// exactly the limit is read and answered as the form it is; one byte more is 413, whether the length
// was declared or the body arrived chunked, and the category stays on.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from './auth/test-support';
import { getDb } from './db';
import { notificationPreference } from './db/schema';
import { createTestDatabase, type TestDatabase } from './db/testing';
import { handleOneClick, ONE_CLICK_BODY_MAX_BYTES } from './one-click';
import { createUser } from './services/relationships.test-support';
import { signUnsubscribeToken } from './services/unsubscribe';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase();
  process.env.DATABASE_URL = testDb.url;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const FORM = 'application/x-www-form-urlencoded';
const ONE_CLICK = 'List-Unsubscribe=One-Click';

/** A urlencoded body of exactly `size` bytes that starts with the one-click field. */
const padded = (size: number) => `${ONE_CLICK}&pad=${'a'.repeat(size - ONE_CLICK.length - '&pad='.length)}`;

function post(token: string, body: BodyInit | null, headers: Record<string, string> = { 'content-type': FORM }) {
  return new Request(`http://127.0.0.1:3100/unsubscribe/one-click?token=${encodeURIComponent(token)}`, { method: 'POST', headers, body });
}

/** A body of 1 KiB pieces with no Content-Length (as a mail client may send it); counts what was pulled. */
function chunked(token: string, pieces: number) {
  const pulled = { count: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count === pieces) return controller.close();
      pulled.count += 1;
      controller.enqueue(new TextEncoder().encode(pulled.count === 1 ? `${ONE_CLICK}&pad=${'a'.repeat(1024 - ONE_CLICK.length - 5)}` : 'a'.repeat(1024)));
    },
    cancel() {
      pulled.cancelled = true;
    },
  });
  const request = new Request(`http://127.0.0.1:3100/unsubscribe/one-click?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': FORM },
    body,
    duplex: 'half',
  } as RequestInit);
  return { request, pulled };
}

async function emailOf(userId: string): Promise<boolean | undefined> {
  const [row] = await getDb()
    .select({ email: notificationPreference.email })
    .from(notificationPreference)
    .where(and(eq(notificationPreference.userId, userId), eq(notificationPreference.category, 'plan')));
  return row?.email;
}

describe('POST /unsubscribe/one-click: the body limit', () => {
  it('the limit is far above the real form and far below anything that could hurt', () => {
    expect(ONE_CLICK_BODY_MAX_BYTES).toBe(8192);
    expect(ONE_CLICK.length).toBeLessThan(ONE_CLICK_BODY_MAX_BYTES / 100);
  });

  it('reads a body of exactly the limit as the form it is, and switches the category off', async () => {
    const a = await createUser('one-click-exact');
    const token = signUnsubscribeToken({ userId: a.id, category: 'plan', version: 0 });
    const body = padded(ONE_CLICK_BODY_MAX_BYTES);
    expect(new TextEncoder().encode(body).byteLength).toBe(ONE_CLICK_BODY_MAX_BYTES);
    const response = await handleOneClick(post(token, body, { 'content-type': FORM, 'content-length': String(ONE_CLICK_BODY_MAX_BYTES) }));
    expect(response.status).toBe(200);
    expect(await emailOf(a.id)).toBe(false);
  });

  it('answers 413 one byte over the limit, declared or not, and changes nothing', async () => {
    const a = await createUser('one-click-over');
    const token = signUnsubscribeToken({ userId: a.id, category: 'plan', version: 0 });
    const body = padded(ONE_CLICK_BODY_MAX_BYTES + 1);

    const declared = await handleOneClick(post(token, body, { 'content-type': FORM, 'content-length': String(ONE_CLICK_BODY_MAX_BYTES + 1) }));
    expect(declared.status).toBe(413);
    expect(declared.headers.get('cache-control')).toBe('no-store');
    expect(await declared.text()).toBe('This request is too large.\n');

    // Without a length (a stream), and with a header that understates it: the bytes are counted.
    const undeclared = await handleOneClick(post(token, body));
    expect(undeclared.status).toBe(413);
    const lying = await handleOneClick(post(token, body, { 'content-type': FORM, 'content-length': '26' }));
    expect(lying.status).toBe(413);
    expect(await emailOf(a.id)).toBeUndefined();
  });

  it('stops reading an endless chunked body at the limit', async () => {
    const a = await createUser('one-click-chunked');
    const token = signUnsubscribeToken({ userId: a.id, category: 'plan', version: 0 });
    const { request, pulled } = chunked(token, 1_000_000);
    expect((await handleOneClick(request)).status).toBe(413);
    expect(pulled.count).toBeLessThan(ONE_CLICK_BODY_MAX_BYTES / 1024 + 3);
    expect(pulled.cancelled).toBe(true);
    expect(await emailOf(a.id)).toBeUndefined();
    // A chunked body within the limit still unsubscribes: a mail client may send it so (no 411).
    const within = chunked(token, 4);
    expect((await handleOneClick(within.request)).status).toBe(200);
    expect(await emailOf(a.id)).toBe(false);
  });

  it('keeps the other answers: 400 for a body that is not the one-click form, 404 for a token that is not one', async () => {
    const a = await createUser('one-click-others');
    const token = signUnsubscribeToken({ userId: a.id, category: 'plan', version: 0 });
    expect((await handleOneClick(post(token, null))).status).toBe(400);
    expect((await handleOneClick(post(token, 'List-Unsubscribe=Other'))).status).toBe(400);
    expect((await handleOneClick(post(token, 'not a form', { 'content-type': 'text/plain' }))).status).toBe(400);
    expect(await emailOf(a.id)).toBeUndefined();
    expect((await handleOneClick(post('v1.demo', ONE_CLICK))).status).toBe(404);
    // multipart is the other shape RFC 8058 allows
    const multipart = new FormData();
    multipart.set('List-Unsubscribe', 'One-Click');
    const form = new Request(`http://127.0.0.1:3100/unsubscribe/one-click?token=${encodeURIComponent(token)}`, { method: 'POST', body: multipart });
    expect((await handleOneClick(form)).status).toBe(200);
    expect(await emailOf(a.id)).toBe(false);
  });
});
