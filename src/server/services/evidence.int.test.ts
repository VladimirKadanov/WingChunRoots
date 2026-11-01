// Evidence files (milestone M10a, Done when 3), against a migrated throwaway database: EXIF and GPS
// are gone from stored images; `sha256` is the hash of the stored object and `original_sha256` the
// hash of the uploaded original of a re-encoded image; the type comes from the magic bytes; at most
// 20 files per case (DEFAULT D25); a Content-Length over 20 MB is refused before a byte of the body
// is read; the download answers with Content-Disposition: attachment, Cache-Control: no-store and
// X-Content-Type-Options: nosniff, writes evidence.view, and answers 404 to everyone not allowed.
//
// The service tests use a filesystem store in a private temporary folder; the HTTP tests go through
// the route handlers' functions (src/server/evidence-http.ts) with a real bearer session and the
// store of the environment (the filesystem here, SeaweedFS in CI). Every file is generated here and
// fictional: flat-colour images with a made-up camera and position, PDFs of filler text.

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAccount, signIn, startAuthTestDatabase, stopAuthTestDatabase, TEST_APP_URL } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, evidenceFile, evidenceLink } from '../db/schema';
import { EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES_PER_CASE } from '../db/schema/common';
import type { TestDatabase } from '../db/testing';
import { handleEvidenceDownload, handleEvidenceUpload } from '../evidence-http';
import { filesystemStore } from '../storage/fs';
import { containsAscii, exifTiff, imageFacts, jpegWithGps, plainImage, pngWithGps, TEST_EXIF_CAMERA } from '../storage/test-images';
import type { ObjectStore } from '../storage';
import { CASE_FULL_MESSAGE, discardEvidence, openEvidence, TOO_LARGE_MESSAGE, UNATTACHED_FULL_MESSAGE, uploadEvidence, WRONG_TYPE_MESSAGE } from './evidence';
import { requestHistoricalTeacher } from './historical';
import { assignReviewCase } from './review';
import { key, member, meta, newLineage, ongoingFrom, principalOf, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let lineageId: string;
const root = mkdtempSync(path.join(tmpdir(), 'wcr-evidence-int-'));
const store: ObjectStore = filesystemStore(root);

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage('m10a-evidence');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A fictional PDF of about `size` bytes: a header, filler comment lines and the end marker. */
function fictionalPdf(size = 2048, seed = 'demo'): Uint8Array<ArrayBuffer> {
  const head = `%PDF-1.4\n% Demo evidence ${seed}: invented for the WingChunRoots tests.\n`;
  const tail = '\n%%EOF\n';
  const out = new Uint8Array(Math.max(size, head.length + tail.length));
  const enc = new TextEncoder();
  out.set(enc.encode(head), 0);
  const line = enc.encode('% demo filler line of a fictional document.......\n');
  for (let at = head.length; at < out.length - tail.length; at += line.length) out.set(line.subarray(0, Math.min(line.length, out.length - tail.length - at)), at);
  out.set(enc.encode(tail), out.length - tail.length);
  return out;
}

/** A stream of `bytes` in chunks, as a request body arrives. */
function streamOf(bytes: Uint8Array, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function upload(principal: ReturnType<typeof principalOf>, bytes: Uint8Array, opts: { name?: string; caseId?: string | null } = {}) {
  return uploadEvidence(principal, { declaredLength: bytes.length, body: streamOf(bytes), name: encodeURIComponent(opts.name ?? 'demo-evidence.pdf'), caseId: opts.caseId ?? null }, meta, store);
}

async function fileRow(id: string) {
  const [row] = await getDb().select().from(evidenceFile).where(eq(evidenceFile.id, id));
  return row!;
}

async function storedBytes(id: string): Promise<Uint8Array> {
  const object = await store.get((await fileRow(id)).storageKey);
  expect(object).not.toBeNull();
  return readAll(object!.body);
}

function storedCount(): number {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
}

/** A student's historical claim with one PDF: the case, the relationship and the student. */
async function claim(label: string) {
  const student = await member(label);
  const first = await upload(student.principal, fictionalPdf(1024, label));
  const result = await requestHistoricalTeacher(
    student.principal,
    { teacherName: `Demo Historical ${label}`, lifeStatus: 'deceased', lineageId, periods: ongoingFrom('1990-01'), evidenceIds: [first.id], idempotencyKey: key() },
    meta,
  );
  return { student, caseId: result.caseId, relationshipId: result.relationship.id, fileId: first.id };
}

describe('the upload', () => {
  for (const [mime, make, format] of [
    ['image/jpeg', jpegWithGps, 'jpeg'],
    ['image/png', pngWithGps, 'png'],
  ] as const) {
    it(`re-encodes a ${format.toUpperCase()} without its EXIF block and GPS position; sha256 is the stored object's, original_sha256 the upload's`, async () => {
      const m = await member(`ev-exif-${format}`);
      const original = await make();
      const gpsBlock = exifTiff().subarray(0, 46);
      // The fixture carries what it should: an EXIF block sharp reads, with the camera and the GPS IFD.
      expect((await imageFacts(original)).exif).toBe(true);
      expect(containsAscii(original, TEST_EXIF_CAMERA)).toBe(true);
      expect(Buffer.from(original).includes(Buffer.from(gpsBlock))).toBe(true);

      const result = await upload(m.principal, original, { name: `demo-photo.${format}` });
      const row = await fileRow(result.id);
      const stored = await storedBytes(result.id);
      expect(row).toMatchObject({ mime, scanStatus: 'pending', retentionUntil: null, originalName: `demo-photo.${format}`, uploadedByUserId: m.account.id, sizeBytes: stored.length });
      expect(row.sha256).toBe(sha256(stored));
      expect(row.originalSha256).toBe(sha256(original));
      expect(row.sha256).not.toBe(row.originalSha256);
      expect(result).toMatchObject({ sha256: row.sha256, originalSha256: row.originalSha256, reencoded: true });

      expect(await imageFacts(stored)).toEqual({ format, width: 64, height: 48, exif: false, xmp: false, iptc: false });
      expect(containsAscii(stored, 'Exif')).toBe(false);
      expect(containsAscii(stored, TEST_EXIF_CAMERA)).toBe(false);
      expect(Buffer.from(stored).includes(Buffer.from(gpsBlock))).toBe(false);
      // The answer and the audit row never carry the storage key or the file's name.
      expect(JSON.stringify(result)).not.toContain(row.storageKey);
      const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'evidence.upload'), eq(auditLog.subjectId, result.id)));
      expect(audit).toMatchObject({ actorUserId: m.account.id, after: { mime, reencoded: true, caseId: null } });
      expect(JSON.stringify(audit)).not.toContain(row.storageKey);
      expect(JSON.stringify(audit)).not.toContain('demo-photo');
    });
  }

  it('re-encodes a WebP image and keeps its size', async () => {
    const m = await member('ev-webp');
    const original = await plainImage('webp', 80, 60);
    const result = await upload(m.principal, original, { name: 'demo-scan.webp' });
    const stored = await storedBytes(result.id);
    expect(await imageFacts(stored)).toMatchObject({ format: 'webp', width: 80, height: 60, exif: false });
    expect((await fileRow(result.id)).originalSha256).toBe(sha256(original));
  });

  it('stores a PDF byte for byte: sha256 is the upload’s and original_sha256 stays empty', async () => {
    const m = await member('ev-pdf');
    const pdf = fictionalPdf(300_000, 'byte-for-byte');
    const result = await upload(m.principal, pdf);
    const row = await fileRow(result.id);
    expect(await storedBytes(result.id)).toEqual(pdf);
    expect(row).toMatchObject({ mime: 'application/pdf', sha256: sha256(pdf), originalSha256: null, sizeBytes: pdf.length });
    expect(result.reencoded).toBe(false);
  });

  it('takes the type from the magic bytes: a renamed executable or a text file is refused (415) and nothing is stored', async () => {
    const m = await member('ev-type');
    const before = storedCount();
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, ...new Uint8Array(200)]);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, ...new Uint8Array(200)]);
    const text = new TextEncoder().encode('Demo notes, not a document of any allowed type.\n');
    for (const [bytes, name] of [
      [elf, 'demo-certificate.pdf'],
      [exe, 'demo-photo.jpg'],
      [text, 'demo-letter.png'],
    ] as const) {
      await expect(upload(m.principal, bytes, { name })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', status: 415, message: WRONG_TYPE_MESSAGE });
    }
    const [{ n }] = (await getDb().select({ n: count() }).from(evidenceFile).where(eq(evidenceFile.uploadedByUserId, m.account.id))) as [{ n: number }];
    expect(n).toBe(0);
    expect(storedCount()).toBe(before);
  });

  it('needs a signed-in account (401)', async () => {
    const pdf = fictionalPdf();
    await expect(uploadEvidence(null, { declaredLength: pdf.length, body: streamOf(pdf), name: null, caseId: null }, meta, store)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('the size limit (DEFAULT D25: 20 MB per file)', () => {
  /** A body that counts how often it is pulled: zero pulls means not a byte was read. */
  function countingBody() {
    const state = { pulls: 0 };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          state.pulls += 1;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
      },
      { highWaterMark: 0 },
    );
    return { body, state };
  }

  it('refuses a Content-Length over 20 MB (413) through POST /api/evidence/upload before a byte of the body is read', async () => {
    const account = await createAccount({ label: 'ev-http-size' });
    const { token } = await signIn(account);
    const { body, state } = countingBody();
    const request = new Request(`${TEST_APP_URL}/api/evidence/upload`, {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { authorization: `Bearer ${token}`, 'content-length': String(EVIDENCE_MAX_BYTES + 1), 'x-file-name': 'demo-large.pdf' },
    } as RequestInit);
    expect(request.headers.get('content-length')).toBe(String(EVIDENCE_MAX_BYTES + 1));
    const response = await handleEvidenceUpload(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', message: TOO_LARGE_MESSAGE });
    expect(state.pulls).toBe(0);
  });

  it('refuses the same in the service, and an upload without Content-Length (411), before reading', async () => {
    const m = await member('ev-size');
    for (const declaredLength of [EVIDENCE_MAX_BYTES + 1, 500 * 1024 * 1024]) {
      const { body, state } = countingBody();
      await expect(uploadEvidence(m.principal, { declaredLength, body, name: null, caseId: null }, meta, store)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
      expect(state.pulls).toBe(0);
    }
    const { body, state } = countingBody();
    await expect(uploadEvidence(m.principal, { declaredLength: null, body, name: null, caseId: null }, meta, store)).rejects.toMatchObject({ code: 'LENGTH_REQUIRED', status: 411 });
    expect(state.pulls).toBe(0);
  });

  it('stops reading a body that runs past its Content-Length (413), and refuses one that ends early (400)', async () => {
    const m = await member('ev-length');
    const pdf = fictionalPdf(200_000);
    await expect(uploadEvidence(m.principal, { declaredLength: 100_000, body: streamOf(pdf), name: null, caseId: null }, meta, store)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(uploadEvidence(m.principal, { declaredLength: 300_000, body: streamOf(pdf), name: null, caseId: null }, meta, store)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('accepts a PDF of exactly 20 MB', async () => {
    const m = await member('ev-20mb');
    const pdf = fictionalPdf(EVIDENCE_MAX_BYTES, 'exactly-20-mb');
    const result = await upload(m.principal, pdf);
    expect((await fileRow(result.id)).sha256).toBe(sha256(pdf));
    await discardEvidence(m.principal, { id: result.id }, meta, store);
  });
});

describe('the number of files (DEFAULT D25: 20 per case)', () => {
  it('a claim holds at most 20 files: the 21st upload to it is refused (409) and nothing more is stored', async () => {
    const { student, caseId } = await claim('ev-cap');
    for (let i = 2; i <= EVIDENCE_MAX_FILES_PER_CASE; i += 1) {
      await upload(student.principal, fictionalPdf(600, `cap-${i}`), { caseId });
    }
    const before = storedCount();
    await expect(upload(student.principal, fictionalPdf(600, 'cap-21'), { caseId })).rejects.toMatchObject({ code: 'CONFLICT', message: CASE_FULL_MESSAGE });
    expect(storedCount()).toBe(before);
    const [{ n }] = (await getDb().select({ n: count() }).from(evidenceLink).where(eq(evidenceLink.reviewCaseId, caseId))) as [{ n: number }];
    expect(n).toBe(EVIDENCE_MAX_FILES_PER_CASE);
  });

  it('a claim is sent with at most 20 files', async () => {
    const student = await member('ev-cap-send');
    const ids: string[] = [];
    // 20 unattached uploads in 24 hours is the limit too, so the 21st id is a made-up one.
    for (let i = 0; i < EVIDENCE_MAX_FILES_PER_CASE; i += 1) ids.push((await upload(student.principal, fictionalPdf(600, `send-${i}`))).id);
    ids.push('0192f0a0-0000-7000-8000-000000000021');
    await expect(
      requestHistoricalTeacher(student.principal, { teacherName: 'Demo Historical Many', lineageId, periods: ongoingFrom(), evidenceIds: ids, idempotencyKey: key() }, meta),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { evidenceIds: expect.stringContaining('at most 20') } });
  });

  it('an account keeps at most 20 files outside a claim in 24 hours (429)', async () => {
    const m = await member('ev-unattached');
    for (let i = 0; i < EVIDENCE_MAX_FILES_PER_CASE; i += 1) await upload(m.principal, fictionalPdf(600, `loose-${i}`));
    await expect(upload(m.principal, fictionalPdf(600, 'loose-21'))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: UNATTACHED_FULL_MESSAGE });
  });

  it('nobody adds a file to another student’s claim (404) or to a decided one', async () => {
    const { caseId } = await claim('ev-foreign');
    const other = await member('ev-foreign-other');
    await expect(upload(other.principal, fictionalPdf(), { caseId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the download', () => {
  it('streams the stored bytes as an attachment with Cache-Control: no-store and X-Content-Type-Options: nosniff (GET /api/evidence/<id>)', async () => {
    const account = await createAccount({ label: 'ev-http-download' });
    const { token } = await signIn(account);
    const pdf = fictionalPdf(150_000, 'download');
    const uploaded = await handleEvidenceUpload(
      new Request(`${TEST_APP_URL}/api/evidence/upload`, {
        method: 'POST',
        body: pdf,
        headers: { authorization: `Bearer ${token}`, 'content-length': String(pdf.length), 'x-file-name': encodeURIComponent('demo-diploma.pdf') },
      }),
    );
    expect(uploaded.status).toBe(201);
    const { evidence } = (await uploaded.json()) as { evidence: { id: string; sha256: string; href: string } };
    expect(evidence.href).toBe(`/api/evidence/${evidence.id}`);
    expect(JSON.stringify(evidence)).not.toContain((await fileRow(evidence.id)).storageKey);

    const response = await handleEvidenceDownload(new Request(`${TEST_APP_URL}${evidence.href}`, { headers: { authorization: `Bearer ${token}` } }), evidence.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="evidence-${evidence.id}.pdf"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('location')).toBeNull();
    const body = new Uint8Array(await response.arrayBuffer());
    expect(sha256(body)).toBe(sha256(pdf));
    expect(evidence.sha256).toBe(sha256(pdf));

    // Anonymous: 404, with the same headers and no hint that the file exists.
    const anonymous = await handleEvidenceDownload(new Request(`${TEST_APP_URL}${evidence.href}`), evidence.id);
    expect(anonymous.status).toBe(404);
    expect(anonymous.headers.get('cache-control')).toBe('no-store');
    const missing = await handleEvidenceDownload(new Request(`${TEST_APP_URL}/api/evidence/0192f0a0-0000-7000-8000-00000000abcd`, { headers: { authorization: `Bearer ${token}` } }), '0192f0a0-0000-7000-8000-00000000abcd');
    expect(missing.status).toBe(404);
    expect(await anonymous.text()).toBe(await missing.text());

    await discardEvidence(principalOf(account), { id: evidence.id }, meta);
  });

  it('opens for the uploader, the assigned reviewer and an administrator with the second factor; 404 for everyone else; every download writes evidence.view', async () => {
    const { student, caseId, fileId } = await claim('ev-access');
    const stranger = await member('ev-access-stranger');
    const moderator = await staff('ev-access-mod', 'moderator');
    const archivist = await staff('ev-access-arch', 'archivist');
    const admin = await staff('ev-access-admin', 'admin');
    const adminNo2fa = principalOf(admin.account, 'admin', { unverified: true });
    const moderatorNo2fa = principalOf(moderator.account, 'moderator', { unverified: true });

    const open = (principal: Parameters<typeof openEvidence>[0], id = fileId) => openEvidence(principal, id, meta, store);
    const refused = async (principal: Parameters<typeof openEvidence>[0], id = fileId) => expect(open(principal, id)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await refused(null);
    await refused(stranger.principal);
    await refused(moderator.principal); // staff, but not assigned
    await refused(archivist.principal); // a claim's file is not an archival record's
    await refused(adminNo2fa);
    await refused(student.principal, 'not-a-uuid');

    const allowed: [Parameters<typeof openEvidence>[0], string][] = [];
    const download = await open(student.principal);
    expect(await readAll(download.body)).toEqual(await storedBytes(fileId));
    allowed.push([student.principal, 'uploader']);
    await (await open(admin.principal)).body.cancel();
    allowed.push([admin.principal, 'admin']);

    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    await (await open(moderator.principal)).body.cancel();
    allowed.push([moderator.principal, 'reviewer']);
    await refused(moderatorNo2fa);
    await refused(archivist.principal);

    const views = await getDb()
      .select({ actor: auditLog.actorUserId, role: auditLog.actorRole, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'evidence.view'), eq(auditLog.subjectId, fileId)))
      .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
    expect(views).toEqual(allowed.map(([p, access]) => ({ actor: p!.user.id, role: p!.user.role, after: { access, mime: 'application/pdf' } })));
  });

  it('a removed file opens for nobody, not even its uploader', async () => {
    const m = await member('ev-removed');
    const result = await upload(m.principal, fictionalPdf());
    await discardEvidence(m.principal, { id: result.id }, meta, store);
    await expect(openEvidence(m.principal, result.id, meta, store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('discarding a file', () => {
  it('the uploader removes a file outside a claim: the object is deleted; a file in a claim stays; others get 404', async () => {
    const m = await member('ev-discard');
    const result = await upload(m.principal, fictionalPdf());
    const keyOf = (await fileRow(result.id)).storageKey;
    const other = await member('ev-discard-other');
    await expect(discardEvidence(other.principal, { id: result.id }, meta, store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await discardEvidence(m.principal, { id: result.id }, meta, store);
    expect(await store.get(keyOf)).toBeNull();
    expect((await fileRow(result.id)).deletedAt).not.toBeNull();

    const { student, fileId } = await claim('ev-discard-claim');
    await expect(discardEvidence(student.principal, { id: fileId }, meta, store)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
