// Copy, verify and put back the objects of the archive (review 2026-11-13, ops.md H1), for
// scripts/ops/evidence-objects.ts. The families, the stores they live in and the rules of "has files
// right now" are in ./object-families.ts. Nothing here prints or returns a storage key, a name or
// a file's content (CLAUDE.md §6): the results carry row ids, family names and counts.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isStorageKey, type ObjectStore } from '../../src/server/storage';
import { hashedPart, type ObjectFamily, type ObjectRow, objectKeys, type StoreName } from './object-families';

/** The store of a family's objects; resolved only when a row of that store comes up. */
export type StoreResolver = (name: StoreName) => ObjectStore;

export interface FamilyTally {
  family: ObjectFamily;
  /** Rows seen. */
  rows: number;
  /** Rows with every object present (and, where checked, matching). */
  ok: number;
  /** The store driver that served this family (`filesystem`, `s3`) or `archive` for a copy on disk. */
  source: string;
}

export interface Problem {
  family: ObjectFamily['id'];
  /** The row's id, or its line number when the line carried none (the M12 key-only input). */
  row: string;
  reason: 'object missing' | 'hash differs' | 'malformed line';
}

export interface ArchiveResult {
  tallies: FamilyTally[];
  problems: Problem[];
}

function tallyOf(result: ArchiveResult, family: ObjectFamily, source: string): FamilyTally {
  let tally = result.tallies.find((t) => t.family.id === family.id && t.source === source);
  if (!tally) {
    tally = { family, rows: 0, ok: 0, source };
    result.tallies.push(tally);
  }
  return tally;
}

const rowLabel = (row: ObjectRow, index: number) => row.id || `line ${index + 1}`;

/** <dir>/<key>, refusing a key that is not one (no "..", no absolute path). */
export function objectPath(dir: string, key: string): string {
  if (!isStorageKey(key)) throw new Error('a malformed storage key was refused');
  return path.join(dir, ...key.split('/'));
}

/** Copies the objects of `rows` into `dir`, each at <dir>/<key>; a row with one object missing in the store is a problem. */
export async function copyObjects(rows: readonly ObjectRow[], stores: StoreResolver, dir: string): Promise<ArchiveResult> {
  const result: ArchiveResult = { tallies: [], problems: [] };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [index, row] of rows.entries()) {
    const store = stores(row.family.store);
    const tally = tallyOf(result, row.family, store.driver);
    tally.rows += 1;
    let complete = true;
    for (const key of objectKeys(row)) {
      const object = await store.get(key);
      if (!object) {
        complete = false;
        continue;
      }
      const target = objectPath(dir, key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await pipeline(Readable.fromWeb(object.body as import('node:stream/web').ReadableStream), createWriteStream(target, { mode: 0o600 }));
      await chmod(target, 0o600);
    }
    if (complete) tally.ok += 1;
    else result.problems.push({ family: row.family.id, row: rowLabel(row, index), reason: 'object missing' });
  }
  return result;
}

async function sha256OfStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of Readable.fromWeb(body as import('node:stream/web').ReadableStream)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The SHA-256 of one stored object, or null when it is not there. `dir`: the archive's copy; otherwise the store. */
async function sha256Of(key: string, source: { dir: string } | { store: ObjectStore }): Promise<string | null> {
  try {
    if ('dir' in source) return createHash('sha256').update(await readFile(objectPath(source.dir, key))).digest('hex');
    const object = await source.store.get(key);
    return object ? await sha256OfStream(object.body) : null;
  } catch {
    return null;
  }
}

/** Whether one stored object exists (without reading all of it from a store). */
async function exists(key: string, source: { dir: string } | { store: ObjectStore }): Promise<boolean> {
  try {
    if ('dir' in source) {
      await readFile(objectPath(source.dir, key));
      return true;
    }
    const object = await source.store.get(key);
    if (!object) return false;
    await object.body.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks a sample (or all) of the rows: every object of a row is there, and the one the row's
 * SHA-256 describes has that hash. `dir`: the archive's copy of the objects; without it the stores
 * (a drill of an archive made without --objects, against the objects that are there now).
 */
export async function verifyObjects(rows: readonly ObjectRow[], source: { dir: string } | { stores: StoreResolver }): Promise<ArchiveResult> {
  const result: ArchiveResult = { tallies: [], problems: [] };
  for (const [index, row] of rows.entries()) {
    const where = 'dir' in source ? ({ dir: source.dir } as const) : ({ store: source.stores(row.family.store) } as const);
    const tally = tallyOf(result, row.family, 'dir' in where ? 'archive' : where.store.driver);
    tally.rows += 1;
    const hashed = hashedPart(row.family);
    const names = objectKeys(row);
    let reason: Problem['reason'] | null = null;
    for (const [at, key] of names.entries()) {
      if (row.parts[at] === hashed) {
        const actual = await sha256Of(key, where);
        if (actual === null) reason = 'object missing';
        else if (actual !== row.sha256) reason ??= 'hash differs';
      } else if (!(await exists(key, where))) {
        reason = 'object missing';
      }
    }
    if (reason === null) tally.ok += 1;
    else result.problems.push({ family: row.family.id, row: rowLabel(row, index), reason });
  }
  return result;
}

/**
 * Puts the objects of an archive's copy back into the stores. An object whose hash is the row's
 * (for the object the hash describes) is put back; one that differs is refused, one that is not in
 * the copy is a problem.
 */
export async function restoreObjects(rows: readonly ObjectRow[], dir: string, stores: StoreResolver): Promise<ArchiveResult> {
  const result: ArchiveResult = { tallies: [], problems: [] };
  for (const [index, row] of rows.entries()) {
    const store = stores(row.family.store);
    const tally = tallyOf(result, row.family, store.driver);
    tally.rows += 1;
    const hashed = hashedPart(row.family);
    const bodies: { key: string; body: Buffer; sha256: string }[] = [];
    let reason: Problem['reason'] | null = null;
    for (const [at, key] of objectKeys(row).entries()) {
      let body: Buffer;
      try {
        body = await readFile(objectPath(dir, key));
      } catch {
        reason = 'object missing';
        continue;
      }
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (row.parts[at] === hashed && sha256 !== row.sha256) {
        reason ??= 'hash differs';
        continue;
      }
      bodies.push({ key, body, sha256 });
    }
    // All or nothing per row: a half-restored photo is worse than a missing one.
    if (reason === null) {
      for (const { key, body, sha256 } of bodies) await store.put(key, body, { contentType: row.mime, sha256 });
      tally.ok += 1;
    } else {
      result.problems.push({ family: row.family.id, row: rowLabel(row, index), reason });
    }
  }
  return result;
}
