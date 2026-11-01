// The S3 driver's deadlines (M10a review, code-3 and requirements-3), against a fake S3 server on
// a loopback port: the request deadline bounds the wait for the response headers only, so a GET
// body that a reader takes longer than that deadline to read (a slow phone, or a store that sends
// slowly but steadily) arrives whole; a store that never answers fails within the deadline; and a
// body that stops arriving fails after the idle timeout instead of hanging. Before the fix one
// AbortSignal.timeout covered the whole request, body included, and cut long downloads part-way.
// The deadlines are shortened here (s3Store's second argument); the defaults are 30 s each.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { s3Store } from './s3';
import { newStorageKey, StorageError } from './types';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const OBJECT = new Uint8Array(randomBytes(256 * 1024));
const CHUNK = 16 * 1024;

type Behaviour = 'steady' | 'fast' | 'silent' | 'stall';
/** How the fake store answers a GET, by the first segment of the key. */
const behaviours = new Map<string, Behaviour>();
/** Whether the fake store saw the client close a stalled connection. */
let stalledClosed = false;

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const behaviour = behaviours.get(request.url!.split('/')[2] ?? '') ?? 'fast';
  request.resume();
  if (request.method !== 'GET') {
    response.writeHead(200).end();
    return;
  }
  if (behaviour === 'silent') return; // never answers: no headers, no body
  response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(OBJECT.byteLength) });
  if (behaviour === 'fast') {
    response.end(OBJECT);
    return;
  }
  if (behaviour === 'stall') {
    response.write(OBJECT.subarray(0, CHUNK));
    response.on('close', () => {
      stalledClosed = true;
    });
    return; // the rest never comes
  }
  // steady: a chunk every 25 ms, 400 ms in all, never more than 25 ms between two chunks.
  for (let at = 0; at < OBJECT.byteLength && !response.destroyed; at += CHUNK) {
    response.write(OBJECT.subarray(at, at + CHUNK));
    await sleep(25);
  }
  response.end();
}

let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((request, response) => void answer(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const store = (timeouts: { requestMs: number; bodyIdleMs: number }) =>
  s3Store({ endpoint, region: 'us-east-1', bucket: 'wcr-evidence', accessKeyId: 'demo-key', secretAccessKey: 'demo-secret' }, timeouts);

function keyFor(behaviour: Behaviour): string {
  const key = newStorageKey(`${behaviour}${randomBytes(4).toString('hex')}`);
  behaviours.set(key.split('/')[0]!, behaviour);
  return key;
}

/** Reads the stream to its end, waiting `pauseMs` before the first read and after each chunk (a slow reader). */
async function readSlowly(stream: ReadableStream<Uint8Array>, pauseMs: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  if (pauseMs > 0) await sleep(pauseMs);
  for await (const chunk of stream) {
    chunks.push(chunk);
    if (pauseMs > 0) await sleep(pauseMs);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

describe('the S3 driver’s deadlines', () => {
  it('a store that sends steadily for longer than the request deadline delivers the whole object', async () => {
    const object = await store({ requestMs: 150, bodyIdleMs: 1_000 }).get(keyFor('steady'));
    expect(object!.size).toBe(OBJECT.byteLength);
    const started = Date.now();
    const bytes = await readSlowly(object!.body, 0);
    expect(Date.now() - started).toBeGreaterThan(150);
    expect(sha256(bytes)).toBe(sha256(OBJECT));
  });

  it('a reader slower than both deadlines still gets the whole object: the idle timer runs only while a read waits for the store', async () => {
    const object = await store({ requestMs: 100, bodyIdleMs: 100 }).get(keyFor('fast'));
    const started = Date.now();
    // 150 ms between two reads: longer than the request deadline and the idle timeout.
    const bytes = await readSlowly(object!.body, 150);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(sha256(bytes)).toBe(sha256(OBJECT));
  });

  it('a store that never answers fails within the request deadline, without naming the key or the address', async () => {
    const key = keyFor('silent');
    const started = Date.now();
    const error = await store({ requestMs: 150, bodyIdleMs: 1_000 })
      .get(key)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(StorageError);
    expect((error as Error).message).toMatch(/did not answer a GET \(TimeoutError\)/);
    expect((error as Error).message).not.toContain(key);
    expect((error as Error).message).not.toContain(endpoint);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a body that stops arriving fails after the idle timeout and closes the connection', async () => {
    stalledClosed = false;
    const object = await store({ requestMs: 1_000, bodyIdleMs: 150 }).get(keyFor('stall'));
    const started = Date.now();
    const error = await readSlowly(object!.body, 0).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StorageError);
    expect((error as Error).message).toMatch(/stopped sending an object/);
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect.poll(() => stalledClosed, { timeout: 2_000 }).toBe(true);
  });
});
