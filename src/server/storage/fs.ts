// The filesystem driver of the object store (milestone M10a; plan §6.1): the private folder of
// cloud sessions and tests, and the default when no S3 endpoint is configured. Folders are created
// with mode 0700 and files with 0600; a write goes to a temporary file first and is renamed into
// place, so a reader never sees half a file. The folder must lie outside public/ (index.ts checks).

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { assertStorageKey, type ObjectStore, StorageError } from './types';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function filesystemStore(root: string): ObjectStore {
  const base = path.resolve(root);

  /** The file of `key`, always inside `base`. */
  function fileOf(key: string): string {
    assertStorageKey(key);
    const file = path.resolve(base, ...key.split('/'));
    if (!file.startsWith(base + path.sep)) throw new StorageError('Refused a storage key outside the store.');
    return file;
  }

  return {
    driver: 'filesystem',
    async put(key, body) {
      const file = fileOf(key);
      const temporary = `${file}.${randomBytes(6).toString('hex')}.part`;
      try {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, body, { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw new StorageError(`The file store could not write an object (${errorCode(error) ?? 'error'}).`, { cause: error });
      }
    },
    async get(key) {
      const file = fileOf(key);
      let size: number;
      try {
        const info = await stat(file);
        if (!info.isFile()) return null;
        size = info.size;
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return null;
        throw new StorageError(`The file store could not read an object (${errorCode(error) ?? 'error'}).`, { cause: error });
      }
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return { body, size };
    },
    async delete(key) {
      try {
        await rm(fileOf(key), { force: true });
      } catch (error) {
        throw new StorageError(`The file store could not remove an object (${errorCode(error) ?? 'error'}).`, { cause: error });
      }
    },
  };
}
