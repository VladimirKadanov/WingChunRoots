// The federation bulk import (milestone M24; specification §9, §9.1; execution plan, Phase 3;
// docs/adr/0027-organization-tools.md). An admin of an approved organization with the Federation
// plan uploads a CSV file of the template; the preview checks every row and says what is wrong
// with each; the commit creates the valid rows inside the organization.
//
//   organizationTools.importPreview   parse and check a file (base64 of its bytes); store the preview
//   organizationTools.imports         the organization's imports, newest first
//   organizationTools.importGet       one import with its rows (the parsed fields while it is open)
//   organizationTools.importCommit    create the valid rows (person records, memberships, claims)
//   organizationTools.importDiscard   end a preview without importing anything
//
// What a commit creates for a valid row, and never more (Phase 3 completion condition: "imports
// cannot silently authenticate a person or bypass teacher approval"):
// - a person record: living, stewardship 'unclaimed', visibility 'involved_only' (DEFAULT D03), no
//   account. It is never matched or merged onto an existing person or account
//   (DEFAULT M24 question 5): a row whose name equals a current member's is refused as a likely
//   duplicate, and nothing outside the organization is ever compared;
// - a current membership of the organization (role member) and the organization's own fields
//   (rank and city, organization_member_record);
// - when Sifu_Database_ID names a teacher, an organization_teacher_claim "claimed by the
//   organization": never a teaching_relationship (DEFAULT D12; DEFAULT M24 question 4). The teacher must be
//   a public profile or a current member of this organization.
//
// Authorization: every procedure checks the account itself; an organization this account does not
// administer is 404 (organizations.ts managed()), and an import of another organization is 404 too.
// Previews and commits need the approval and the Federation plan (requireAdministration; DEFAULT D08).
//
// Privacy (plan §6.4): the file is never stored (its SHA-256 and size only); the Email column is
// never read; the parsed fields of a row are cleared once the import is committed, discarded or
// expired (24 hours, also by the daily retention job). Audit rows and logs carry ids, counts and
// the hash, never a name, a rank or a city.

import { createHash, randomBytes } from 'node:crypto';

import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';

import { isoDay } from '../../lib/dates';
import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import {
  organizationImport,
  organizationImportRow,
  organizationMemberRecord,
  organizationMembership,
  organizationTeacherClaim,
  person,
  personName,
} from '../db/schema';
import {
  type ImportRowData,
  type ImportRowError,
  ORGANIZATION_IMPORT_MAX_BYTES,
  ORGANIZATION_IMPORT_PREVIEW_HOURS,
  type ORGANIZATION_IMPORT_ROW_STATUSES,
  type ORGANIZATION_IMPORT_STATUSES,
  ORGANIZATION_IMPORTS_PER_DAY,
} from '../db/schema/organization-tools';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import { writePersonKeys } from '../search/store';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { ServiceError } from './errors';
import { checkRow, ImportFileError, nameKey, parseImportFile, TEMPLATE_HEADER } from './organization-import-csv';
import { managed, requireAdministration } from './organizations';
import { slugFromName } from './names';

export { TEMPLATE_HEADER };

export type ImportStatus = (typeof ORGANIZATION_IMPORT_STATUSES)[number];
export type ImportRowStatus = (typeof ORGANIZATION_IMPORT_ROW_STATUSES)[number];

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  previewed: 'Preview, not imported yet',
  committed: 'Imported',
  discarded: 'Discarded, nothing imported',
  expired: 'Expired, nothing imported',
};
export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  valid: 'Ready to import',
  error: 'Not imported: fix the file',
  imported: 'Imported',
  skipped: 'Not imported',
};

/** What every import says about its rows (no urgency; plan §5.6). */
export const IMPORT_NOTE =
  'Imported people are records the organization keeps, not accounts. They stay private, and a teacher named in the file is a claim of the organization, never a verified relationship: only the teacher’s own approval verifies one.';

const NO_IMPORT = 'No such import.';
const importNotFound = () => new ServiceError('NOT_FOUND', NO_IMPORT);
const NO_ORGANIZATION = 'No such organization.';
const orgNotFound = () => new ServiceError('NOT_FOUND', NO_ORGANIZATION);

// --- Input ---------------------------------------------------------------------------------------

const BASE64_MAX = Math.ceil(ORGANIZATION_IMPORT_MAX_BYTES / 3) * 4 + 8;

export const importPreviewInput = z.object({
  organizationId: z.uuid({ error: NO_ORGANIZATION }),
  /** The file's bytes, base64-encoded (a CSV file of the template, UTF-8). */
  contentBase64: z
    .string({ error: 'Choose a CSV file.' })
    .max(BASE64_MAX, { error: `The file is larger than ${ORGANIZATION_IMPORT_MAX_BYTES / 1024} KB. Split it into smaller files.` })
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, { error: 'Choose a CSV file.' }),
});
export const importIdInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }), importId: z.uuid({ error: NO_IMPORT }) });
export const importListInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }) });

/** A malformed id is 404, the same answer as for none; any other bad field is a field error. */
function parseInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  const field = String(issue.path[0] ?? 'form');
  if (field === 'organizationId') throw orgNotFound();
  if (field === 'importId') throw importNotFound();
  throw new ServiceError('BAD_REQUEST', issue.message, { [field === 'contentBase64' ? 'file' : field]: issue.message });
}

// --- Views ---------------------------------------------------------------------------------------

export interface ImportSummary {
  id: string;
  status: ImportStatus;
  statusLabel: string;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  rowCount: number;
  validCount: number;
  errorCount: number;
  importedCount: number;
}

export interface ImportRowView {
  rowNumber: number;
  status: ImportRowStatus;
  statusLabel: string;
  /** The parsed fields; null once the import has ended (they are cleared). */
  name: string | null;
  chineseName: string | null;
  startYear: number | null;
  rank: string | null;
  schoolCity: string | null;
  teacher: PersonRef | null;
  /** The record created from the row (imported rows). */
  person: PersonRef | null;
  errors: ImportRowError[];
}

export interface ImportView extends ImportSummary {
  organizationId: string;
  rows: ImportRowView[];
  note: string;
  can: { commit: boolean; discard: boolean };
}

export interface ImportPreviewResult extends ImportView {
  /** Columns of the file that the template does not name (ignored). */
  ignoredColumns: string[];
  /** The file had an Email column; it was not read (DEFAULT M24 question 3). */
  emailIgnored: boolean;
}

type ImportRowRecord = typeof organizationImport.$inferSelect;

function summaryOf(row: ImportRowRecord): ImportSummary {
  return {
    id: row.id,
    status: row.status,
    statusLabel: IMPORT_STATUS_LABELS[row.status],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    rowCount: row.rowCount,
    validCount: row.validCount,
    errorCount: row.errorCount,
    importedCount: row.importedCount,
  };
}

async function viewOf(db: Executor, imp: ImportRowRecord): Promise<ImportView> {
  const rows = await db.select().from(organizationImportRow).where(eq(organizationImportRow.importId, imp.id)).orderBy(asc(organizationImportRow.rowNumber));
  const ids = [...new Set(rows.flatMap((r) => [r.data?.teacherPersonId, r.personId].filter((v): v is string => typeof v === 'string')))];
  const refs = await peopleRefs(ids);
  const open = imp.status === 'previewed' && imp.expiresAt.getTime() > Date.now();
  return {
    ...summaryOf(imp),
    organizationId: imp.organizationId,
    note: IMPORT_NOTE,
    can: { commit: open && imp.validCount > 0, discard: open },
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      statusLabel: IMPORT_ROW_STATUS_LABELS[r.status],
      name: r.data?.name ?? null,
      chineseName: r.data?.chineseName ?? null,
      startYear: r.data?.startYear ?? null,
      rank: r.data?.rank ?? null,
      schoolCity: r.data?.schoolCity ?? null,
      teacher: r.data?.teacherPersonId ? (refs.get(r.data.teacherPersonId) ?? null) : null,
      person: r.personId ? (refs.get(r.personId) ?? null) : null,
      errors: r.errors,
    })),
  };
}

// --- Shared reads --------------------------------------------------------------------------------

/**
 * Ends the organization's previews past their time (status expired, the rows' data cleared). Also
 * run for every organization by the daily retention job (expireOrganizationImports, retention.ts).
 */
async function expireOpen(tx: Executor, organizationId: string): Promise<void> {
  await tx.execute(sql`
    WITH ended AS (
      UPDATE organization_import SET status = 'expired', ended_at = now(), updated_at = now()
       WHERE organization_id = ${organizationId}::uuid AND status = 'previewed' AND expires_at <= now()
      RETURNING id)
    UPDATE organization_import_row SET data = NULL, updated_at = now() WHERE import_id IN (SELECT id FROM ended)`);
}

/** The current members' name keys of the organization (the duplicate check; never anyone outside it). */
async function memberNameKeys(db: Executor, organizationId: string): Promise<Set<string>> {
  const today = isoDay(new Date());
  const rows = await db.execute<{ value: string }>(sql`
    SELECT n.value FROM organization_membership m
      JOIN person p ON p.id = m.person_id AND p.deleted_at IS NULL
      JOIN person_name n ON n.person_id = p.id AND n.is_primary
     WHERE m.organization_id = ${organizationId}::uuid
       AND (m.starts_on IS NULL OR m.starts_on <= ${today}::date)
       AND (m.ends_on IS NULL OR (m.ends_on > ${today}::date AND (m.starts_on IS NULL OR m.ends_on > m.starts_on)))`);
  return new Set(rows.rows.map((r) => nameKey(r.value)));
}

/**
 * The teachers that Sifu_Database_ID may name, by slug: a public profile (v_public_person), or a
 * current member of this organization (its own records, private ones included). Nothing else is
 * found, so a file never learns whether a private record of another organization exists.
 */
async function teachersBySlug(db: Executor, organizationId: string, slugs: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (slugs.length === 0) return found;
  const today = isoDay(new Date());
  const list = sql`ARRAY[${sql.join(slugs.map((s) => sql`${s}`), sql`, `)}]::text[]`;
  const rows = await db.execute<{ id: string; slug: string }>(sql`
    SELECT v.id::text AS id, v.slug FROM v_public_person v WHERE v.slug = ANY (${list})
    UNION
    SELECT p.id::text, p.slug FROM organization_membership m
      JOIN person p ON p.id = m.person_id AND p.deleted_at IS NULL
     WHERE m.organization_id = ${organizationId}::uuid AND p.slug = ANY (${list})
       AND (m.starts_on IS NULL OR m.starts_on <= ${today}::date)
       AND (m.ends_on IS NULL OR (m.ends_on > ${today}::date AND (m.starts_on IS NULL OR m.ends_on > m.starts_on)))`);
  for (const r of rows.rows) found.set(r.slug, r.id);
  return found;
}

/** The import of this organization, locked when `lock`; 404 for an import of any other. */
async function importOf(tx: Executor, organizationId: string, importId: string, lock = false): Promise<ImportRowRecord> {
  const query = tx
    .select()
    .from(organizationImport)
    .where(and(eq(organizationImport.id, importId), eq(organizationImport.organizationId, organizationId)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw importNotFound();
  return row;
}

function decode(base64: string): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength > ORGANIZATION_IMPORT_MAX_BYTES) {
    throw new ServiceError('PAYLOAD_TOO_LARGE', `The file is larger than ${ORGANIZATION_IMPORT_MAX_BYTES / 1024} KB. Split it into smaller files.`, { file: 'The file is too large.' });
  }
  return new Uint8Array(bytes);
}

// --- organizationTools.importPreview ---------------------------------------------------------------

/**
 * Checks every row of a file and stores the preview (nothing else changes). File-level problems are
 * BAD_REQUEST with the reason; row-level ones are the rows' errors. At most
 * ORGANIZATION_IMPORTS_PER_DAY previews per organization in 24 hours.
 */
export async function previewImport(principal: Principal | null, raw: z.input<typeof importPreviewInput>, meta: RequestMeta): Promise<ImportPreviewResult> {
  const p = requireUser(principal);
  const input = parseInput(importPreviewInput, raw);
  const bytes = decode(input.contentBase64);
  const db = getDb();
  const out = await db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await requireAdministration(tx, org);
    await expireOpen(tx, org.id);
    const [recent] = await tx
      .select({ n: count() })
      .from(organizationImport)
      .where(and(eq(organizationImport.organizationId, org.id), gt(organizationImport.createdAt, sql`now() - interval '24 hours'`)));
    if ((recent?.n ?? 0) >= ORGANIZATION_IMPORTS_PER_DAY) {
      throw new ServiceError('TOO_MANY_REQUESTS', `Your organization has checked ${ORGANIZATION_IMPORTS_PER_DAY} files in the last 24 hours. You can check another one tomorrow.`);
    }
    let parsed;
    try {
      parsed = parseImportFile(bytes);
    } catch (error) {
      if (error instanceof ImportFileError) throw new ServiceError('BAD_REQUEST', error.message, { file: error.message });
      throw error;
    }
    const thisYear = new Date().getUTCFullYear();
    const checked = parsed.rows.map((r) => checkRow(r, thisYear));
    const teachers = await teachersBySlug(tx, org.id, [...new Set(checked.flatMap((c) => (c.teacherSlug ? [c.teacherSlug] : [])))]);
    const members = await memberNameKeys(tx, org.id);
    const firstRowOf = new Map<string, number>();
    const rows = checked.map((c) => {
      const errors = [...c.errors];
      let teacherPersonId: string | null = null;
      if (c.teacherSlug) {
        teacherPersonId = teachers.get(c.teacherSlug) ?? null;
        if (!teacherPersonId) errors.push({ field: 'Sifu_Database_ID', message: 'No public profile or member of your organization has this address.' });
      }
      if (c.name && errors.every((e) => e.field !== 'First_Name')) {
        const k = nameKey(c.name);
        if (members.has(k)) errors.push({ field: 'row', message: 'A current member of your organization has this name. The row is not imported, so no one is listed twice.' });
        const first = firstRowOf.get(k);
        if (first !== undefined) errors.push({ field: 'row', message: `Row ${first} has the same name.` });
        else firstRowOf.set(k, c.rowNumber);
      }
      const data: ImportRowData = { name: c.name, chineseName: c.chineseName, startYear: c.startYear, rank: c.rank, teacherPersonId, schoolCity: c.schoolCity };
      return { rowNumber: c.rowNumber, status: errors.length === 0 ? ('valid' as const) : ('error' as const), data, errors };
    });
    const id = uuidv7();
    const validCount = rows.filter((r) => r.status === 'valid').length;
    const fileSha256 = createHash('sha256').update(bytes).digest('hex');
    await tx.insert(organizationImport).values({
      id,
      organizationId: org.id,
      createdByUserId: p.user.id,
      status: 'previewed',
      fileSha256,
      fileBytes: bytes.byteLength,
      rowCount: rows.length,
      validCount,
      errorCount: rows.length - validCount,
      expiresAt: new Date(Date.now() + ORGANIZATION_IMPORT_PREVIEW_HOURS * 3_600_000),
    });
    for (let i = 0; i < rows.length; i += 100) {
      await tx.insert(organizationImportRow).values(rows.slice(i, i + 100).map((r) => ({ importId: id, rowNumber: r.rowNumber, status: r.status, data: r.data, errors: r.errors })));
    }
    await writeAudit(tx, {
      action: 'organization.import_preview',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      after: { importId: id, fileSha256, fileBytes: bytes.byteLength, rows: rows.length, valid: validCount },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    const [imp] = await tx.select().from(organizationImport).where(eq(organizationImport.id, id));
    return { imp: imp!, ignoredColumns: parsed.ignoredColumns, emailIgnored: parsed.emailColumn };
  });
  return { ...(await viewOf(db, out.imp)), ignoredColumns: out.ignoredColumns, emailIgnored: out.emailIgnored };
}

// --- organizationTools.imports / importGet ---------------------------------------------------------

export async function listImports(principal: Principal | null, raw: z.input<typeof importListInput>): Promise<{ imports: ImportSummary[]; template: string; note: string }> {
  const p = requireUser(principal);
  const input = parseInput(importListInput, raw);
  const db = getDb();
  return db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await expireOpen(tx, org.id);
    const rows = await tx.select().from(organizationImport).where(eq(organizationImport.organizationId, org.id)).orderBy(desc(organizationImport.createdAt), desc(organizationImport.id)).limit(50);
    return { imports: rows.map(summaryOf), template: TEMPLATE_HEADER, note: IMPORT_NOTE };
  });
}

export async function getImport(principal: Principal | null, raw: z.input<typeof importIdInput>): Promise<ImportView> {
  const p = requireUser(principal);
  const input = parseInput(importIdInput, raw);
  const db = getDb();
  const imp = await db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await expireOpen(tx, org.id);
    return importOf(tx, org.id, input.importId);
  });
  return viewOf(db, imp);
}

// --- organizationTools.importCommit / importDiscard ------------------------------------------------

/** Clears the parsed fields of every row of an ended import (plan §6.4). */
async function clearRows(tx: Transaction, importId: string): Promise<void> {
  await tx.update(organizationImportRow).set({ data: null, updatedAt: new Date() }).where(eq(organizationImportRow.importId, importId));
}

async function openImport(tx: Transaction, p: ReturnType<typeof requireUser>, input: z.output<typeof importIdInput>) {
  const { org } = await managed(tx, p, input.organizationId);
  await requireAdministration(tx, org);
  await expireOpen(tx, org.id);
  const imp = await importOf(tx, org.id, input.importId, true);
  if (imp.status !== 'previewed') throw new ServiceError('CONFLICT', imp.status === 'expired' ? 'This preview has expired. Check the file again.' : 'This import has ended already.');
  return { org, imp };
}

/**
 * Creates every valid row inside the organization (see the header). The checks run again at
 * commit time (a teacher or a member may have changed since the preview); a row that fails them
 * is skipped with its reason. Nothing is ever matched onto an existing person or account.
 */
export async function commitImport(principal: Principal | null, raw: z.input<typeof importIdInput>, meta: RequestMeta): Promise<ImportView> {
  const p = requireUser(principal);
  const input = parseInput(importIdInput, raw);
  const db = getDb();
  const imp = await db.transaction(async (tx) => {
    const { org, imp } = await openImport(tx, p, input);
    const rows = await tx
      .select()
      .from(organizationImportRow)
      .where(and(eq(organizationImportRow.importId, imp.id), eq(organizationImportRow.status, 'valid')))
      .orderBy(asc(organizationImportRow.rowNumber));
    const teacherIds = [...new Set(rows.flatMap((r) => (r.data?.teacherPersonId ? [r.data.teacherPersonId] : [])))];
    // The teachers again: still a public profile or a current member.
    const slugs = teacherIds.length === 0 ? [] : await tx.select({ id: person.id, slug: person.slug }).from(person).where(inArray(person.id, teacherIds));
    const stillFound = await teachersBySlug(tx, org.id, slugs.map((s) => s.slug));
    const allowedTeachers = new Set(stillFound.values());
    const members = await memberNameKeys(tx, org.id);
    let imported = 0;
    const now = new Date();
    for (const row of rows) {
      const data = row.data;
      const problems: ImportRowError[] = [];
      if (!data) problems.push({ field: 'row', message: 'The row’s data is no longer kept.' });
      else {
        if (members.has(nameKey(data.name))) problems.push({ field: 'row', message: 'A current member of your organization has this name. The row is not imported, so no one is listed twice.' });
        if (data.teacherPersonId && !allowedTeachers.has(data.teacherPersonId)) problems.push({ field: 'Sifu_Database_ID', message: 'The teacher is no longer a public profile or a member of your organization.' });
      }
      if (problems.length > 0 || !data) {
        await tx.update(organizationImportRow).set({ status: 'skipped', errors: problems, updatedAt: now }).where(eq(organizationImportRow.id, row.id));
        continue;
      }
      const personId = uuidv7();
      // DEFAULT D03: private until a relationship with it is verified or its own account publishes
      // it; unclaimed: no account holds it (an import never authenticates anyone).
      await tx.insert(person).values({
        id: personId,
        slug: slugFromName(data.name, randomBytes(4).toString('hex')),
        kind: 'living',
        lifeStatus: 'living',
        stewardship: 'unclaimed',
        visibility: 'involved_only',
        createdByUserId: p.user.id,
        trainingStartYear: data.startYear,
      });
      const names: (typeof personName.$inferInsert)[] = [{ personId, kind: 'name', value: data.name, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 }];
      // DEFAULT M24 question 6: the template does not say which characters; Traditional is recorded.
      if (data.chineseName) names.push({ personId, kind: 'name', value: data.chineseName, script: 'Hant', lang: 'zh-Hant', sortOrder: 1 });
      await tx.insert(personName).values(names);
      await writePersonKeys(tx, personId);
      const membershipId = uuidv7();
      await tx.insert(organizationMembership).values({ id: membershipId, organizationId: org.id, personId, role: 'member' });
      if (data.rank || data.schoolCity) await tx.insert(organizationMemberRecord).values({ membershipId, rankLabel: data.rank, schoolCity: data.schoolCity, importId: imp.id });
      // DEFAULT M24 question 4: the organization's claim only; the relationship waits for the teacher.
      if (data.teacherPersonId) {
        await tx.insert(organizationTeacherClaim).values({
          organizationId: org.id,
          studentPersonId: personId,
          teacherPersonId: data.teacherPersonId,
          startYear: data.startYear,
          importId: imp.id,
          createdByUserId: p.user.id,
        });
      }
      await tx.update(organizationImportRow).set({ status: 'imported', personId, updatedAt: now }).where(eq(organizationImportRow.id, row.id));
      members.add(nameKey(data.name));
      imported += 1;
    }
    await clearRows(tx, imp.id);
    await tx.update(organizationImport).set({ status: 'committed', importedCount: imported, endedAt: now, endedByUserId: p.user.id, updatedAt: now }).where(eq(organizationImport.id, imp.id));
    await writeAudit(tx, {
      action: 'organization.import_commit',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { importId: imp.id, status: 'previewed', valid: imp.validCount },
      after: { status: 'committed', imported, skipped: rows.length - imported },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    const [ended] = await tx.select().from(organizationImport).where(eq(organizationImport.id, imp.id));
    return ended!;
  });
  return viewOf(db, imp);
}

export async function discardImport(principal: Principal | null, raw: z.input<typeof importIdInput>, meta: RequestMeta): Promise<ImportView> {
  const p = requireUser(principal);
  const input = parseInput(importIdInput, raw);
  const db = getDb();
  const imp = await db.transaction(async (tx) => {
    // Discarding needs no plan: an organization whose plan ended can still end a preview.
    const { org } = await managed(tx, p, input.organizationId);
    await expireOpen(tx, org.id);
    const imp = await importOf(tx, org.id, input.importId, true);
    if (imp.status !== 'previewed') throw new ServiceError('CONFLICT', 'This import has ended already.');
    const now = new Date();
    await clearRows(tx, imp.id);
    await tx.update(organizationImport).set({ status: 'discarded', endedAt: now, endedByUserId: p.user.id, updatedAt: now }).where(eq(organizationImport.id, imp.id));
    await writeAudit(tx, {
      action: 'organization.import_discard',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { importId: imp.id, status: 'previewed' },
      after: { status: 'discarded' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    const [ended] = await tx.select().from(organizationImport).where(eq(organizationImport.id, imp.id));
    return ended!;
  });
  return viewOf(db, imp);
}
