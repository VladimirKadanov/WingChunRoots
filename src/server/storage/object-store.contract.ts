// The contract every ObjectStore driver passes (milestone M10a, In scope 2): the filesystem driver
// everywhere (object-store.test.ts), the S3 driver whenever an S3 endpoint is configured (SeaweedFS
// in Docker Compose and CI). Imported only by tests.

import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { newStorageKey, type ObjectStore } from './index';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface ContractOptions {
  /** An unsigned GET of the object's address, for a driver that has one (S3): it must be refused. */
  anonymousGet?: (key: string) => Promise<number>;
}

export function objectStoreContract(name: string, make: () => ObjectStore | Promise<ObjectStore>, options: ContractOptions = {}) {
  describe(`ObjectStore contract: ${name}`, () => {
    it('stores an object and streams back exactly the same bytes with its size', async () => {
      const store = await make();
      const key = newStorageKey('contract');
      const body = new Uint8Array(randomBytes(3 * 1024 * 1024 + 17));
      await store.put(key, body, { contentType: 'application/pdf', sha256: sha256(body) });
      const object = await store.get(key);
      expect(object).not.toBeNull();
      expect(object!.size).toBe(body.byteLength);
      const read = await readAll(object!.body);
      expect(sha256(read)).toBe(sha256(body));
      await store.delete(key);
    });

    it('answers null for a key with no object, and deleting it twice is no error', async () => {
      const store = await make();
      const key = newStorageKey('contract');
      expect(await store.get(key)).toBeNull();
      await store.put(key, new Uint8Array([1, 2, 3]), { contentType: 'image/png' });
      await store.delete(key);
      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    });

    it('replaces an object put again under the same key', async () => {
      const store = await make();
      const key = newStorageKey('contract');
      await store.put(key, new Uint8Array([1, 2, 3]), { contentType: 'image/png' });
      await store.put(key, new Uint8Array([4, 5]), { contentType: 'image/png' });
      const object = await store.get(key);
      expect([...(await readAll(object!.body))]).toEqual([4, 5]);
      await store.delete(key);
    });

    it('refuses malformed keys (a path out of the store, an absolute path, dots) without naming them', async () => {
      const store = await make();
      for (const key of ['../escape', '/etc/passwd', 'evidence/../x', 'Evidence/UPPER', 'evidence//double', 'evidence/a.b', '']) {
        const error = await store.get(key).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error, key).toBeInstanceOf(Error);
        if (key) expect((error as Error).message, key).not.toContain(key);
        await expect(store.put(key, new Uint8Array([1]), { contentType: 'image/png' }), key).rejects.toThrow();
      }
    });

    it('new keys are random, with nothing from the file, its name or its uploader', () => {
      const keys = new Set(Array.from({ length: 100 }, () => newStorageKey()));
      expect(keys.size).toBe(100);
      for (const key of keys) expect(key).toMatch(/^evidence\/[0-9a-f]{48}$/);
    });

    it('offers no address of an object: no presigned or public URL in the interface', async () => {
      const store = await make();
      expect(Object.keys(store).sort()).toEqual(['delete', 'driver', 'get', 'put']);
    });

    if (options.anonymousGet) {
      const anonymousGet = options.anonymousGet;
      it('keeps the bucket private: an unsigned GET of an object is refused', async () => {
        const store = await make();
        const key = newStorageKey('contract');
        await store.put(key, new Uint8Array([7, 7, 7]), { contentType: 'application/pdf' });
        try {
          const status = await anonymousGet(key);
          expect(status).toBeGreaterThanOrEqual(400);
        } finally {
          await store.delete(key);
        }
      });
    }
  });
}
