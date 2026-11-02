// A whole small object read into memory under one deadline (milestone M14; docs/adr/0016-profile-
// photos.md). Profile photo renditions are a few tens of kilobytes, so the photo route reads the
// whole rendition before it answers instead of streaming the store's body to the browser: a store
// that does not answer, or stops sending part-way, fails the read within `timeoutMs` (the request,
// the headers and the body together), and the route answers 503 at once instead of holding the
// browser's request (and the page's `load` event) for the S3 driver's 30 s + 30 s deadlines (CI run
// 41470799646: an image request of the lineage page stayed pending until the test was killed).
//
// The store's response is always finished: read to its end, or cancelled (on the deadline, an
// error, an object larger than `maxBytes`, or the caller's signal), so no connection to the store
// is left open with an unread body. A get that answers only after the deadline has its body
// cancelled too.

import { type ObjectStore, StorageError } from './types';

/** The deadline of a read was reached (or the caller gave up): the name is what the logs show. */
export class StorageTimeoutError extends StorageError {
  constructor(message = 'The store did not deliver an object in time.') {
    super(message);
    this.name = 'StorageTimeoutError';
  }
}

export interface ReadOptions {
  /** The whole read, from the request to the last byte. */
  timeoutMs: number;
  /** An object larger than this is refused (and its body cancelled). */
  maxBytes: number;
  /** The caller's own signal (the browser went away): ends the read like the deadline. */
  signal?: AbortSignal;
}

/**
 * A deadline that can race any promise: `race` rejects with the deadline's reason once it passes
 * (or `signal` aborts), and hands a value that arrives only afterwards to `late`, so it can be
 * cleaned up. `signal` aborts with it, for the store request itself.
 */
export function createDeadline(timeoutMs: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new StorageTimeoutError(`The store did not deliver an object within ${timeoutMs} ms.`)), timeoutMs);
  const onOuterAbort = () => controller.abort(new StorageTimeoutError('The read was given up by its caller.'));
  if (outer?.aborted) onOuterAbort();
  else outer?.addEventListener('abort', onOuterAbort, { once: true });
  const expired = new Promise<never>((_, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason);
    else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  expired.catch(() => undefined);
  return {
    signal: controller.signal,
    async race<T>(promise: Promise<T>, late?: (value: T) => void): Promise<T> {
      try {
        return await Promise.race([promise, expired]);
      } catch (error) {
        if (controller.signal.aborted && error === controller.signal.reason) {
          promise.then(
            (value) => late?.(value),
            () => undefined,
          );
        }
        throw error;
      }
    },
    clear() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    },
  };
}

/** The whole object at `key` as bytes, or null when there is none; StorageError on any failure. */
export async function readObjectBytes(store: ObjectStore, key: string, options: ReadOptions): Promise<Uint8Array<ArrayBuffer> | null> {
  const deadline = createDeadline(options.timeoutMs, options.signal);
  try {
    let object: Awaited<ReturnType<ObjectStore['get']>>;
    try {
      object = await deadline.race(store.get(key, { signal: deadline.signal }), (late) => {
        void late?.body.cancel().catch(() => undefined);
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      const name = error instanceof Error ? error.name : 'error';
      throw new StorageError(`The store did not answer a read (${name}).`, { cause: error });
    }
    if (!object) return null;
    const reader = object.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      if (object.size > options.maxBytes) throw new StorageError('The store holds a larger object than expected.');
      for (;;) {
        const next = await deadline.race(reader.read());
        if (next.done) break;
        total += next.value.byteLength;
        if (total > options.maxBytes) throw new StorageError('The store sent a larger object than expected.');
        chunks.push(next.value);
      }
    } catch (error) {
      // Not awaited: a store that ignores the cancel must not hold the answer either.
      void reader.cancel(error).catch(() => undefined);
      if (error instanceof StorageError) throw error;
      const name = error instanceof Error ? error.name : 'error';
      throw new StorageError(`The store failed while sending an object (${name}).`, { cause: error });
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return bytes;
  } finally {
    deadline.clear();
  }
}
