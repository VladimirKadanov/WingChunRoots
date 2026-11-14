// Copy, verify and put back the objects of the archive (review 2026-11-13, ops.md H1), against
// temporary filesystem stores: every family comes through the archive copy, and a row that points at
// a missing or altered object is a problem, never a green result.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ObjectStore } from '../../src/server/storage';
import { filesystemStore } from '../../src/server/storage/fs';
import { copyObjects, restoreObjects, type StoreResolver, verifyObjects } from './object-archive';
import { familyById, type ObjectRow } from './object-families';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const hex = (n: number) => String(n).repeat(48);

let root: string;
let evidence: ObjectStore;
let media: ObjectStore;
let stores: StoreResolver;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'wcr-objects-'));
  evidence = filesystemStore(path.join(root, 'evidence-store'));
  media = filesystemStore(path.join(root, 'media-store'));
  stores = (name) => (name === 'media' ? media : evidence);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** One row of every family, its objects written to the right store. */
async function seed(): Promise<ObjectRow[]> {
  const rows: ObjectRow[] = [];
  const put = async (store: ObjectStore, key: string, bytes: string) => store.put(key, Buffer.from(bytes), { contentType: 'application/octet-stream' });

  const evidenceKey = `evidence/${hex(1)}`;
  await put(evidence, evidenceKey, 'demo evidence');
  rows.push({ family: familyById('evidence')!, id: 'e1', key: evidenceKey, sha256: sha('demo evidence'), mime: 'application/pdf', parts: [''] });

  const certKey = `certificates/${hex(2)}`;
  for (const part of ['96', '512', 'full']) await put(evidence, `${certKey}/${part}`, `cert ${part}`);
  rows.push({ family: familyById('certificate')!, id: 'c1', key: certKey, sha256: sha('cert full'), mime: 'image/webp', parts: ['96', '512', 'full'] });

  const personKey = `photos/${hex(3)}`;
  for (const part of ['96', '512', 'full']) await put(media, `${personKey}/${part}`, `person ${part}`);
  rows.push({ family: familyById('person_photo')!, id: 'p1', key: personKey, sha256: sha('person 512'), mime: 'image/webp', parts: ['96', '512', 'full'] });

  const logoKey = `photos/${hex(4)}`;
  for (const part of ['96', '512']) await put(media, `${logoKey}/${part}`, `logo ${part}`);
  rows.push({ family: familyById('school_photo')!, id: 's1', key: logoKey, sha256: sha('logo 512'), mime: 'image/webp', parts: ['96', '512'] });

  const posterKey = `photos/${hex(5)}`;
  for (const part of ['96', '512', 'full']) await put(media, `${posterKey}/${part}`, `poster ${part}`);
  rows.push({ family: familyById('event_poster')!, id: 'v1', key: posterKey, sha256: sha('poster full'), mime: 'image/webp', parts: ['96', '512', 'full'] });
  return rows;
}

const okOf = (result: { tallies: { family: { id: string }; ok: number; rows: number }[] }) =>
  Object.fromEntries(result.tallies.map((t) => [t.family.id, `${t.ok}/${t.rows}`]));

describe('copyObjects and verifyObjects', () => {
  it('copies the objects of every family into one folder, each at its key, and verifies them there', async () => {
    const rows = await seed();
    const out = path.join(root, 'archive');
    const copied = await copyObjects(rows, stores, out);
    expect(copied.problems).toEqual([]);
    expect(okOf(copied)).toEqual({ evidence: '1/1', certificate: '1/1', person_photo: '1/1', school_photo: '1/1', event_poster: '1/1' });
    expect((await readFile(path.join(out, 'photos', hex(3), '512'))).toString()).toBe('person 512');
    expect((await readFile(path.join(out, 'certificates', hex(2), 'full'))).toString()).toBe('cert full');
    expect((await readFile(path.join(out, 'evidence', hex(1)))).toString()).toBe('demo evidence');
    expect((await stat(path.join(out, 'photos', hex(3), '512'))).mode & 0o777).toBe(0o600);

    const checked = await verifyObjects(rows, { dir: out });
    expect(checked.problems).toEqual([]);
    expect(okOf(checked)).toEqual(okOf(copied));
    // Without an archive copy the stores themselves are checked.
    expect((await verifyObjects(rows, { stores })).problems).toEqual([]);
  });

  it('fails a row whose object is missing from the store, for every family', async () => {
    const rows = await seed();
    for (const row of rows) {
      const gone = row.parts.at(-1)!;
      await (row.family.store === 'media' ? media : evidence).delete(gone === '' ? row.key : `${row.key}/${gone}`);
    }
    const copied = await copyObjects(rows, stores, path.join(root, 'archive'));
    expect(copied.problems.map((p) => `${p.family}:${p.row}:${p.reason}`).sort()).toEqual([
      'certificate:c1:object missing',
      'event_poster:v1:object missing',
      'evidence:e1:object missing',
      'person_photo:p1:object missing',
      'school_photo:s1:object missing',
    ]);
    expect((await verifyObjects(rows, { stores })).problems).toHaveLength(5);
  });

  it('fails a row whose non-hashed object is missing in the archive copy (a photo without its small square)', async () => {
    const rows = await seed();
    const out = path.join(root, 'archive');
    await copyObjects(rows, stores, out);
    await rm(path.join(out, 'photos', hex(3), '96'));
    const checked = await verifyObjects(rows, { dir: out });
    expect(checked.problems).toEqual([{ family: 'person_photo', row: 'p1', reason: 'object missing' }]);
    expect(okOf(checked).person_photo).toBe('0/1');
    expect(okOf(checked).school_photo).toBe('1/1');
  });

  it('fails a row whose family has no files in the archive copy at all (an M12 archive: evidence only)', async () => {
    const rows = await seed();
    const out = path.join(root, 'archive');
    await mkdir(path.join(out, 'evidence'), { recursive: true });
    await writeFile(path.join(out, 'evidence', hex(1)), 'demo evidence');
    const checked = await verifyObjects(rows, { dir: out });
    expect(okOf(checked).evidence).toBe('1/1');
    expect(checked.problems.map((p) => p.family).sort()).toEqual(['certificate', 'event_poster', 'person_photo', 'school_photo']);
  });

  it('fails a row whose hashed object differs from the row hash', async () => {
    const rows = await seed();
    const out = path.join(root, 'archive');
    await copyObjects(rows, stores, out);
    await writeFile(path.join(out, 'photos', hex(5), 'full'), 'tampered');
    await media.put(`photos/${hex(3)}/512`, Buffer.from('tampered'), { contentType: 'image/webp' });
    expect((await verifyObjects(rows, { dir: out })).problems).toEqual([{ family: 'event_poster', row: 'v1', reason: 'hash differs' }]);
    expect((await verifyObjects(rows, { stores })).problems).toEqual([{ family: 'person_photo', row: 'p1', reason: 'hash differs' }]);
  });

  it('names rows by id or, for the M12 key-only input, by line number; never prints a key', async () => {
    const [evidenceRow] = await seed();
    const legacy: ObjectRow = { ...evidenceRow!, id: '', key: `evidence/${hex(9)}` };
    const copied = await copyObjects([legacy], stores, path.join(root, 'archive'));
    expect(copied.problems).toEqual([{ family: 'evidence', row: 'line 1', reason: 'object missing' }]);
    expect(JSON.stringify(copied)).not.toContain(hex(9));
  });
});

describe('restoreObjects', () => {
  it('puts every family back into an empty store from the archive copy', async () => {
    const rows = await seed();
    const out = path.join(root, 'archive');
    await copyObjects(rows, stores, out);
    const fresh = {
      evidence: filesystemStore(path.join(root, 'new-evidence')),
      media: filesystemStore(path.join(root, 'new-media')),
    };
    const restored = await restoreObjects(rows, out, (name) => fresh[name]);
    expect(restored.problems).toEqual([]);
    expect(okOf(restored)).toEqual({ evidence: '1/1', certificate: '1/1', person_photo: '1/1', school_photo: '1/1', event_poster: '1/1' });
    expect((await verifyObjects(rows, { stores: (name) => fresh[name] })).problems).toEqual([]);
  });

  it('puts nothing of a row back when one of its objects is missing or altered, and says so', async () => {
    const rows = await seed();
    const out = path.join(root, 'archive');
    await copyObjects(rows, stores, out);
    await rm(path.join(out, 'photos', hex(3), 'full'));
    await writeFile(path.join(out, 'certificates', hex(2), 'full'), 'tampered');
    const fresh = {
      evidence: filesystemStore(path.join(root, 'new-evidence')),
      media: filesystemStore(path.join(root, 'new-media')),
    };
    const restored = await restoreObjects(rows, out, (name) => fresh[name]);
    expect(restored.problems.map((p) => `${p.family}:${p.reason}`).sort()).toEqual(['certificate:hash differs', 'person_photo:object missing']);
    expect(await fresh.media.get(`photos/${hex(3)}/96`)).toBeNull();
    expect(await fresh.evidence.get(`certificates/${hex(2)}/96`)).toBeNull();
    expect(await fresh.evidence.get(`evidence/${hex(1)}`)).not.toBeNull();
  });
});
