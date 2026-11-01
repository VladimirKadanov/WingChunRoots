// The S3 driver of the object store (milestone M10a; plan §6.1): SeaweedFS in Docker Compose and
// CI, and later the provider chosen with hosting (plan §3.3). Path-style addresses
// (<endpoint>/<bucket>/<key>) signed with AWS Signature V4 by aws4fetch (docs/adr/0012). Every
// request carries the credentials; the bucket stays private and no address is ever handed out (no
// presigned GET, plan §6.4). Errors name the operation and the HTTP status, never the key or the
// address (CLAUDE.md §6).

import { AwsClient } from 'aws4fetch';

import { assertStorageKey, type ObjectStore, StorageError } from './types';

export interface S3Config {
  /** The service's origin, for example http://127.0.0.1:8333 (no bucket, no trailing slash needed). */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * A store request never waits forever: a store that does not answer fails the request instead of
 * holding it. The deadline covers the request up to the response headers (for a PUT, the whole
 * upload); it never covers the body of a GET, which the download streams to a reader at the
 * reader's pace (M10a review, code-3: a total deadline cut long downloads part-way).
 */
export const REQUEST_TIMEOUT_MS = 30_000;
/** A GET body whose next bytes do not arrive for this long fails: the store stalled mid-object. */
export const BODY_IDLE_TIMEOUT_MS = 30_000;

export interface S3Timeouts {
  /** Until the response headers arrive (REQUEST_TIMEOUT_MS). */
  requestMs?: number;
  /** Between two chunks of a GET body that the reader asked for (BODY_IDLE_TIMEOUT_MS). */
  bodyIdleMs?: number;
}

const timeoutError = (what: string) => new DOMException(`The S3 store did not answer in time (${what}).`, 'TimeoutError');

/**
 * `body` with an idle deadline: a read that the consumer asked for and the store does not answer
 * within `idleMs` cancels the store's stream (which closes its connection) and errors this one. A
 * slow consumer never trips it: the store is read only when the consumer asks for more (pull, no
 * read-ahead), and the timer runs only while such a read waits.
 */
export function withIdleTimeout(body: ReadableStream<Uint8Array>, idleMs: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stalled = new Promise<'stalled'>((resolve) => {
          timer = setTimeout(() => resolve('stalled'), idleMs);
        });
        try {
          const next = await Promise.race([reader.read(), stalled]);
          if (next === 'stalled') {
            void reader.cancel(timeoutError('GET body')).catch(() => undefined);
            controller.error(new StorageError('The S3 store stopped sending an object (TimeoutError).'));
          } else if (next.done) {
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          const name = error instanceof Error ? error.name : 'error';
          controller.error(new StorageError(`The S3 store failed while sending an object (${name}).`, { cause: error }));
        } finally {
          clearTimeout(timer);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

export function s3Store(config: S3Config, timeouts: S3Timeouts = {}): ObjectStore {
  const requestMs = timeouts.requestMs ?? REQUEST_TIMEOUT_MS;
  const bodyIdleMs = timeouts.bodyIdleMs ?? BODY_IDLE_TIMEOUT_MS;
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
    retries: 2,
  });
  const origin = config.endpoint.replace(/\/+$/, '');
  const bucket = encodeURIComponent(config.bucket);

  function urlOf(key: string): string {
    assertStorageKey(key);
    return `${origin}/${bucket}/${key}`;
  }

  /**
   * One signed request, failed when its response headers do not arrive within `requestMs`. The
   * race settles the deadline itself: the abort that goes with it is only a courtesy to the
   * connection, since aws4fetch wraps the call in a Request that holds the signal weakly. Once the
   * headers are there the timer is cleared, so the body is never aborted by it.
   */
  async function send(operation: string, key: string, init: RequestInit): Promise<Response> {
    const url = urlOf(key);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = timeoutError(operation);
        controller.abort(error);
        reject(error);
      }, requestMs);
    });
    const fetched = client.fetch(url, { ...init, signal: controller.signal });
    try {
      return await Promise.race([fetched, deadline]);
    } catch (error) {
      // A response that arrives after the deadline is dropped; a late failure is not unhandled.
      fetched.then(
        (late) => late.body?.cancel().catch(() => undefined),
        () => undefined,
      );
      if (error instanceof StorageError) throw error;
      const name = error instanceof Error ? error.name : 'error';
      throw new StorageError(`The S3 store did not answer a ${operation} (${name}).`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    driver: 's3',
    async put(key, body, options) {
      // fetch sets Content-Length from the body itself.
      const headers: Record<string, string> = { 'content-type': options.contentType };
      if (options.sha256) headers['x-amz-content-sha256'] = options.sha256;
      // A copy when the bytes are a view of a shared buffer (fetch takes an ArrayBuffer-backed view).
      const payload = body.buffer instanceof ArrayBuffer ? (body as Uint8Array<ArrayBuffer>) : body.slice();
      const response = await send('PUT', key, { method: 'PUT', body: payload, headers });
      await response.body?.cancel();
      if (!response.ok) throw new StorageError(`The S3 store refused a PUT (HTTP ${response.status}).`);
    },
    async get(key) {
      const response = await send('GET', key, { method: 'GET' });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new StorageError(`The S3 store refused a GET (HTTP ${response.status}).`);
      }
      return { body: withIdleTimeout(response.body, bodyIdleMs), size: Number(response.headers.get('content-length') ?? 0) };
    },
    async delete(key) {
      const response = await send('DELETE', key, { method: 'DELETE' });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new StorageError(`The S3 store refused a DELETE (HTTP ${response.status}).`);
    },
  };
}
