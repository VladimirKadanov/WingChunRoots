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

/** A store request never waits forever: a slow store fails the upload instead of holding it. */
const REQUEST_TIMEOUT_MS = 30_000;

export function s3Store(config: S3Config): ObjectStore {
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

  async function send(operation: string, key: string, init: RequestInit): Promise<Response> {
    try {
      return await client.fetch(urlOf(key), { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      const name = error instanceof Error ? error.name : 'error';
      throw new StorageError(`The S3 store did not answer a ${operation} (${name}).`, { cause: error });
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
      return { body: response.body, size: Number(response.headers.get('content-length') ?? 0) };
    },
    async delete(key) {
      const response = await send('DELETE', key, { method: 'DELETE' });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new StorageError(`The S3 store refused a DELETE (HTTP ${response.status}).`);
    },
  };
}
