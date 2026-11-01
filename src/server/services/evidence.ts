// Evidence files (milestone M10a, In scope 2 and 3; plan §6.4). A file is uploaded on its own, one
// per request, through POST /api/evidence/upload (src/server/evidence-http.ts) and lands either
// unattached (it is linked to a historical claim when the claim is sent, historical.ts) or straight
// in an open case of the uploader's (`caseId`: more evidence after "needs information").
//
// The upload, in this order:
//   1. a signed-in account (401 otherwise);
//   2. Content-Length is required (411) and at most 20 MB (413), checked BEFORE the body is read
//      (DEFAULT D25: 20 MB per file); an empty file is refused (400);
//   3. room for one more file: at most 20 per case (DEFAULT D25; in a relationship dispute 20 per
//      party, so one side never fills the case for the other, M10b review, security-2), and at most
//      20 unattached files uploaded in 24 hours by one account (the files of one claim being prepared);
//   4. the body, read up to the declared length and never past 20 MB;
//   5. the type from the magic bytes (JPEG, PNG, WebP, PDF; 415 otherwise), never the name or the
//      client's Content-Type (../storage/sanitize.ts);
//   6. images re-encoded with sharp, which drops EXIF with its GPS position and every other
//      metadata block: `sha256` is the hash of the stored object, `original_sha256` the hash of the
//      uploaded original; a PDF is stored byte for byte (original_sha256 empty);
//   7. a random storage key (../storage), the object in the private bucket or folder, then the
//      evidence_file row (and the link to the case) and the audit row `evidence.upload` in one
//      transaction, which checks the room again under a lock. If the transaction fails, the object
//      is removed again.
//
// The download (GET /api/evidence/<id>) streams the object through the app after the check, to
// exactly the people of the milestone's In scope 3: the uploader, the teacher a linked request is
// about (their own request), the reviewers assigned to a linked case and the administrators (both
// with a session that proved the second factor). Every download writes `evidence.view`. Anyone
// else, signed in or not, an archivist who is not assigned included, gets 404, the same answer as
// for a file that does not exist (plan §5.6, §6.4). No presigned GET exists (plan §6.4). The pages
// show a file's link and its uploaded name only to the same people (openableFiles).
//
// The archival edit links only files the archivist uploaded for it, never a file of a claim: a link
// to a record opens a file to nobody new (M10a review, security-1).
//
// `scan_status` starts as `pending`; an antivirus check is optional and later. `retention_until`
// stays empty: no evidence is deleted automatically until the owner sets a retention policy (the
// milestone's stop-and-ask, docs/plan/questions/M10a.md).
//
// Logs and audit rows carry ids, types and sizes, never a file name, a storage key or a person's
// name (CLAUDE.md §6).

import { createHash } from 'node:crypto';

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { evidenceFile, evidenceLink, notification, reviewCase, reviewEvent } from '../db/schema';
import { EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES_PER_CASE, EVIDENCE_NAME_MAX, OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import { getEvidenceStore, newStorageKey, type ObjectStore } from '../storage';
import { type EvidenceMime, EXTENSION, ImageRefused, isImage, MAX_IMAGE_PIXELS, reencodeImage, sniffMime } from '../storage/sanitize';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

/** The int4 namespace of the per-account upload lock: pg_advisory_xact_lock(EVIDENCE_LOCK_SPACE, hashtext(user)). */
const EVIDENCE_LOCK_SPACE = 10;
/** Unattached files of one account counted against the limit: those uploaded in this many hours. */
export const UNATTACHED_WINDOW_HOURS = 24;
export const EVIDENCE_MAX_MB = EVIDENCE_MAX_BYTES / (1024 * 1024);

export const TOO_LARGE_MESSAGE = `This file is larger than ${EVIDENCE_MAX_MB} MB. Upload a smaller copy, or split the document.`;
export const WRONG_TYPE_MESSAGE = 'The contents of this file are not a JPEG, PNG or WebP image or a PDF, whatever its name.';
export const CASE_FULL_MESSAGE = `This claim already holds ${EVIDENCE_MAX_FILES_PER_CASE} files, the most a claim can have, so no more can be added to it.`;
/** A party's own files in a dispute; never a word about the other party's (DEFAULT D19). */
export const PARTY_FULL_MESSAGE = `You have added ${EVIDENCE_MAX_FILES_PER_CASE} files to this case, the most each party can add, so you cannot add more.`;
export const UNATTACHED_FULL_MESSAGE = `You have uploaded ${EVIDENCE_MAX_FILES_PER_CASE} files today that are not part of a claim yet. Send the claim, or remove some of them, before you upload more.`;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// --- Views -------------------------------------------------------------------------------------

export interface EvidenceFileView {
  id: string;
  mime: EvidenceMime;
  /** "PDF", "JPEG image", ... */
  kindLabel: string;
  sizeBytes: number;
  /**
   * The uploaded file's own name, cleaned; null when it had none or when this viewer may not open
   * the file (the name can be personal data: it is shown only to those who may download the file).
   */
  name: string | null;
  createdAt: string;
  /**
   * The app's own download address, /api/evidence/<id>, when this viewer may open the file; null
   * otherwise. Never an address of the store (plan §6.4).
   */
  href: string | null;
}

export interface UploadedEvidence extends EvidenceFileView {
  sha256: string;
  /** The hash of the uploaded original when the image was re-encoded; null for a PDF. */
  originalSha256: string | null;
  reencoded: boolean;
  caseId: string | null;
}

const KIND_LABELS: Record<EvidenceMime, string> = {
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/webp': 'WebP image',
  'application/pdf': 'PDF',
};

export const evidenceHref = (id: string) => `/api/evidence/${id}`;

interface FileRow {
  id: string;
  mime: EvidenceMime;
  sizeBytes: number;
  originalName: string | null;
  createdAt: Date;
  uploadedByUserId: string | null;
}

/** A file as `canOpen` (accessOf, openableFiles) lets this viewer see it: the link and the name or neither. */
export function fileView(row: FileRow, canOpen: boolean): EvidenceFileView {
  return {
    id: row.id,
    mime: row.mime,
    kindLabel: KIND_LABELS[row.mime],
    sizeBytes: row.sizeBytes,
    name: canOpen ? row.originalName : null,
    createdAt: row.createdAt.toISOString(),
    href: canOpen ? evidenceHref(row.id) : null,
  };
}

const fileColumns = {
  id: evidenceFile.id,
  mime: evidenceFile.mime,
  sizeBytes: evidenceFile.sizeBytes,
  originalName: evidenceFile.originalName,
  createdAt: evidenceFile.createdAt,
  uploadedByUserId: evidenceFile.uploadedByUserId,
};

/** The files linked to each case (not removed), oldest first. The caller decides who may open which. */
export async function filesOfCases(db: Executor, caseIds: string[]): Promise<Map<string, FileRow[]>> {
  const out = new Map<string, FileRow[]>();
  if (caseIds.length === 0) return out;
  const rows = await db
    .select({ ...fileColumns, caseId: evidenceLink.reviewCaseId })
    .from(evidenceLink)
    .innerJoin(evidenceFile, and(eq(evidenceFile.id, evidenceLink.evidenceFileId), isNull(evidenceFile.deletedAt)))
    .where(inArray(evidenceLink.reviewCaseId, caseIds))
    .orderBy(asc(evidenceFile.createdAt), asc(evidenceFile.id));
  for (const { caseId, ...row } of rows) {
    if (!caseId) continue;
    const list = out.get(caseId) ?? [];
    list.push(row);
    out.set(caseId, list);
  }
  return out;
}

/**
 * M10b: the files linked straight to each relationship (the evidence a student sent with an
 * invitation), not through a case; not removed, oldest first. The caller decides who may open
 * which (accessOfFiles: the uploader, an administrator, and the teacher once the record is theirs).
 */
export async function filesOfRelationships(db: Executor, relationshipIds: string[]): Promise<Map<string, FileRow[]>> {
  const out = new Map<string, FileRow[]>();
  if (relationshipIds.length === 0) return out;
  const rows = await db
    .select({ ...fileColumns, relationshipId: evidenceLink.relationshipId })
    .from(evidenceLink)
    .innerJoin(evidenceFile, and(eq(evidenceFile.id, evidenceLink.evidenceFileId), isNull(evidenceFile.deletedAt)))
    .where(inArray(evidenceLink.relationshipId, relationshipIds))
    .orderBy(asc(evidenceFile.createdAt), asc(evidenceFile.id));
  for (const { relationshipId, ...row } of rows) {
    if (!relationshipId) continue;
    const list = out.get(relationshipId) ?? [];
    list.push(row);
    out.set(relationshipId, list);
  }
  return out;
}

/** The files linked straight to a person (archival edits), not removed, oldest first. */
export async function filesOfPerson(db: Executor, personId: string): Promise<FileRow[]> {
  return db
    .select(fileColumns)
    .from(evidenceLink)
    .innerJoin(evidenceFile, and(eq(evidenceFile.id, evidenceLink.evidenceFileId), isNull(evidenceFile.deletedAt)))
    .where(eq(evidenceLink.personId, personId))
    .orderBy(asc(evidenceFile.createdAt), asc(evidenceFile.id));
}

// --- Names -------------------------------------------------------------------------------------

/**
 * The name to keep of an uploaded file: the last part of a path, Unicode NFC, without control or
 * format characters, at most EVIDENCE_NAME_MAX characters; null when nothing is left. The client
 * sends it URI-encoded in X-File-Name (a header carries only Latin-1).
 */
export function cleanFileName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    value = raw;
  }
  const base = value.split(/[\\/]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!clean || clean === '.' || clean === '..') return null;
  return [...clean].slice(0, EVIDENCE_NAME_MAX).join('');
}

// --- Upload ------------------------------------------------------------------------------------

export interface UploadInput {
  /** The request's Content-Length, or null when it had none. */
  declaredLength: number | null;
  body: ReadableStream<Uint8Array> | null;
  /** X-File-Name, URI-encoded. */
  name: string | null;
  /** An open case of the uploader's to add the file to, or null for an unattached file. */
  caseId: string | null;
}

/**
 * The body, read to the end: refused when it grows past the declared length or 20 MB (413), or
 * ends before the declared length (400). The reader is cancelled on refusal.
 */
export async function readBody(body: ReadableStream<Uint8Array>, declared: number): Promise<Uint8Array> {
  const limit = Math.min(declared, EVIDENCE_MAX_BYTES);
  const out = new Uint8Array(limit);
  let offset = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ServiceError('PAYLOAD_TOO_LARGE', offset + value.byteLength > EVIDENCE_MAX_BYTES ? TOO_LARGE_MESSAGE : 'The upload was longer than its Content-Length.');
      }
      out.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== declared) throw new ServiceError('BAD_REQUEST', 'The upload ended before the whole file arrived. Try again.');
  return out;
}

interface OpenCase {
  id: string;
  kind: string;
  status: (typeof OPEN_REVIEW_CASE_STATUSES)[number];
  assignedToUserId: string | null;
}

/** The kinds whose claimant (the account that opened the case) adds files to it. */
const CLAIMANT_KINDS: readonly string[] = ['historical_claim', 'person_claim', 'instructor_verification'];

/**
 * An open case the uploader may add files to, or 404 (the same answer as for no such case): their
 * own historical claim, profile claim or instructor verification (M10b), or a relationship dispute
 * whose relationship is theirs, as its student or its teacher (M10b: both parties of an arbitration
 * send evidence, DEFAULT D19).
 */
async function ownOpenCase(db: Executor, userId: string, caseId: string, lock = false): Promise<OpenCase> {
  if (!z.uuid().safeParse(caseId).success) throw new ServiceError('NOT_FOUND', 'No such claim.');
  const query = db
    .select({
      id: reviewCase.id,
      status: reviewCase.status,
      openedBy: reviewCase.openedByUserId,
      kind: reviewCase.kind,
      assignedToUserId: reviewCase.assignedToUserId,
      party: sql<boolean>`EXISTS (SELECT 1 FROM teaching_relationship r JOIN person x ON x.id IN (r.teacher_person_id, r.student_person_id) AND x.deleted_at IS NULL
                WHERE r.id = review_case.relationship_id AND x.claimed_by_user_id = ${userId}::uuid)`,
    })
    .from(reviewCase)
    .where(eq(reviewCase.id, caseId));
  const [row] = lock ? await query.for('update', { of: reviewCase }) : await query;
  const allowed = row && ((CLAIMANT_KINDS.includes(row.kind) && row.openedBy === userId) || (row.kind === 'relationship_dispute' && row.party));
  if (!row || !allowed) throw new ServiceError('NOT_FOUND', 'No such claim.');
  if (!(OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(row.status)) {
    throw new ServiceError('CONFLICT', 'This claim has been decided: no more files can be added to it.');
  }
  return { id: row.id, kind: row.kind, status: row.status as OpenCase['status'], assignedToUserId: row.assignedToUserId };
}

/** The files in a case, or only those `uploadedBy` sent to it. */
async function filesInCase(db: Executor, caseId: string, uploadedBy?: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(evidenceLink)
    .innerJoin(evidenceFile, and(eq(evidenceFile.id, evidenceLink.evidenceFileId), isNull(evidenceFile.deletedAt)))
    .where(and(eq(evidenceLink.reviewCaseId, caseId), uploadedBy ? eq(evidenceFile.uploadedByUserId, uploadedBy) : undefined));
  return row?.n ?? 0;
}

/**
 * Whether `userId` may add one more file to the open case. DEFAULT D25: at most 20 files in a case;
 * in a relationship dispute each party has 20 of its own (M10b review, security-2), counted
 * without the other party's files, which the party never learns about (DEFAULT D19).
 */
export async function caseHasRoom(db: Executor, c: { id: string; kind: string }, userId: string): Promise<boolean> {
  const n = await filesInCase(db, c.id, c.kind === 'relationship_dispute' ? userId : undefined);
  return n < EVIDENCE_MAX_FILES_PER_CASE;
}

/** The account's files that are in no claim yet, uploaded in the last UNATTACHED_WINDOW_HOURS. */
async function recentUnattached(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(evidenceFile)
    .where(
      and(
        eq(evidenceFile.uploadedByUserId, userId),
        isNull(evidenceFile.deletedAt),
        gt(evidenceFile.createdAt, sql`now() - make_interval(hours => ${UNATTACHED_WINDOW_HOURS}::int)`),
        sql`NOT EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_file_id = ${evidenceFile.id})`,
      ),
    );
  return row?.n ?? 0;
}

async function checkRoom(db: Executor, userId: string, caseId: string | null, lock = false): Promise<OpenCase | null> {
  if (caseId) {
    const open = await ownOpenCase(db, userId, caseId, lock);
    if (!(await caseHasRoom(db, open, userId))) throw new ServiceError('CONFLICT', open.kind === 'relationship_dispute' ? PARTY_FULL_MESSAGE : CASE_FULL_MESSAGE);
    return open;
  }
  if ((await recentUnattached(db, userId)) >= EVIDENCE_MAX_FILES_PER_CASE) throw new ServiceError('TOO_MANY_REQUESTS', UNATTACHED_FULL_MESSAGE);
  return null;
}

/** What is stored of an upload: the bytes, their type and both hashes. */
async function prepare(bytes: Uint8Array): Promise<{ mime: EvidenceMime; stored: Uint8Array; sha256: string; originalSha256: string | null }> {
  const mime = sniffMime(bytes);
  if (!mime) throw new ServiceError('UNSUPPORTED_MEDIA_TYPE', WRONG_TYPE_MESSAGE);
  if (!isImage(mime)) return { mime, stored: bytes, sha256: sha256(bytes), originalSha256: null };
  let stored: Uint8Array;
  try {
    stored = await reencodeImage(bytes, mime as Exclude<EvidenceMime, 'application/pdf'>);
  } catch (error) {
    if (error instanceof ImageRefused) {
      throw new ServiceError(
        'UNSUPPORTED_MEDIA_TYPE',
        error.reason === 'too_large'
          ? `This image is larger than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels. Save a smaller copy and upload that.`
          : 'This image could not be read. Save it again as JPEG, PNG or WebP, or upload a PDF.',
      );
    }
    throw error;
  }
  if (stored.byteLength > EVIDENCE_MAX_BYTES) throw new ServiceError('PAYLOAD_TOO_LARGE', TOO_LARGE_MESSAGE);
  return { mime, stored, sha256: sha256(stored), originalSha256: sha256(bytes) };
}

/**
 * Uploads one evidence file (see the top of this file for the order of the checks). Returns the
 * file's view with both hashes; never its storage key.
 */
export async function uploadEvidence(principal: Principal | null, input: UploadInput, meta: RequestMeta, store: ObjectStore = getEvidenceStore()): Promise<UploadedEvidence> {
  const p = requireUser(principal);
  // 2. The declared size, before a byte of the body is read (DEFAULT D25: 20 MB per file).
  if (input.declaredLength === null || !Number.isSafeInteger(input.declaredLength) || input.declaredLength < 0) {
    throw new ServiceError('LENGTH_REQUIRED', 'Send the file with its size (Content-Length).');
  }
  if (input.declaredLength > EVIDENCE_MAX_BYTES) throw new ServiceError('PAYLOAD_TOO_LARGE', TOO_LARGE_MESSAGE);
  if (input.declaredLength === 0 || !input.body) throw new ServiceError('BAD_REQUEST', 'This file is empty.');
  const db = getDb();
  // 3. Room for one more file, before the body is read (checked again under the lock below).
  await checkRoom(db, p.user.id, input.caseId);
  // 4. The body; 5-6. its type and what is stored of it.
  const bytes = await readBody(input.body, input.declaredLength);
  const prepared = await prepare(bytes);
  const name = cleanFileName(input.name);
  // 7. The object first, under a random key; then the row, or the object is removed again.
  const key = newStorageKey();
  await store.put(key, prepared.stored, { contentType: prepared.mime, sha256: prepared.sha256 });
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${EVIDENCE_LOCK_SPACE}::int, hashtext(${p.user.id}::text))`);
      const open = await checkRoom(tx, p.user.id, input.caseId, true);
      const id = uuidv7();
      const [inserted] = await tx
        .insert(evidenceFile)
        .values({
          id,
          storageKey: key,
          sha256: prepared.sha256,
          originalSha256: prepared.originalSha256,
          mime: prepared.mime,
          sizeBytes: prepared.stored.byteLength,
          originalName: name,
          // scan_status starts as pending (the antivirus check is optional and later); no
          // retention_until until the owner sets a policy (docs/plan/questions/M10a.md).
          scanStatus: 'pending',
          uploadedByUserId: p.user.id,
        })
        .returning(fileColumns);
      if (open) await attachToOpenCase(tx, open, id, p);
      await writeAudit(tx, {
        action: 'evidence.upload',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'evidence_file',
        subjectId: id,
        after: { mime: prepared.mime, sizeBytes: prepared.stored.byteLength, reencoded: prepared.originalSha256 !== null, caseId: open?.id ?? null },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return inserted!;
    });
    return {
      ...fileView(row, true),
      sha256: prepared.sha256,
      originalSha256: prepared.originalSha256,
      reencoded: prepared.originalSha256 !== null,
      caseId: input.caseId,
    };
  } catch (error) {
    await store.delete(key).catch(() => undefined);
    throw error;
  }
}

/**
 * Links a new file to the uploader's open case. A case waiting for more information goes back to
 * the reviewers (in review when someone has it, open otherwise), and its reviewer is told.
 */
async function attachToOpenCase(tx: Transaction, open: OpenCase, fileId: string, principal: Principal): Promise<void> {
  const userId = principal.user.id;
  await tx.insert(evidenceLink).values({ evidenceFileId: fileId, reviewCaseId: open.id, createdByUserId: userId, note: 'added by the claimant' });
  const status = open.status === 'needs_info' ? (open.assignedToUserId ? 'in_review' : 'open') : open.status;
  if (open.status === 'needs_info') {
    await tx.update(reviewCase).set({ status, updatedAt: new Date() }).where(eq(reviewCase.id, open.id));
  }
  // M10b: the case's own history (review-core.ts) records the evidence a party added; a historical
  // claim keeps its history in relationship_event (M10a).
  if (open.kind !== 'historical_claim') {
    await tx.insert(reviewEvent).values({ reviewCaseId: open.id, action: 'evidence', fromStatus: open.status, toStatus: status, actorUserId: userId, actorRole: principal.user.role });
  }
  if (open.assignedToUserId) {
    await tx.insert(notification).values({ userId: open.assignedToUserId, template: 'review.updated', payload: { caseId: open.id, change: 'evidence' } });
  }
}

/**
 * Links the claimant's unattached files to a new case (historical.ts), in the claim's transaction.
 * Every file must be the account's own, not removed and in no other case; at most 20 (DEFAULT D25).
 * Returns the field error of `evidenceIds`, or null once they are linked.
 */
export async function linkFilesToCase(tx: Transaction, userId: string, caseId: string, fileIds: readonly string[]): Promise<string | null> {
  return linkFiles(tx, userId, { reviewCaseId: caseId, note: 'sent with the claim' }, fileIds, true);
}

/**
 * M10b: links the student's unattached files to the relationship of an invitation (invitations.ts),
 * in its transaction; none is required. The same rules as linkFilesToCase. Such a file opens for
 * the uploader, the administrators and the relationship's teacher (accessOfFiles), so for an
 * invited teacher only once their profile claim is approved and the record is theirs: never for
 * the invitee before that (the milestone's constraint).
 */
export async function linkFilesToRelationship(tx: Transaction, userId: string, relationshipId: string, fileIds: readonly string[]): Promise<string | null> {
  if (fileIds.length === 0) return null;
  return linkFiles(tx, userId, { relationshipId, note: 'sent with the invitation' }, fileIds, false);
}

async function linkFiles(
  tx: Transaction,
  userId: string,
  target: { reviewCaseId: string; note: string } | { relationshipId: string; note: string },
  fileIds: readonly string[],
  required: boolean,
): Promise<string | null> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return required ? 'Attach at least one file of evidence.' : null;
  if (ids.length > EVIDENCE_MAX_FILES_PER_CASE) return `Attach at most ${EVIDENCE_MAX_FILES_PER_CASE} files to one claim.`;
  const unavailable = 'Some of these files are no longer available. Remove them from the list and upload them again.';
  const rows = await tx
    .select({ id: evidenceFile.id })
    .from(evidenceFile)
    .where(and(inArray(evidenceFile.id, ids), eq(evidenceFile.uploadedByUserId, userId), isNull(evidenceFile.deletedAt)))
    .for('update', { of: evidenceFile });
  if (rows.length !== ids.length) return unavailable;
  // None may be linked anywhere yet: checked after the row locks, in a statement of its own (a fresh
  // snapshot). It was an EXISTS in the select list, whose unqualified "id" (Drizzle renders a
  // column of a one-table select without its table) named the link's own id: always false, so a
  // file already in one claim could be sent with another.
  const [linked] = await tx.select({ id: evidenceLink.id }).from(evidenceLink).where(inArray(evidenceLink.evidenceFileId, ids)).limit(1);
  if (linked) return unavailable;
  await tx.insert(evidenceLink).values(ids.map((id) => ({ evidenceFileId: id, ...target, createdByUserId: userId })));
  return null;
}

export const ARCHIVAL_EVIDENCE_MESSAGE = 'Link only files you uploaded for this edit.';
export const CLAIM_EVIDENCE_MESSAGE = 'A file sent with a claim stays with that claim. Upload the document again for this record.';

/**
 * Links files to a person for an archival edit (review.ts): each must be one this archivist
 * uploaded, not removed, and part of no claim (no case and no relationship link). A file the
 * archivist can open only as the reviewer of a case, or as an administrator, is refused: linking
 * it to a record would widen who reads it (M10a review, security-1). Files already linked to the
 * person are left as they are. Returns the field error of `evidenceIds`, or null.
 */
export async function linkFilesToPerson(tx: Transaction, principal: Principal, personId: string, fileIds: readonly string[]): Promise<string | null> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return null;
  if (ids.length > EVIDENCE_MAX_FILES_PER_CASE) return `Link at most ${EVIDENCE_MAX_FILES_PER_CASE} files to one edit.`;
  const own = await tx
    .select({ id: evidenceFile.id })
    .from(evidenceFile)
    .where(and(inArray(evidenceFile.id, ids), eq(evidenceFile.uploadedByUserId, principal.user.id), isNull(evidenceFile.deletedAt)))
    .for('update');
  if (own.length !== ids.length) return ARCHIVAL_EVIDENCE_MESSAGE;
  // After the row locks, in a statement of its own (a fresh snapshot), so a claim sent with one of
  // these files a moment ago is seen.
  const [claimed] = await tx
    .select({ id: evidenceLink.id })
    .from(evidenceLink)
    .where(and(inArray(evidenceLink.evidenceFileId, ids), or(isNotNull(evidenceLink.reviewCaseId), isNotNull(evidenceLink.relationshipId))))
    .limit(1);
  if (claimed) return CLAIM_EVIDENCE_MESSAGE;
  const existing = await tx
    .select({ id: evidenceLink.evidenceFileId })
    .from(evidenceLink)
    .where(and(eq(evidenceLink.personId, personId), inArray(evidenceLink.evidenceFileId, ids)));
  const known = new Set(existing.map((e) => e.id));
  const fresh = ids.filter((id) => !known.has(id));
  if (fresh.length > 0) {
    await tx.insert(evidenceLink).values(fresh.map((id) => ({ evidenceFileId: id, personId, createdByUserId: principal.user.id, note: 'archival edit' })));
  }
  return null;
}

// --- Download ----------------------------------------------------------------------------------

export type EvidenceAccess = 'uploader' | 'teacher' | 'reviewer' | 'admin';

/**
 * How `principal` may open each of the files, by id; a file they may not open, a removed one or
 * one that does not exist is absent (see the top of this file). One query for a page of files.
 */
export async function accessOfFiles(db: Executor, principal: Principal, fileIds: readonly string[]): Promise<Map<string, EvidenceAccess>> {
  const out = new Map<string, EvidenceAccess>();
  const ids = [...new Set(fileIds)].filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return out;
  const userId = principal.user.id;
  const rows = await db
    .select({
      id: evidenceFile.id,
      uploader: sql<boolean>`evidence_file.uploaded_by_user_id IS NOT DISTINCT FROM ${userId}::uuid`,
      assigned: sql<boolean>`EXISTS (SELECT 1 FROM evidence_link l JOIN review_case c ON c.id = l.review_case_id
                WHERE l.evidence_file_id = evidence_file.id AND c.assigned_to_user_id = ${userId}::uuid)`,
      // M10b: never through a relationship dispute, where each party's files stay their own
      // (DEFAULT D19), nor through a profile claim (the claimant's own files about themselves).
      teacher: sql<boolean>`EXISTS (SELECT 1 FROM evidence_link l
                 LEFT JOIN review_case c ON c.id = l.review_case_id
                 JOIN teaching_relationship r ON r.id = COALESCE(l.relationship_id, c.relationship_id)
                 JOIN person t ON t.id = r.teacher_person_id AND t.deleted_at IS NULL
                WHERE l.evidence_file_id = evidence_file.id AND t.claimed_by_user_id = ${userId}::uuid
                  AND (c.id IS NULL OR c.kind = 'historical_claim'))`,
    })
    .from(evidenceFile)
    .where(and(inArray(evidenceFile.id, ids), isNull(evidenceFile.deletedAt)));
  const admin = hasStaff2FA(principal, ['admin']);
  const reviewer = hasStaff2FA(principal);
  for (const row of rows) {
    const access: EvidenceAccess | null = row.uploader ? 'uploader' : admin ? 'admin' : row.assigned && reviewer ? 'reviewer' : row.teacher ? 'teacher' : null;
    if (access) out.set(row.id, access);
  }
  return out;
}

/** How `principal` may open the file, or null when they may not (accessOfFiles). */
export async function accessOf(db: Executor, principal: Principal, fileId: string): Promise<EvidenceAccess | null> {
  return (await accessOfFiles(db, principal, [fileId])).get(fileId) ?? null;
}

/** The ids of the files this viewer may open: the pages link and name exactly these (the download's rule). */
export async function openableFiles(db: Executor, principal: Principal, fileIds: readonly string[]): Promise<Set<string>> {
  return new Set((await accessOfFiles(db, principal, fileIds)).keys());
}

export interface EvidenceDownload {
  id: string;
  mime: EvidenceMime;
  size: number;
  /** The download's file name: evidence-<id>.<ext> (the uploaded name stays in the app's pages). */
  fileName: string;
  body: ReadableStream<Uint8Array>;
}

const notFound = () => new ServiceError('NOT_FOUND', 'No such file.');

/**
 * Opens an evidence file for `principal` (In scope 3): 404 for anyone not allowed, anonymous
 * included, and for a file that does not exist. Writes `evidence.view` before the bytes are sent.
 */
export async function openEvidence(principal: Principal | null, fileId: string, meta: RequestMeta, store: ObjectStore = getEvidenceStore()): Promise<EvidenceDownload> {
  if (!principal) throw notFound();
  const db = getDb();
  const access = await accessOf(db, principal, fileId);
  if (!access) throw notFound();
  const [row] = await db
    .select({ id: evidenceFile.id, mime: evidenceFile.mime, storageKey: evidenceFile.storageKey })
    .from(evidenceFile)
    .where(and(eq(evidenceFile.id, fileId), isNull(evidenceFile.deletedAt)));
  if (!row) throw notFound();
  const object = await store.get(row.storageKey);
  if (!object) {
    // The row is there but its object is not: the store lost it. Logged by id only.
    console.error(`[evidence] the stored object of evidence file ${row.id} is missing`);
    throw notFound();
  }
  try {
    await writeAudit(db, {
      action: 'evidence.view',
      actorUserId: principal.user.id,
      actorRole: principal.user.role,
      subjectType: 'evidence_file',
      subjectId: row.id,
      after: { access, mime: row.mime },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
  } catch (error) {
    await object.body.cancel().catch(() => undefined);
    throw error;
  }
  const mime = row.mime as EvidenceMime;
  return { id: row.id, mime, size: object.size, fileName: `evidence-${row.id}.${EXTENSION[mime]}`, body: object.body };
}

// --- Discard -----------------------------------------------------------------------------------

export const discardInput = z.object({ id: z.uuid({ error: 'No such file.' }) });

/**
 * evidence.discard: the uploader removes a file that is in no claim yet (a wrong file picked before
 * the claim was sent). The object is deleted from the store and the row marked removed. A file in a
 * claim stays: it is part of the record the reviewers decide on.
 */
export async function discardEvidence(principal: Principal | null, raw: z.input<typeof discardInput>, meta: RequestMeta, store: ObjectStore = getEvidenceStore()): Promise<{ id: string; discarded: true }> {
  const p = requireUser(principal);
  const parsed = discardInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  const key = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: evidenceFile.id, storageKey: evidenceFile.storageKey, uploadedBy: evidenceFile.uploadedByUserId, deletedAt: evidenceFile.deletedAt })
      .from(evidenceFile)
      .where(eq(evidenceFile.id, parsed.data.id))
      .for('update');
    if (!row || row.uploadedBy !== p.user.id) throw notFound();
    if (row.deletedAt) return null;
    const [link] = await tx.select({ id: evidenceLink.id }).from(evidenceLink).where(eq(evidenceLink.evidenceFileId, row.id)).limit(1);
    if (link) throw new ServiceError('CONFLICT', 'This file is part of a claim and stays with it.');
    await tx.update(evidenceFile).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(evidenceFile.id, row.id));
    await writeAudit(tx, {
      action: 'evidence.discard',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'evidence_file',
      subjectId: row.id,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return row.storageKey;
  });
  if (key) {
    await store.delete(key).catch(() => {
      console.error(`[evidence] the stored object of discarded evidence file ${parsed.data.id} could not be removed`);
    });
  }
  return { id: parsed.data.id, discarded: true };
}
