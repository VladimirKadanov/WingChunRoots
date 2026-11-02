// readObjectBytes (M14, CI run 41470799646): a photo rendition is read whole under one short
// deadline, and the store's response is always finished (read to its end or cancelled). Against
// fake stores that record what happened to their body, and against the real S3 driver talking to a
// fake S3 server on a loopback port whose S3 deadlines (30 s) are far longer than the read's.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readObjectBytes, StorageTimeoutError } from './read';
import { s3Store } from './s3';
import { type GetOptions, newStorageKey, type ObjectStore, StorageError, type StoredObject } from './types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DEADLINE_MS = 200;
/** How much later than the deadline a read may fail: timers and a loaded CI machine. */
const SLACK_MS = 800;

interface Tracked {
  store: ObjectStore;
  /** Whether the body the store handed out was cancelled. */
  cancelled: () => boolean;
  /** Whether the body was read to its end. */
  drained: () => boolean;
  /** The signal the read passed to get. */
  signal: () => AbortSignal | undefined;
}

/**
 * A store whose get answers after `getDelayMs` (never when null) with a body of `chunks`, then,
 * when `stallAfter` is set, sends nothing more after that many chunks.
 */
function trackedStore({ chunks, getDelayMs = 0, stallAfter }: { chunks: Uint8Array[]; getDelayMs?: number | null; stallAfter?: number }): Tracked {
  let cancelled = false;
  let drained = false;
  let seen: AbortSignal | undefined;
  const body = () => {
    let sent = 0;
    return new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (stallAfter !== undefined && sent >= stallAfter) return new Promise<void>(() => undefined);
          const next = chunks[sent++];
          if (next) controller.enqueue(next);
          else {
            drained = true;
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
  };
  const store: ObjectStore = {
    driver: 'filesystem',
    put: async () => undefined,
    delete: async () => undefined,
    async get(_key: string, options?: GetOptions): Promise<StoredObject | null> {
      seen = options?.signal;
      if (getDelayMs === null) return new Promise<never>(() => undefined);
      if (getDelayMs > 0) await sleep(getDelayMs);
      return { body: body(), size: chunks.reduce((n, c) => n + c.byteLength, 0) };
    },
  };
  return { store, cancelled: () => cancelled, drained: () => drained, signal: () => seen };
}

async function timed<T>(promise: Promise<T>): Promise<{ ms: number; error: unknown; value?: T }> {
  const started = performance.now();
  try {
    const value = await promise;
    return { ms: performance.now() - started, error: undefined, value };
  } catch (error) {
    return { ms: performance.now() - started, error };
  }
}

const KEY = 'photos/abc123/96';
const options = { timeoutMs: DEADLINE_MS, maxBytes: 64 * 1024 };

describe('readObjectBytes with a fake store', () => {
  it('reads the whole object and reads the body to its end', async () => {
    const tracked = trackedStore({ chunks: [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])] });
    const bytes = await readObjectBytes(tracked.store, KEY, options);
    expect([...bytes!]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tracked.drained()).toBe(true);
    expect(tracked.cancelled()).toBe(false);
  });

  it('a get that never answers fails within the deadline, and its signal is aborted', async () => {
    const tracked = trackedStore({ chunks: [new Uint8Array([1])], getDelayMs: null });
    const { ms, error } = await timed(readObjectBytes(tracked.store, KEY, options));
    expect(error).toBeInstanceOf(StorageTimeoutError);
    expect(error).toBeInstanceOf(StorageError);
    expect(ms).toBeGreaterThanOrEqual(DEADLINE_MS - 20);
    expect(ms).toBeLessThan(DEADLINE_MS + SLACK_MS);
    expect(tracked.signal()?.aborted).toBe(true);
  });

  it('a get that answers only after the deadline has its body cancelled', async () => {
    const tracked = trackedStore({ chunks: [new Uint8Array([1])], getDelayMs: DEADLINE_MS + 100 });
    const { error } = await timed(readObjectBytes(tracked.store, KEY, options));
    expect(error).toBeInstanceOf(StorageTimeoutError);
    await sleep(250);
    expect(tracked.cancelled()).toBe(true);
  });

  it('a body that stalls mid-stream fails within the deadline and is cancelled', async () => {
    const tracked = trackedStore({ chunks: [new Uint8Array(100), new Uint8Array(100)], stallAfter: 1 });
    const { ms, error } = await timed(readObjectBytes(tracked.store, KEY, options));
    expect(error).toBeInstanceOf(StorageTimeoutError);
    expect(ms).toBeLessThan(DEADLINE_MS + SLACK_MS);
    await sleep(0);
    expect(tracked.cancelled()).toBe(true);
    expect(tracked.drained()).toBe(false);
  });

  it('an object larger than allowed is refused and its body cancelled', async () => {
    const tracked = trackedStore({ chunks: [new Uint8Array(40 * 1024), new Uint8Array(40 * 1024)] });
    const { error } = await timed(readObjectBytes(tracked.store, KEY, options));
    expect(error).toBeInstanceOf(StorageError);
    expect(error).not.toBeInstanceOf(StorageTimeoutError);
    await sleep(0);
    expect(tracked.cancelled()).toBe(true);
  });

  it("the caller's signal ends the read at once and cancels the body", async () => {
    const tracked = trackedStore({ chunks: [new Uint8Array(10), new Uint8Array(10)], stallAfter: 1 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const { ms, error } = await timed(readObjectBytes(tracked.store, KEY, { ...options, timeoutMs: 10_000, signal: controller.signal }));
    expect(error).toBeInstanceOf(StorageTimeoutError);
    expect(ms).toBeLessThan(1_000);
    await sleep(0);
    expect(tracked.cancelled()).toBe(true);
  });

  it('a missing object is null', async () => {
    const store: ObjectStore = { driver: 'filesystem', put: async () => undefined, delete: async () => undefined, get: async () => null };
    expect(await readObjectBytes(store, KEY, options)).toBeNull();
  });
});

// --- The real S3 driver against a fake S3 server --------------------------------------------------

type Behaviour = 'fast' | 'silent' | 'stall' | 'flaky';
const OBJECT = new Uint8Array(32 * 1024).map((_, i) => i % 251);
const behaviours = new Map<string, Behaviour>();
/** Per behaviour: how many of the server's responses the client closed before they ended. */
const closedEarly = new Map<Behaviour, number>();
/** Per behaviour: how many requests the server saw. */
const requests = new Map<Behaviour, number>();

function answer(request: IncomingMessage, response: ServerResponse): void {
  const behaviour = behaviours.get(request.url!.split('/')[2] ?? '') ?? 'fast';
  requests.set(behaviour, (requests.get(behaviour) ?? 0) + 1);
  request.resume();
  response.on('close', () => {
    if (!response.writableFinished) closedEarly.set(behaviour, (closedEarly.get(behaviour) ?? 0) + 1);
  });
  if (behaviour === 'silent') return; // no headers, no body
  if (behaviour === 'flaky' && (requests.get('flaky') ?? 0) <= 2) {
    // A 503 whose body never ends: left unread, it would hold its connection open.
    response.writeHead(503, { 'content-type': 'application/xml', 'content-length': '1000' });
    response.write('<Error>');
    return;
  }
  response.writeHead(200, { 'content-type': 'image/webp', 'content-length': String(OBJECT.byteLength) });
  if (behaviour === 'stall') {
    response.write(OBJECT.subarray(0, 1024));
    return; // the rest never comes
  }
  response.end(OBJECT);
}

let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer(answer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** The S3 driver with its default deadlines (30 s each): only the read's deadline can end a stall. */
const s3 = () => s3Store({ endpoint, region: 'us-east-1', bucket: 'wcr-media', accessKeyId: 'demo-key', secretAccessKey: 'demo-secret' });

function keyFor(behaviour: Behaviour): string {
  const key = newStorageKey(`${behaviour}${Math.random().toString(16).slice(2, 10)}`);
  behaviours.set(key.split('/')[0]!, behaviour);
  return key;
}

async function until(condition: () => boolean, ms = 2_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(10);
  return condition();
}

describe('readObjectBytes with the S3 driver', () => {
  it('reads a whole object', async () => {
    const bytes = await readObjectBytes(s3(), keyFor('fast'), options);
    expect(bytes).toEqual(OBJECT);
  });

  it('a store that never answers fails within the deadline (not the 30 s S3 deadline) and its connection is closed', async () => {
    const { ms, error } = await timed(readObjectBytes(s3(), keyFor('silent'), options));
    expect(error).toBeInstanceOf(StorageError);
    expect(ms).toBeLessThan(DEADLINE_MS + SLACK_MS);
    expect(await until(() => (closedEarly.get('silent') ?? 0) >= 1)).toBe(true);
  });

  it('a body that stalls mid-object fails within the deadline and its connection is closed', async () => {
    const { ms, error } = await timed(readObjectBytes(s3(), keyFor('stall'), options));
    expect(error).toBeInstanceOf(StorageError);
    expect(ms).toBeLessThan(DEADLINE_MS + SLACK_MS);
    expect(await until(() => (closedEarly.get('stall') ?? 0) >= 1)).toBe(true);
  });

  it('a 5xx answer that is retried has its body cancelled, so its connection does not stay open', async () => {
    const bytes = await readObjectBytes(s3(), keyFor('flaky'), { ...options, timeoutMs: 5_000 });
    expect(bytes).toEqual(OBJECT);
    expect(requests.get('flaky')).toBe(3);
    expect(await until(() => (closedEarly.get('flaky') ?? 0) >= 2)).toBe(true);
  });
});
