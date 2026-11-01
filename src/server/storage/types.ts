// The object store (plan §6.1, §6.4; milestone M10a): one interface with a filesystem driver
// (cloud sessions, tests, the default without an S3 endpoint) and an S3 driver (SeaweedFS in Docker
// Compose and CI; later the provider chosen with hosting, plan §3.3, with no change in the
// services). Both pass one contract test (object-store.contract.ts).
//
// Evidence lives only in the private bucket or the private folder: a store never makes an object
// public, never hands out an address of it (no presigned GET, plan §6.4) and never logs a key. The
// app streams an object to a reader only after checking who asks (src/server/services/evidence.ts).

import { randomBytes } from 'node:crypto';

export interface PutOptions {
  /** The object's media type, as the upload's magic bytes said (never the client's word). */
  contentType: string;
  /** The SHA-256 of `body` in lower-case hex, when the caller has it (the S3 driver signs it). */
  sha256?: string;
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  size: number;
}

export interface ObjectStore {
  readonly driver: 'filesystem' | 's3';
  /** Stores `body` under `key`, replacing any object there. */
  put(key: string, body: Uint8Array, options: PutOptions): Promise<void>;
  /** The object as a stream, or null when there is none. */
  get(key: string): Promise<StoredObject | null>;
  /** Removes the object; removing one that is not there is no error. */
  delete(key: string): Promise<void>;
}

/** A failure of the store, without the key or any address in its message (CLAUDE.md §6). */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

/** Lower-case letters and digits in segments joined by "/": no dots, so no "..", and no absolute path. */
const KEY = /^[a-z0-9]+(?:\/[a-z0-9_-]+){0,8}$/;
const KEY_MAX = 200;

export function isStorageKey(key: string): boolean {
  return key.length <= KEY_MAX && KEY.test(key);
}

export function assertStorageKey(key: string): void {
  if (!isStorageKey(key)) throw new StorageError('Refused a malformed storage key.');
}

/**
 * A new random key (plan §6.4): `evidence/<48 hex digits>` from 24 random bytes. Nothing in it
 * comes from the file, its name, its uploader or the time.
 */
export function newStorageKey(prefix = 'evidence'): string {
  return `${prefix}/${randomBytes(24).toString('hex')}`;
}
