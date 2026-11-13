/**
 * Review 2026-11-13 (auth.md 1, uploads.md 1; docs/adr/0029-safety-net.md): the two public routes
 * that read a body without a signed-in session, POST /api/auth/* (64 KiB) and POST
 * /unsubscribe/one-click (8 KiB), read at most their limit over real HTTP, whether the length is
 * declared (Playwright's request) or the body is sent chunked with no Content-Length (node:http).
 * A body of exactly the limit is read and answered by the route itself; one byte more is 413 and
 * the app is still up. No account is touched: a body at the limit reaches Better Auth with an
 * address that has none, and the one-click route with a token that is not one.
 */

import { request as httpRequest } from 'node:http';

import { expect, test } from '@playwright/test';

import { BASE_URL, clientAddress } from './helpers/auth';

const AUTH_LIMIT = 64 * 1024;
const ONE_CLICK_LIMIT = 8 * 1024;
const FORM = 'List-Unsubscribe=One-Click';

/** A JSON sign-in body of exactly `size` bytes: a fictional address that has no account, padded. */
function signInBody(size: number): string {
  const head = '{"email":"demo-no-body-limit@example.test","password":"demo-password-0001","pad":"';
  const tail = '"}';
  return head + 'a'.repeat(size - head.length - tail.length) + tail;
}

const oneClickBody = (size: number) => `${FORM}&pad=${'a'.repeat(size - FORM.length - '&pad='.length)}`;

/** POSTs with no Content-Length (Transfer-Encoding: chunked), `pieces` of 1 KiB; resolves with the status, or the error that cut it. */
function postChunked(path: string, headers: Record<string, string>, first: string, pieces: number): Promise<{ status: number; body: string } | { error: string }> {
  const url = new URL(path, BASE_URL);
  return new Promise((resolve) => {
    // A connection of its own: the server closes the one that carried an oversize body, and a kept-alive
    // socket reused for the next request would fail with ECONNRESET before it was ever read.
    const req = httpRequest(url, { method: 'POST', agent: false, headers: { ...headers, connection: 'close', 'transfer-encoding': 'chunked' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    // The server may answer 413 and close while the rest is still being sent.
    req.on('error', (error) => resolve({ error: (error as NodeJS.ErrnoException).code ?? 'error' }));
    req.write(first);
    let sent = 1;
    const more = () => {
      while (sent < pieces) {
        sent += 1;
        if (!req.write('a'.repeat(1024))) return void req.once('drain', more);
      }
      req.end();
    };
    more();
  });
}

test.describe('the body limits of the public routes', () => {
  test('/api/auth: a body of exactly 64 KiB is read, one byte more is 413', async ({ request }) => {
    const headers = { origin: BASE_URL, 'content-type': 'application/json', 'x-forwarded-for': clientAddress() };

    const exact = await request.post('/api/auth/sign-in/email', { data: signInBody(AUTH_LIMIT), headers });
    // Better Auth answered it (no such account, or a bad field): the route did not stop it.
    expect(exact.status()).not.toBe(413);
    expect(exact.status()).toBeGreaterThanOrEqual(400);
    expect(exact.status()).toBeLessThan(500);

    const over = await request.post('/api/auth/sign-in/email', { data: signInBody(AUTH_LIMIT + 1), headers });
    expect(over.status()).toBe(413);
    expect(await over.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' });
    expect(over.headers()['cache-control']).toContain('no-store');
    // The refusal came with no session, no cookie and no sign of the account.
    expect(over.headers()['set-cookie']).toBeUndefined();
  });

  test('/api/auth: a chunked body with no length is cut off at the limit', async ({ request }) => {
    const headers = { origin: BASE_URL, 'content-type': 'application/json', 'x-forwarded-for': clientAddress() };
    const answer = await postChunked('/api/auth/sign-in/email', headers, '{"email":"demo-no-body-limit@example.test","pad":"', 4096);
    // 413, or the connection closed once the server had read past the limit; never an answer from Better Auth.
    if ('status' in answer) expect(answer.status).toBe(413);
    // The app is still answering, and a normal sign-in is still read normally.
    const next = await request.post('/api/auth/sign-in/email', { data: { email: 'demo-no-body-limit@example.test', password: 'demo-password-0001' }, headers });
    expect(next.status()).not.toBe(413);
    expect((await request.get('/healthz')).status()).toBe(200);
  });

  test('/unsubscribe/one-click: a body of exactly 8 KiB is read, one byte more is 413', async ({ request }) => {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };

    // At the limit: read as the one-click form; the token is not one, so the answer is 404.
    const exact = await request.post('/unsubscribe/one-click?token=v1.demo', { data: oneClickBody(ONE_CLICK_LIMIT), headers });
    expect(exact.status()).toBe(404);

    const over = await request.post('/unsubscribe/one-click?token=v1.demo', { data: oneClickBody(ONE_CLICK_LIMIT + 1), headers });
    expect(over.status()).toBe(413);
    expect(await over.text()).toBe('This request is too large.\n');
    expect(over.headers()['cache-control']).toContain('no-store');

    // The ordinary forms keep their answers.
    expect((await request.post('/unsubscribe/one-click?token=v1.demo')).status()).toBe(400);
    expect((await request.post('/unsubscribe/one-click?token=v1.demo', { form: { 'List-Unsubscribe': 'One-Click' } })).status()).toBe(404);
  });

  test('/unsubscribe/one-click: a chunked body is read within the limit and cut off past it', async ({ request }) => {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    // A mail client may send the form chunked (no 411): within the limit it is read.
    const within = await postChunked('/unsubscribe/one-click?token=v1.demo', headers, `${FORM}&pad=`, 2);
    expect('status' in within && within.status).toBe(404);
    // Past the limit it is cut off.
    const over = await postChunked('/unsubscribe/one-click?token=v1.demo', headers, `${FORM}&pad=`, 4096);
    if ('status' in over) expect(over.status).toBe(413);
    expect((await request.get('/healthz')).status()).toBe(200);
  });
});
