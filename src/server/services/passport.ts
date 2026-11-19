// The training passport (milestone M19; specification §8, §3.1 row "Digital passport"; plan §6.4,
// §6.5, §6.8; docs/adr/0022-passport.md).
//
// Public read (anyone, no session needed; the public DTO only, src/server/dto/passport.ts; from
// v_public_passport and v_public_edge, which show only public entries of public people):
//   passport.get        one person's passport by slug, as the plan of its account shows it
// The student (the account's own person):
//   passport.mine            every entry, its visibility, whether the profile shows it, the certificates
//   passport.setVisibility   private or public, for any entry of the own passport
//   passport.updateEntry     with `correction` only: a proposed correction to whoever wrote it
//   passport.uploadCertificate / removeCertificate
// The teacher (an established relationship) or an admin of the organization that issued it:
//   passport.students        the students they record for, one student's entries, their past events
//   passport.addRank / addExam / addSkill / updateEntry / withdrawEntry
//   passport.markAttendance  the organizer or an instructor of a past event, for their own students
// Staff with a verified second factor:
//   passport.remove          any entry, with a reason (audited; the owner is told)
//
// Who writes (DEFAULT M19, question 1): ranks, examinations and skills are written by the student's
// teacher while their relationship is verified (in arbitration it is read only), or by an admin of
// the approved organization named on the entry, for a member of it. Never by the student, who
// hides an entry, proposes a correction and uploads certificates.
//
// The plan (DEFAULT M19, question 3; plan §6.5): the passport's account decides what the profile
// shows. On Free Student and Free Sifu the current rank, the teachers with their periods and the
// year training began; on Premium Student and Professional Sifu also the examinations, forms and
// skills, certificates and events. Nothing is ever deleted: on a lower plan the entries are kept
// and only hidden (DEFAULT D08). Experience is shown only as precisely as the dates allow
// (DEFAULT M19, question 2; src/lib/passport-time.ts).
//
// Privacy (plan §6.4): an examiner, a teacher, an organization or an event is named only while it
// is public; a private certificate is served only to its student and their teachers, through the
// app (GET /api/certificates/..., no presigned address) from the private store; the public DTO
// never says how many entries are hidden. Logs and audit rows carry ids, kinds and field names,
// never a rank, a title, a correction or a storage key. passport.get is not cached: the plan of the
// account changes what it shows, and it is read per request like the profile it sits on.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { formatPartialDate, parsePartialDate, todayUtc } from '../../lib/partial-date';
import { currentOf, entryDate, experience, storedPrefix, timelineByYear } from '../../lib/passport-time';
import { writeAudit } from '../audit';
import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { passportCertificate, passportExam, passportRank, passportRankPhoto, passportSkill, person, personPhoto } from '../db/schema';
import {
  GALLERY_PHOTO_STATUSES,
  PASSPORT_CERTIFICATES_MAX,
  PASSPORT_ENTRY_KINDS,
  PASSPORT_NOTE_MAX,
  PASSPORT_RANK_PHOTOS_MAX,
  PASSPORT_TEXT_MAX,
  PASSPORT_TITLE_MAX,
  PASSPORT_VISIBILITIES,
  SKILL_PROGRESSES,
} from '../db/schema/common';
import { EVENT_KIND_LABELS, type EventKind } from '../dto/events';
import {
  type CertificateImageDto,
  type PassportDto,
  type PassportEntryDto,
  type PassportKind,
  type PassportPersonDto,
  type PassportRankPhotoDto,
  type PassportTeacherDto,
  SKILL_PROGRESS_LABELS,
  toPublicPassport,
} from '../dto/passport';
import { effectivePlan, type Executor } from '../entitlements/access';
import { feature, type PassportLevel, passportLevel, type PlanCode, PLANS, upgradeBenefits } from '../entitlements/plans';
import type { Transaction } from '../jobs/outbox';
import { logger } from '../log';
import { getEvidenceStore, newStorageKey, type ObjectStore } from '../storage';
import { PhotoRefused, renderGalleryPhoto } from '../storage/photo';
import { readObjectBytes } from '../storage/read';
import type { RequestMeta } from './context';
import type { UpgradeOffer } from './dashboard';
import { ServiceError } from './errors';
import { notify } from './notify';
import { PHOTO_HASH_LENGTH, photoUrl } from './photo-refs';
import {
  etagMatches,
  fileBytes,
  type OpenPhotoOptions,
  PHOTO_ADDRESS,
  PHOTO_READ_TIMEOUT_MS,
  PHOTO_RENDITION_MAX_BYTES,
  type PhotoFile,
  photoEtag,
  putRenditions,
  refusalMessage,
  renditionFile,
  sha256,
} from './photos';
import { openPilotRequest, planSummary } from './plans';

// --- Words -------------------------------------------------------------------------------------------

const NO_PASSPORT = 'No such passport.';
const NO_ENTRY = 'No such entry.';
const NO_STUDENT = 'No such student of yours.';
const NO_PROFILE = 'You have no profile yet. Finish setting up your profile first: your passport belongs to it.';
export const STUDENT_CANNOT_RECORD =
  'Ranks, examinations and skills are recorded by your teacher or by the organization that awarded them. You can hide an entry or propose a correction.';
export const ARBITRATION_READ_ONLY = 'While your relationship with this student is in arbitration, their passport can be read but not changed.';
const ONLY_A_CORRECTION = 'Only the teacher or the organization that recorded this entry changes it. You can propose a correction.';
const EVENT_NOT_PAST = 'Attendance is marked once an event has taken place, and only for an event that was not cancelled.';
const notFound = (message = NO_ENTRY) => new ServiceError('NOT_FOUND', message);

const FIELD_LABELS: Record<string, string> = {
  personId: 'Choose one of your students.',
  rank: `Enter the rank, at most ${PASSPORT_TEXT_MAX} characters.`,
  awardedRank: `Enter the rank the examination awarded, at most ${PASSPORT_TEXT_MAX} characters.`,
  name: `Enter the form or skill, at most ${PASSPORT_TEXT_MAX} characters.`,
  progress: 'Choose Learning or Approved.',
  date: 'Enter a year (2019), a month (2019-05) or a day (2019-05-12), or leave it empty.',
  organizationId: 'Choose an approved organization, or none.',
  examinerPersonId: 'Choose a person of the archive as the examiner, or none.',
  correction: `Say what should change, at most ${PASSPORT_NOTE_MAX} characters.`,
  visibility: 'Choose Private or Public.',
  title: `Give the certificate a title of at most ${PASSPORT_TITLE_MAX} characters, or leave it empty.`,
  file: 'Choose a JPEG, PNG or WebP image.',
  reason: `Say why the entry is removed, at most ${PASSPORT_NOTE_MAX} characters.`,
  eventId: 'Choose one of your past events.',
  personIds: 'Choose at least one of your students.',
  photoIds: `Choose at most ${PASSPORT_RANK_PHOTOS_MAX} photos of your own gallery.`,
};

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fields[key] ??= FIELD_LABELS[key] ?? issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

const oneLine = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const block = (value: string | null | undefined) =>
  (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// --- Input -------------------------------------------------------------------------------------------

const id = (message = NO_ENTRY) => z.uuid({ error: message });
const text = (max: number) => z.string().max(max * 2);
const dateField = z.string().max(20).nullish();
const writableKind = z.enum(['rank', 'exam', 'skill']);

export const passportSlugInput = z.object({ slug: z.string().max(200) });
export const addRankInput = z.object({ personId: id(NO_STUDENT), rank: text(PASSPORT_TEXT_MAX), date: dateField, organizationId: z.uuid().nullish() });
export const addExamInput = z.object({
  personId: id(NO_STUDENT),
  awardedRank: text(PASSPORT_TEXT_MAX),
  date: dateField,
  examinerPersonId: z.uuid().nullish(),
  organizationId: z.uuid().nullish(),
});
export const addSkillInput = z.object({
  personId: id(NO_STUDENT),
  name: text(PASSPORT_TEXT_MAX),
  progress: z.enum(SKILL_PROGRESSES).default('learning'),
  date: dateField,
  organizationId: z.uuid().nullish(),
});
export const updateEntryInput = z.object({
  kind: writableKind,
  id: id(),
  rank: text(PASSPORT_TEXT_MAX).optional(),
  awardedRank: text(PASSPORT_TEXT_MAX).optional(),
  name: text(PASSPORT_TEXT_MAX).optional(),
  progress: z.enum(SKILL_PROGRESSES).optional(),
  date: dateField,
  organizationId: z.uuid().nullish(),
  examinerPersonId: z.uuid().nullish(),
  /** The student's proposal to whoever wrote the entry; the only field a student may send. */
  correction: text(PASSPORT_NOTE_MAX).nullish(),
});
export const withdrawEntryInput = z.object({ kind: z.enum(['rank', 'exam', 'skill', 'attendance']), id: id() });
export const setVisibilityInput = z.object({ kind: z.enum(PASSPORT_ENTRY_KINDS), id: id(), visibility: z.enum(PASSPORT_VISIBILITIES) });
export const certificateUploadInput = z.object({
  file: z.file({ error: 'Choose an image.' }),
  title: text(PASSPORT_TITLE_MAX).nullish(),
  date: dateField,
  visibility: z.enum(PASSPORT_VISIBILITIES).default('private'),
});
export const certificateIdInput = z.object({ id: id('No such certificate.') });
export const markAttendanceInput = z.object({ eventId: z.uuid({ error: 'No such event.' }), personIds: z.array(z.uuid()).min(1).max(50) });
export const passportRemoveInput = z.object({ kind: z.enum(PASSPORT_ENTRY_KINDS), id: id(), reason: text(PASSPORT_NOTE_MAX) });
export const passportStudentsInput = z.object({ personId: z.uuid().nullish() });

/** A date as people remember it: "2019", "2019-05" or "2019-05-12"; empty for unknown; never after today. */
function cleanDate(raw: string | null | undefined, field = 'date'): { on: string | null; precision: 'year' | 'month' | 'day' | 'unknown' } {
  const value = (raw ?? '').trim();
  if (value === '') return { on: null, precision: 'unknown' };
  const parsed = parsePartialDate(value);
  if (!parsed || Number(parsed.firstDay.slice(0, 4)) < 1900) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { [field]: FIELD_LABELS.date! });
  if (parsed.firstDay > todayUtc()) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { [field]: 'The date is after today. Enter the date it happened.' });
  return { on: parsed.firstDay, precision: parsed.precision };
}

function cleanText(raw: string, field: string, max: number): string {
  const value = oneLine(raw);
  if (value.length < 1 || value.length > max) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { [field]: FIELD_LABELS[field]! });
  return value;
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'id')) throw notFound();
    throw fieldErrors(parsed.error);
  }
  return parsed.data;
}

// --- The tables ------------------------------------------------------------------------------------

const TABLES: Record<PassportKind, string> = {
  rank: 'passport_rank',
  exam: 'passport_exam',
  skill: 'passport_skill',
  certificate: 'passport_certificate',
  attendance: 'event_attendance',
};
/** The words of the entry for the notices: its rank, awarded rank, form or skill, title or event. */
const TITLE_SQL: Record<PassportKind, string> = {
  rank: 'x."rank"',
  exam: 'x."awarded_rank"',
  skill: 'x."name"',
  certificate: `COALESCE(x."title", 'Certificate')`,
  attendance: '(SELECT e."title" FROM "event" e WHERE e."id" = x."event_id")',
};

interface EntryRow extends Record<string, unknown> {
  id: string;
  person_id: string;
  status: 'active' | 'withdrawn' | 'removed' | 'pending' | 'refused';
  visibility: 'private' | 'public';
  created_by_user_id: string | null;
  teacher_person_id: string | null;
  organization_id: string | null;
  title: string;
}

/** One entry's shared columns (and its words), locked for a change when `lock`. */
async function loadEntry(db: Executor, kind: PassportKind, entryId: string, lock = false): Promise<EntryRow | null> {
  const teacher = kind === 'certificate' ? 'NULL::uuid' : 'x."teacher_person_id"';
  const organization = kind === 'rank' || kind === 'exam' || kind === 'skill' ? 'x."organization_id"' : 'NULL::uuid';
  const result = await db.execute<EntryRow>(sql`
    SELECT x."id", x."person_id", x."status", x."visibility", x."created_by_user_id",
           ${sql.raw(teacher)} AS "teacher_person_id", ${sql.raw(organization)} AS "organization_id", ${sql.raw(TITLE_SQL[kind])} AS "title"
      FROM ${sql.identifier(TABLES[kind])} x
     WHERE x."id" = ${entryId}::uuid ${lock ? sql`FOR UPDATE OF x` : sql``}`);
  return result.rows[0] ?? null;
}

// --- Who is who --------------------------------------------------------------------------------------

/** The signed-in account's own person (not deleted), or null. */
async function ownPersonId(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row?.id ?? null;
}

/** The strongest established relationship of a teacher with a student: verified, in arbitration, or none. */
async function relationshipOf(db: Executor, teacherPersonId: string, studentPersonId: string): Promise<'verified' | 'in_arbitration' | null> {
  const result = await db.execute<{ status: 'verified' | 'in_arbitration' }>(sql`
    SELECT status FROM teaching_relationship
     WHERE teacher_person_id = ${teacherPersonId}::uuid AND student_person_id = ${studentPersonId}::uuid AND status IN ('verified', 'in_arbitration')
     ORDER BY (status = 'verified') DESC LIMIT 1`);
  return result.rows[0]?.status ?? null;
}

/** Whether the account administers this approved organization (M15). */
async function administers(db: Executor, userId: string, organizationId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 AS one FROM organization_admin a JOIN organization o ON o.id = a.organization_id
     WHERE a.user_id = ${userId}::uuid AND a.organization_id = ${organizationId}::uuid AND a.revoked_at IS NULL
       AND o.status = 'active' AND o.deleted_at IS NULL`);
  return result.rows.length > 0;
}

/** Whether the person is a member of the organization now (no end, or an end not passed). */
async function isMember(db: Executor, organizationId: string, personId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 AS one FROM organization_membership
     WHERE organization_id = ${organizationId}::uuid AND person_id = ${personId}::uuid AND (ends_on IS NULL OR ends_on >= current_date)`);
  return result.rows.length > 0;
}

async function activeOrganization(db: Executor, organizationId: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM organization WHERE id = ${organizationId}::uuid AND status = 'active' AND deleted_at IS NULL`);
  return result.rows.length > 0;
}

interface Writer {
  userId: string;
  /** The teacher's own person, when the account writes as the student's teacher. */
  teacherPersonId: string | null;
  /** The organization named on the entry. */
  organizationId: string | null;
}

/**
 * Who may record for this student (DEFAULT M19, question 1): their teacher while the relationship is
 * verified (with any approved organization named as the issuer), or an admin of the organization
 * named, for a member of it. The student never; a relationship in arbitration reads only; anyone
 * else gets the answer of a student that is not there.
 */
async function writerFor(db: Executor, userId: string, studentPersonId: string, organizationId: string | null): Promise<Writer> {
  const [student] = await db.select({ id: person.id }).from(person).where(and(eq(person.id, studentPersonId), isNull(person.deletedAt)));
  if (!student) throw notFound(NO_STUDENT);
  const own = await ownPersonId(db, userId);
  if (own === studentPersonId) throw new ServiceError('FORBIDDEN', STUDENT_CANNOT_RECORD);
  const relationship = own ? await relationshipOf(db, own, studentPersonId) : null;
  if (relationship === 'verified') {
    if (organizationId && !(await activeOrganization(db, organizationId))) {
      throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { organizationId: FIELD_LABELS.organizationId! });
    }
    return { userId, teacherPersonId: own, organizationId };
  }
  if (organizationId && (await administers(db, userId, organizationId)) && (await isMember(db, organizationId, studentPersonId))) {
    return { userId, teacherPersonId: null, organizationId };
  }
  if (relationship === 'in_arbitration') throw new ServiceError('FORBIDDEN', ARBITRATION_READ_ONLY);
  throw notFound(NO_STUDENT);
}

/** Whether the account may change or withdraw an entry it (or its organization) wrote. */
async function mayChange(db: Executor, userId: string, entry: EntryRow): Promise<'yes' | 'arbitration' | 'no'> {
  const own = await ownPersonId(db, userId);
  if (own && entry.teacher_person_id === own) {
    const relationship = await relationshipOf(db, own, entry.person_id);
    if (relationship === 'verified') return 'yes';
    if (relationship === 'in_arbitration') return 'arbitration';
  }
  // An entry the organization recorded (no teacher on it), for a current member: any admin of it.
  // An entry a teacher recorded and named an organization on stays the teacher's alone.
  if (entry.teacher_person_id === null && entry.organization_id && (await administers(db, userId, entry.organization_id)) && (await isMember(db, entry.organization_id, entry.person_id))) {
    return 'yes';
  }
  return 'no';
}

/** The account of a person (its owner), or null for a record without one. */
async function accountOf(db: Executor, personId: string): Promise<string | null> {
  const [row] = await db.select({ userId: person.claimedByUserId }).from(person).where(eq(person.id, personId));
  return row?.userId ?? null;
}

/** The plan of the passport's account (a record without an account shows the basic passport). */
async function planOf(db: Executor, personId: string): Promise<{ plan: PlanCode; level: PassportLevel; userId: string | null }> {
  const userId = await accountOf(db, personId);
  if (!userId) return { plan: 'free_student', level: 'basic', userId: null };
  const { plan } = await effectivePlan({ kind: 'user', userId }, { db });
  return { plan, level: passportLevel(plan), userId };
}

// --- Shaping entries --------------------------------------------------------------------------------

/** The address of one rendition of a certificate: GET /api/certificates/<id>/<hash>/<size>.webp. */
export function certificateUrl(certificateId: string, sha: string, size: 96 | 512 | 'full'): string {
  return `/api/certificates/${certificateId}/${sha.slice(0, PHOTO_HASH_LENGTH)}/${size}.webp`;
}

function certificateImage(certificateId: string, sha: string | null, width: number | null, height: number | null): CertificateImageDto | null {
  if (!sha || !width || !height) return null;
  return {
    small: certificateUrl(certificateId, sha, 96),
    large: certificateUrl(certificateId, sha, 512),
    full: certificateUrl(certificateId, sha, 'full'),
    width,
    height,
  };
}

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();
const dayOf = (value: Date | string | null): string | null => (value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

function personRef(slug: string | null, name: string | null, lang: string | null): PassportPersonDto | null {
  if (!slug || !name) return null;
  return { slug, name: { value: name, lang: lang ?? 'und-Latn', script: 'Latn' } };
}

/** The columns of an entry as v_public_passport (or the owner's read) gives them. */
interface EntrySource extends Record<string, unknown> {
  kind: PassportKind;
  id: string;
  on_date: string | Date | null;
  precision: string;
  title: string | null;
  progress: string | null;
  organization_slug: string | null;
  organization_name: string | null;
  examiner_slug: string | null;
  examiner_name: string | null;
  examiner_lang: string | null;
  teacher_slug: string | null;
  teacher_name: string | null;
  teacher_lang: string | null;
  event_slug: string | null;
  event_kind: string | null;
  certificate_sha256: string | null;
  certificate_width: number | null;
  certificate_height: number | null;
  created_at: string | Date;
}

function entryOf(r: EntrySource): PassportEntryDto {
  const date = storedPrefix(dayOf(r.on_date), r.precision);
  const progress = r.kind === 'skill' && (r.progress === 'learning' || r.progress === 'approved') ? r.progress : null;
  return {
    kind: r.kind,
    id: r.id,
    date,
    dateText: entryDate(date),
    title: r.title ?? (r.kind === 'certificate' ? 'Certificate' : ''),
    progress,
    progressLabel: progress ? SKILL_PROGRESS_LABELS[progress] : null,
    organization: r.organization_slug && r.organization_name ? { slug: r.organization_slug, name: r.organization_name } : null,
    examiner: personRef(r.examiner_slug, r.examiner_name, r.examiner_lang),
    teacher: personRef(r.teacher_slug, r.teacher_name, r.teacher_lang),
    event: r.event_slug ? { slug: r.event_slug, kindLabel: EVENT_KIND_LABELS[(r.event_kind ?? 'other') as EventKind] ?? 'Event' } : null,
    image: r.kind === 'certificate' ? certificateImage(r.id, r.certificate_sha256, r.certificate_width, r.certificate_height) : null,
    photos: [],
    createdAt: iso(r.created_at),
  };
}

/**
 * The grading photos of ranks (ADR 0046), by rank id, in order: only photos of the rank's own person
 * that are still in their gallery (statuses active and gallery), which GET /api/photos serves to
 * anyone exactly when the person is public. A photo taken out of the gallery drops out here.
 */
async function rankPhotos(db: Executor, rankIds: readonly string[]): Promise<Map<string, PassportRankPhotoDto[]>> {
  const out = new Map<string, PassportRankPhotoDto[]>();
  if (rankIds.length === 0) return out;
  const rows = await db
    .select({ rankId: passportRankPhoto.rankId, id: personPhoto.id, sha256: personPhoto.sha256, caption: personPhoto.caption })
    .from(passportRankPhoto)
    .innerJoin(passportRank, eq(passportRank.id, passportRankPhoto.rankId))
    .innerJoin(personPhoto, and(eq(personPhoto.id, passportRankPhoto.photoId), eq(personPhoto.personId, passportRank.personId)))
    .where(and(inArray(passportRankPhoto.rankId, [...rankIds]), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])))
    .orderBy(passportRankPhoto.rankId, passportRankPhoto.position);
  for (const r of rows) {
    const list = out.get(r.rankId) ?? [];
    list.push({ id: r.id, small: photoUrl(r.id, r.sha256, 96), large: photoUrl(r.id, r.sha256, 512), caption: r.caption });
    out.set(r.rankId, list);
  }
  return out;
}

/** The entries with their ranks' grading photos attached. */
async function withRankPhotos<T extends PassportEntryDto>(db: Executor, entries: T[]): Promise<T[]> {
  const photos = await rankPhotos(
    db,
    entries.filter((e) => e.kind === 'rank').map((e) => e.id),
  );
  return entries.map((e) => (e.kind === 'rank' ? { ...e, photos: photos.get(e.id) ?? [] } : e));
}

/** "2015 – now", "March 2015 – May 2019", "since 2015", "Dates not recorded". */
export function periodText(start: string | null, end: string | null, ongoing: boolean): string {
  if (!start && !end) return ongoing ? 'Dates not recorded · ongoing' : 'Dates not recorded';
  const from = start ? formatPartialDate(start) : 'An unknown date';
  if (ongoing) return `${from} – now`;
  return end ? `${from} – ${formatPartialDate(end)}` : `since ${from}`;
}

interface PeriodRow {
  startsOn: string | null;
  endsOn: string | null;
  precision: string;
  ongoing: boolean;
}

function periodsOf(raw: readonly PeriodRow[]): PassportTeacherDto['periods'] {
  return raw.map((p) => {
    const start = storedPrefix(p.startsOn, p.precision);
    const end = storedPrefix(p.endsOn, p.precision);
    return { start, end, ongoing: p.ongoing, text: periodText(start, end, p.ongoing) };
  });
}

interface TeacherRow extends Record<string, unknown> {
  slug: string;
  display_name: string;
  lang: string | null;
  lineage_name: string;
  periods: PeriodRow[];
}

/** The teachers of a public person with their periods: the public, established relationships only. */
async function publicTeachers(db: Executor, personId: string): Promise<PassportTeacherDto[]> {
  const result = await db.execute<TeacherRow>(sql`
    SELECT t.slug, t.display_name, (SELECT n.lang FROM person_name n WHERE n.person_id = t.id AND n.is_primary LIMIT 1) AS lang,
           e.lineage_name, e.periods
      FROM v_public_edge e JOIN v_public_person t ON t.id = e.teacher_person_id
     WHERE e.student_person_id = ${personId}::uuid
     ORDER BY e.is_display_primary DESC, t.display_name, e.id`);
  return result.rows.map((r) => ({ person: personRef(r.slug, r.display_name, r.lang)!, lineage: r.lineage_name, periods: periodsOf(r.periods ?? []) }));
}

async function startYearOf(db: Executor, personId: string): Promise<number | null> {
  const [row] = await db.select({ year: person.trainingStartYear }).from(person).where(eq(person.id, personId));
  return row?.year ?? null;
}

/**
 * Experience as the passport shows it (DEFAULT M19, question 2): as precisely as the dates allow;
 * the basic passport shows only the year training began (DEFAULT M19, question 3).
 */
function experienceOf(teachers: readonly PassportTeacherDto[], startYear: number | null, level: PassportLevel): PassportDto['experience'] {
  const found = experience(
    teachers.flatMap((t) => t.periods),
    startYear,
    todayUtc(),
  );
  if (!found) return null;
  return { text: level === 'full' ? found.text : `since ${found.startYear}`, startYear: found.startYear };
}

// --- passport.get ----------------------------------------------------------------------------------

const PUBLIC_ENTRY_COLUMNS = sql.raw(`kind, id, on_date, precision, title, progress, organization_slug, organization_name, examiner_slug, examiner_name, examiner_lang,
  teacher_slug, teacher_name, teacher_lang, event_slug, event_kind, certificate_sha256, certificate_width, certificate_height, created_at`);

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * passport.get: a public person's passport as the plan of its account shows it. 404 for a person who
 * is not public, a malformed slug and none at all alike (the person pages' rule, plan §6.4).
 */
export async function passportGet(_principal: Principal | null, raw: z.input<typeof passportSlugInput>): Promise<PassportDto> {
  const parsed = passportSlugInput.safeParse(raw);
  const wanted = parsed.success ? parsed.data.slug.trim() : '';
  if (!slugPattern.test(wanted)) throw notFound(NO_PASSPORT);
  const db = getDb();
  const found = await db.execute<{ id: string; slug: string }>(sql`SELECT id, slug FROM v_public_person WHERE slug = ${wanted}`);
  const row = found.rows[0];
  if (!row) throw notFound(NO_PASSPORT);
  const { level } = await planOf(db, row.id);
  const [entries, teachers, startYear] = await Promise.all([
    db
      .execute<EntrySource>(sql`SELECT ${PUBLIC_ENTRY_COLUMNS} FROM v_public_passport WHERE person_id = ${row.id}::uuid`)
      // ADR 0046: grading photos are part of the full passport; the basic one shows none.
      .then((r) => r.rows.map(entryOf))
      .then((list) => (level === 'full' ? withRankPhotos(db, list) : list)),
    publicTeachers(db, row.id),
    startYearOf(db, row.id),
  ]);
  const currentRank = currentOf(entries.filter((e) => e.kind === 'rank'));
  return toPublicPassport({
    slug: row.slug,
    level,
    experience: experienceOf(teachers, startYear, level),
    currentRank,
    teachers,
    // DEFAULT M19 (question 3): the basic passport is the current rank, the teachers and the start
    // year; the examinations, skills, certificates and events wait, kept, for a plan that shows them.
    timeline: level === 'full' ? timelineByYear(entries) : [],
  });
}

// --- The owner's entries ---------------------------------------------------------------------------

interface OwnRow extends EntrySource {
  visibility: 'private' | 'public';
  created_by_user_id: string | null;
  correction_note: string | null;
  correction_at: string | Date | null;
  writer_organization: boolean;
  organization_id: string | null;
  teacher_person_id: string | null;
  /** A student's attendance claim waiting for the organizer (ADR 0046); only in the student's own passport. */
  waiting: boolean;
}

/**
 * Every active entry of a passport with what only its student and teachers see: the visibility, a
 * proposed correction, who wrote it. The examiner only while public (In scope 8); the teacher by
 * name, a person of the student's own relationship (DEFAULT D03). `organizationIds` keeps only the
 * entries those organizations recorded (an organization's admin who is not the student's teacher).
 */
async function ownEntries(db: Executor, personId: string, organizationIds: readonly string[] | null = null, includeClaims = false): Promise<OwnRow[]> {
  const name = (alias: string) => sql.raw(`(SELECT n."value" FROM "person_name" n WHERE n."person_id" = ${alias}."id" AND n."is_primary" LIMIT 1)`);
  const lang = (alias: string) => sql.raw(`(SELECT n."lang" FROM "person_name" n WHERE n."person_id" = ${alias}."id" AND n."is_primary" LIMIT 1)`);
  const result = await db.execute<OwnRow>(sql`
    SELECT 'rank' AS kind, r.id, r.awarded_on AS on_date, r.precision, r.rank AS title, NULL AS progress, o.slug AS organization_slug, o.name AS organization_name,
           NULL AS examiner_slug, NULL AS examiner_name, NULL AS examiner_lang, tp.slug AS teacher_slug, ${name('tp')} AS teacher_name, ${lang('tp')} AS teacher_lang,
           NULL AS event_slug, NULL AS event_kind, NULL AS certificate_sha256, NULL::int AS certificate_width, NULL::int AS certificate_height, r.created_at,
           r.visibility, r.created_by_user_id, r.correction_note, r.correction_at, (r.teacher_person_id IS NULL) AS writer_organization, r.organization_id, r.teacher_person_id,
           false AS waiting
      FROM passport_rank r LEFT JOIN v_public_organization o ON o.id = r.organization_id LEFT JOIN person tp ON tp.id = r.teacher_person_id AND tp.deleted_at IS NULL
     WHERE r.person_id = ${personId}::uuid AND r.status = 'active'
    UNION ALL
    SELECT 'exam', x.id, x.exam_on, x.precision, x.awarded_rank, NULL, o.slug, o.name,
           ep.slug, ep.display_name, ${lang('ep')}, tp.slug, ${name('tp')}, ${lang('tp')},
           NULL, NULL, NULL, NULL::int, NULL::int, x.created_at,
           x.visibility, x.created_by_user_id, x.correction_note, x.correction_at, (x.teacher_person_id IS NULL), x.organization_id, x.teacher_person_id,
           false
      FROM passport_exam x LEFT JOIN v_public_organization o ON o.id = x.organization_id LEFT JOIN v_public_person ep ON ep.id = x.examiner_person_id
           LEFT JOIN person tp ON tp.id = x.teacher_person_id AND tp.deleted_at IS NULL
     WHERE x.person_id = ${personId}::uuid AND x.status = 'active'
    UNION ALL
    SELECT 'skill', k.id, k.since_on, k.precision, k.name, k.progress, o.slug, o.name,
           NULL, NULL, NULL, tp.slug, ${name('tp')}, ${lang('tp')},
           NULL, NULL, NULL, NULL::int, NULL::int, k.created_at,
           k.visibility, k.created_by_user_id, k.correction_note, k.correction_at, (k.teacher_person_id IS NULL), k.organization_id, k.teacher_person_id,
           false
      FROM passport_skill k LEFT JOIN v_public_organization o ON o.id = k.organization_id LEFT JOIN person tp ON tp.id = k.teacher_person_id AND tp.deleted_at IS NULL
     WHERE k.person_id = ${personId}::uuid AND k.status = 'active'
    UNION ALL
    SELECT 'certificate', c.id, c.issued_on, c.precision, c.title, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, c.sha256, c.width, c.height, c.created_at,
           c.visibility, c.created_by_user_id, NULL, NULL, false, NULL, NULL::uuid,
           false
      FROM passport_certificate c
     WHERE c.person_id = ${personId}::uuid AND c.status = 'active'
    UNION ALL
    SELECT 'attendance', a.id, (e.starts_at AT TIME ZONE e.timezone)::date, 'day', e.title, NULL, NULL, NULL,
           NULL, NULL, NULL, tp.slug, ${name('tp')}, ${lang('tp')},
           e.slug, e.kind, NULL, NULL::int, NULL::int, a.created_at,
           a.visibility, a.created_by_user_id, NULL, NULL, false, NULL, a.teacher_person_id,
           (a.status = 'pending')
      FROM event_attendance a JOIN event e ON e.id = a.event_id AND e.status <> 'removed' LEFT JOIN person tp ON tp.id = a.teacher_person_id AND tp.deleted_at IS NULL
     WHERE a.person_id = ${personId}::uuid AND ${includeClaims ? sql`a.status IN ('active', 'pending')` : sql`a.status = 'active'`}`);
  const rows = result.rows as OwnRow[];
  if (organizationIds === null) return rows;
  // Only what the organization itself recorded: an entry a teacher wrote and named the
  // organization on stays the teacher's (and, while private, out of the admin's sight).
  return rows.filter((r) => r.writer_organization && r.organization_id !== null && organizationIds.includes(r.organization_id));
}

export interface OwnPassportEntry extends PassportEntryDto {
  visibility: 'private' | 'public';
  /** Whether the profile shows it now: public, on a public profile, within the plan. */
  shownOnProfile: boolean;
  /** Public, but the plan's basic passport does not show it (kept, DEFAULT D08). */
  hiddenByPlan: boolean;
  /** Written by an organization's admin rather than the teacher. */
  byOrganization: boolean;
  /** The student's proposed correction, waiting for whoever wrote it. */
  correction: { note: string; at: string } | null;
  /** An attendance the student claimed, waiting for the organizer to confirm it (ADR 0046): shown nowhere else. */
  waitingForOrganizer: boolean;
}

function ownEntryOf(r: OwnRow, level: PassportLevel, profilePublic: boolean, currentRankId: string | null): OwnPassportEntry {
  const entry = entryOf(r);
  const allowed = level === 'full' || (entry.kind === 'rank' && entry.id === currentRankId);
  return {
    ...entry,
    visibility: r.visibility,
    shownOnProfile: !r.waiting && profilePublic && r.visibility === 'public' && allowed,
    hiddenByPlan: !r.waiting && r.visibility === 'public' && !allowed,
    byOrganization: r.writer_organization,
    correction: r.correction_note && r.correction_at ? { note: r.correction_note, at: iso(r.correction_at) } : null,
    waitingForOrganizer: r.waiting === true,
  };
}

interface OwnTeacherRow extends Record<string, unknown> {
  slug: string;
  name: string | null;
  lang: string | null;
  lineage_name: string;
  periods: PeriodRow[] | null;
}

/** The student's own established teachers (verified or in arbitration), public or not (DEFAULT D03). */
async function ownTeachers(db: Executor, personId: string): Promise<PassportTeacherDto[]> {
  const result = await db.execute<OwnTeacherRow>(sql`
    SELECT t.slug, (SELECT n.value FROM person_name n WHERE n.person_id = t.id AND n.is_primary LIMIT 1) AS name,
           (SELECT n.lang FROM person_name n WHERE n.person_id = t.id AND n.is_primary LIMIT 1) AS lang,
           l.name AS lineage_name,
           (SELECT jsonb_agg(jsonb_build_object('startsOn', tp.starts_on, 'endsOn', tp.ends_on, 'precision', tp.precision, 'ongoing', tp.ongoing) ORDER BY tp.sort_order, tp.starts_on)
              FROM training_period tp WHERE tp.relationship_id = r.id) AS periods
      FROM teaching_relationship r JOIN person t ON t.id = r.teacher_person_id AND t.deleted_at IS NULL JOIN lineage l ON l.id = r.lineage_id
     WHERE r.student_person_id = ${personId}::uuid AND r.status IN ('verified', 'in_arbitration')
     ORDER BY r.is_display_primary DESC, name, r.id`);
  return result.rows.map((r) => ({ person: personRef(r.slug, r.name ?? 'Unnamed teacher', r.lang)!, lineage: r.lineage_name, periods: periodsOf(r.periods ?? []) }));
}

/** The higher plan of the same audience, whose passport shows the whole timeline. */
const FULL_PLAN_OF: Partial<Record<PlanCode, PlanCode>> = { free_student: 'premium_student', free_sifu: 'pro_sifu' };

export interface MyPassport {
  /** The own person; `name` is the primary display name (the print view's heading, ADR 0046). */
  person: { slug: string; public: boolean; name: { value: string; lang: string } };
  plan: { code: PlanCode; name: string };
  level: PassportLevel;
  experience: PassportDto['experience'];
  currentRankId: string | null;
  teachers: PassportTeacherDto[];
  entries: OwnPassportEntry[];
  /** The public entries the plan keeps but does not show. */
  hiddenByPlan: number;
  certificates: { count: number; limit: number };
  /** Grading photos on ranks (ADR 0046): whether the plan lets the student choose them, and how many per rank. */
  rankPhotos: { allowed: boolean; limit: number };
  /** At the real limit (entries kept but hidden), the plan that shows them; only 'now' benefits. */
  upgrade: UpgradeOffer | null;
}

/** passport.mine: the own passport, every active entry, with its visibility and what the profile shows. */
export async function myPassport(principal: Principal | null): Promise<MyPassport> {
  const p = requireUser(principal);
  const db = getDb();
  const [own] = await db
    .select({ id: person.id, slug: person.slug, visibility: person.visibility })
    .from(person)
    .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  if (!own) throw notFound(NO_PROFILE);
  const { plan, level } = await planOf(db, own.id);
  const profile = await db.execute(sql`SELECT 1 AS one FROM v_public_person WHERE id = ${own.id}::uuid`);
  const profilePublic = profile.rows.length > 0;
  const named = await db.execute<{ value: string; lang: string }>(sql`SELECT value, lang FROM person_name WHERE person_id = ${own.id}::uuid AND is_primary LIMIT 1`);
  const name = named.rows[0] ?? { value: '', lang: 'und-Latn' };
  const [rows, teachers, startYear] = await Promise.all([ownEntries(db, own.id, null, true), ownTeachers(db, own.id), startYearOf(db, own.id)]);
  // The current rank among the public ones is the one a basic passport shows.
  const publicRanks = rows.filter((r) => r.kind === 'rank' && r.visibility === 'public').map(entryOf);
  const currentPublic = currentOf(publicRanks);
  const entries = await withRankPhotos(
    db,
    rows.map((r) => ownEntryOf(r, level, profilePublic, currentPublic?.id ?? null)),
  );
  const current = currentOf(entries.filter((e) => e.kind === 'rank'));
  const hidden = entries.filter((e) => e.hiddenByPlan).length;
  let upgrade: UpgradeOffer | null = null;
  const higher = FULL_PLAN_OF[plan];
  // Only at the real limit (plan §5.6): entries are kept but not shown, and a plan of the pilot shows them.
  if (hidden > 0 && higher) {
    const from = planSummary(plan);
    const to = planSummary(higher);
    upgrade = {
      feature: 'passport',
      heading: (feature('passport').upgradeHeading ?? 'More with {plan}').replace('{plan}', to.name),
      allowance: {
        current: hidden,
        limit: 0,
        sentence: `${hidden === 1 ? '1 entry is' : `${hidden} entries are`} kept in your passport but not shown on your profile on ${from.name}.`,
      },
      from,
      to,
      benefits: upgradeBenefits(plan, higher, 'passport'),
      waiting: null,
      pilotRequest: await openPilotRequest(db, p.user.id),
    };
  }
  return {
    person: { slug: own.slug, public: profilePublic, name: { value: name.value, lang: name.lang } },
    plan: { code: plan, name: PLANS[plan].name },
    level,
    experience: experienceOf(teachers, startYear, 'full'),
    currentRankId: current?.id ?? null,
    teachers,
    entries: timelineByYear(entries).flatMap((y) => y.items),
    hiddenByPlan: hidden,
    certificates: { count: entries.filter((e) => e.kind === 'certificate').length, limit: PASSPORT_CERTIFICATES_MAX },
    rankPhotos: { allowed: level === 'full', limit: PASSPORT_RANK_PHOTOS_MAX },
    upgrade,
  };
}

// --- The teacher's view ------------------------------------------------------------------------------

export interface PassportStudent {
  personId: string;
  slug: string;
  name: PassportPersonDto['name'];
  /** As their teacher: verified (they record) or in arbitration (read only); null when only through an organization. */
  relationship: 'verified' | 'in_arbitration' | null;
  /** The approved organizations the account administers of which the student is a member. */
  organizations: { id: string; name: string }[];
  canRecord: boolean;
}

export interface StudentEntry extends OwnPassportEntry {
  /** Whether this account may change or withdraw it (it, or its organization, wrote it). */
  canChange: boolean;
}

export interface PastEvent {
  id: string;
  slug: string;
  title: string;
  dateText: string;
  /** Whether the selected student is marked as attending. */
  attended: boolean;
}

export interface PassportStudents {
  /** The account has no profile and administers no organization: nobody to record for. */
  hasProfile: boolean;
  students: PassportStudent[];
  /** The organizations the account administers (approved), to name as the issuer. */
  organizations: { id: string; name: string }[];
  selected: { student: PassportStudent; entries: StudentEntry[]; events: PastEvent[]; examiners: PassportExaminer[] } | null;
}

/** A person the form offers as the examiner: this account's own person, its teachers and the student's other teachers. */
export interface PassportExaminer {
  personId: string;
  name: PassportPersonDto['name'];
  /** "You", "Your teacher", "Their teacher". */
  note: string;
}

interface StudentRow extends Record<string, unknown> {
  person_id: string;
  slug: string;
  name: string | null;
  lang: string | null;
  relationship: 'verified' | 'in_arbitration' | null;
  organization_ids: string[] | null;
}

/** The most students the list shows (a Sifu with more finds them by the student's page). */
export const PASSPORT_STUDENTS_LIMIT = 500;

/**
 * passport.students: the students this account records for (its established students, and the
 * members of the approved organizations it administers), and with `personId` one of them: their
 * active entries (all of a teacher's student; an organization's own otherwise) and this account's
 * past events, for attendance.
 */
export async function passportStudents(principal: Principal | null, raw: z.input<typeof passportStudentsInput> = {}): Promise<PassportStudents> {
  const p = requireUser(principal);
  const input = parse(passportStudentsInput, raw ?? {});
  const db = getDb();
  const own = await ownPersonId(db, p.user.id);
  const orgs = await db.execute<{ id: string; name: string }>(sql`
    SELECT o.id, o.name FROM organization_admin a JOIN organization o ON o.id = a.organization_id
     WHERE a.user_id = ${p.user.id}::uuid AND a.revoked_at IS NULL AND o.status = 'active' AND o.deleted_at IS NULL ORDER BY o.name, o.id`);
  const organizations = orgs.rows;
  const orgIds = organizations.map((o) => o.id);
  const studentRows = (only: string | null) => db.execute<StudentRow>(sql`
    WITH taught AS (
      SELECT DISTINCT ON (r.student_person_id) r.student_person_id AS person_id, r.status AS relationship
        FROM teaching_relationship r
       WHERE ${own ? sql`r.teacher_person_id = ${own}::uuid` : sql`false`} AND r.status IN ('verified', 'in_arbitration')
       ORDER BY r.student_person_id, (r.status = 'verified') DESC
    ), members AS (
      SELECT m.person_id, array_agg(m.organization_id ORDER BY m.organization_id) AS organization_ids
        FROM organization_membership m
       WHERE m.organization_id = ANY(${orgIds.length > 0 ? sql`ARRAY[${sql.join(orgIds.map((o) => sql`${o}::uuid`), sql`, `)}]::uuid[]` : sql`ARRAY[]::uuid[]`})
         AND (m.ends_on IS NULL OR m.ends_on >= current_date)
       GROUP BY m.person_id
    )
    SELECT p.id AS person_id, p.slug,
           (SELECT n.value FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1) AS name,
           (SELECT n.lang FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1) AS lang,
           t.relationship, m.organization_ids
      FROM person p LEFT JOIN taught t ON t.person_id = p.id LEFT JOIN members m ON m.person_id = p.id
     WHERE p.deleted_at IS NULL AND (t.person_id IS NOT NULL OR m.person_id IS NOT NULL) ${own ? sql`AND p.id <> ${own}::uuid` : sql``}
           ${only ? sql`AND p.id = ${only}::uuid` : sql``}
     ORDER BY name, p.id
     LIMIT ${PASSPORT_STUDENTS_LIMIT}`);
  const toStudent = (r: StudentRow): PassportStudent => {
    const memberOf = organizations.filter((o) => (r.organization_ids ?? []).includes(o.id));
    return {
      personId: r.person_id,
      slug: r.slug,
      name: { value: r.name ?? 'Unnamed student', lang: r.lang ?? 'und-Latn', script: 'Latn' },
      relationship: r.relationship,
      organizations: memberOf,
      canRecord: r.relationship === 'verified' || memberOf.length > 0,
    };
  };
  const students: PassportStudent[] = (await studentRows(null)).rows.map(toStudent);
  let selected: PassportStudents['selected'] = null;
  if (input.personId) {
    // A student beyond the listed ones (more than PASSPORT_STUDENTS_LIMIT) is still theirs.
    const student = students.find((s) => s.personId === input.personId) ?? (await studentRows(input.personId)).rows.map(toStudent)[0];
    if (!student) throw notFound(NO_STUDENT);
    const { level } = await planOf(db, student.personId);
    const shown = await db.execute(sql`SELECT 1 AS one FROM v_public_person WHERE id = ${student.personId}::uuid`);
    // A teacher sees the student's whole passport; an organization's admin only its own entries.
    const rows = await ownEntries(db, student.personId, student.relationship ? null : student.organizations.map((o) => o.id));
    const currentPublic = currentOf(rows.filter((r) => r.kind === 'rank' && r.visibility === 'public').map(entryOf));
    const entries: StudentEntry[] = [];
    const memberOf = student.organizations.map((o) => o.id);
    for (const row of rows) {
      const base = ownEntryOf(row, level, shown.rows.length > 0, currentPublic?.id ?? null);
      // The rule of mayChange, from what is already known here (no query per entry).
      const canChange =
        row.kind !== 'certificate' &&
        ((own !== null && row.teacher_person_id === own && student.relationship === 'verified') ||
          (row.writer_organization && row.organization_id !== null && memberOf.includes(row.organization_id)));
      entries.push({ ...base, canChange });
    }
    const events = own
      ? await db.execute<{ id: string; slug: string; title: string; day: string; attended: boolean }>(sql`
          SELECT e.id, e.slug, e.title, to_char((e.starts_at AT TIME ZONE e.timezone)::date, 'YYYY-MM-DD') AS day,
                 EXISTS (SELECT 1 FROM event_attendance a WHERE a.event_id = e.id AND a.person_id = ${student.personId}::uuid AND a.status = 'active') AS attended
            FROM event e
           WHERE e.status = 'published' AND e.ends_at < now()
             AND (e.organizer_person_id = ${own}::uuid OR EXISTS (SELECT 1 FROM event_instructor i WHERE i.event_id = e.id AND i.person_id = ${own}::uuid))
           ORDER BY e.starts_at DESC, e.id LIMIT 20`)
      : { rows: [] };
    // DEFAULT M19 (question 6): the examiner is chosen among the people the writer knows on the
    // record (themself, their teachers, the student's other teachers), never a free search.
    const examinerRows = await db.execute<{ id: string; name: string | null; lang: string | null; note: string }>(sql`
      SELECT DISTINCT ON (p.id) p.id,
             (SELECT n.value FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1) AS name,
             (SELECT n.lang FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1) AS lang,
             c.note
        FROM (
          SELECT ${own ?? null}::uuid AS id, 'You' AS note, 0 AS rank
          UNION ALL
          SELECT r.teacher_person_id, 'Your teacher', 1 FROM teaching_relationship r
           WHERE ${own ? sql`r.student_person_id = ${own}::uuid` : sql`false`} AND r.status = 'verified'
          UNION ALL
          SELECT r.teacher_person_id, 'Their teacher', 2 FROM teaching_relationship r
           WHERE r.student_person_id = ${student.personId}::uuid AND r.status = 'verified'
        ) c JOIN person p ON p.id = c.id AND p.deleted_at IS NULL
       WHERE p.id <> ${student.personId}::uuid
       ORDER BY p.id, c.rank`);
    const examiners = examinerRows.rows
      .map((r) => ({ personId: r.id, name: { value: r.name ?? 'Unnamed person', lang: r.lang ?? 'und-Latn', script: 'Latn' as const }, note: r.note }))
      .sort((a, b) => (a.note === 'You' ? -1 : b.note === 'You' ? 1 : a.name.value.localeCompare(b.name.value, 'en')));
    selected = {
      student,
      entries: timelineByYear(entries).flatMap((y) => y.items),
      events: events.rows.map((e) => ({ id: e.id, slug: e.slug, title: e.title, dateText: formatPartialDate(e.day), attended: e.attended })),
      examiners,
    };
  }
  return { hasProfile: own !== null || organizations.length > 0, students, organizations, selected };
}

// --- Writing -----------------------------------------------------------------------------------------

/** Tells the student's account (if it has one) what was recorded, once per entry. */
async function tellStudent(tx: Transaction, studentPersonId: string, writerUserId: string, kind: 'rank' | 'exam' | 'skill' | 'attendance', entryId: string, title: string): Promise<void> {
  const [owner] = await tx.select({ userId: person.claimedByUserId }).from(person).where(eq(person.id, studentPersonId));
  if (!owner?.userId || owner.userId === writerUserId) return;
  await notify(tx, owner.userId, 'passport.entry-added', { kind, title: title.slice(0, 200) }, { key: `passport.entry-added:${entryId}` });
}

/** An examiner from the archive: any person of it (shown only while public, In scope 8). */
async function cleanExaminer(db: Executor, examinerPersonId: string | null | undefined, studentPersonId: string): Promise<string | null> {
  if (!examinerPersonId) return null;
  const [row] = await db.select({ id: person.id }).from(person).where(and(eq(person.id, examinerPersonId), isNull(person.deletedAt)));
  if (!row || row.id === studentPersonId) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { examinerPersonId: FIELD_LABELS.examinerPersonId! });
  return row.id;
}

export interface WrittenEntry {
  kind: PassportKind;
  id: string;
}

function audited(meta: RequestMeta, p: Principal) {
  return { actorUserId: p.user.id, actorRole: p.user.role, requestId: meta.requestId, ipHmac: meta.ipHmac };
}

/** passport.addRank: the student's teacher, or an admin of the issuing organization. */
export async function addRank(principal: Principal | null, raw: z.input<typeof addRankInput>, meta: RequestMeta): Promise<WrittenEntry> {
  const p = requireUser(principal);
  const input = parse(addRankInput, raw);
  const rank = cleanText(input.rank, 'rank', PASSPORT_TEXT_MAX);
  const date = cleanDate(input.date);
  return getDb().transaction(async (tx) => {
    const writer = await writerFor(tx, p.user.id, input.personId, input.organizationId ?? null);
    const [row] = await tx
      .insert(passportRank)
      .values({
        personId: input.personId,
        rank,
        organizationId: writer.organizationId,
        on: date.on,
        precision: date.precision,
        teacherPersonId: writer.teacherPersonId,
        createdByUserId: p.user.id,
      })
      .returning({ id: passportRank.id });
    await writeAudit(tx, { action: 'passport.add', ...audited(meta, p), subjectType: 'passport_rank', subjectId: row!.id, after: { personId: input.personId, precision: date.precision, organization: writer.organizationId !== null } });
    await tellStudent(tx, input.personId, p.user.id, 'rank', row!.id, rank);
    return { kind: 'rank' as const, id: row!.id };
  });
}

/** passport.addExam: the date, the awarded rank, optionally the examiner (a person of the archive) and the organization. */
export async function addExam(principal: Principal | null, raw: z.input<typeof addExamInput>, meta: RequestMeta): Promise<WrittenEntry> {
  const p = requireUser(principal);
  const input = parse(addExamInput, raw);
  const awardedRank = cleanText(input.awardedRank, 'awardedRank', PASSPORT_TEXT_MAX);
  const date = cleanDate(input.date);
  return getDb().transaction(async (tx) => {
    const writer = await writerFor(tx, p.user.id, input.personId, input.organizationId ?? null);
    const examiner = await cleanExaminer(tx, input.examinerPersonId, input.personId);
    const [row] = await tx
      .insert(passportExam)
      .values({
        personId: input.personId,
        awardedRank,
        on: date.on,
        precision: date.precision,
        examinerPersonId: examiner,
        organizationId: writer.organizationId,
        teacherPersonId: writer.teacherPersonId,
        createdByUserId: p.user.id,
      })
      .returning({ id: passportExam.id });
    await writeAudit(tx, {
      action: 'passport.add',
      ...audited(meta, p),
      subjectType: 'passport_exam',
      subjectId: row!.id,
      after: { personId: input.personId, precision: date.precision, examiner: examiner !== null, organization: writer.organizationId !== null },
    });
    await tellStudent(tx, input.personId, p.user.id, 'exam', row!.id, awardedRank);
    return { kind: 'exam' as const, id: row!.id };
  });
}

/** passport.addSkill: a form or skill, learning or approved. */
export async function addSkill(principal: Principal | null, raw: z.input<typeof addSkillInput>, meta: RequestMeta): Promise<WrittenEntry> {
  const p = requireUser(principal);
  const input = parse(addSkillInput, raw);
  const name = cleanText(input.name, 'name', PASSPORT_TEXT_MAX);
  const date = cleanDate(input.date);
  return getDb().transaction(async (tx) => {
    const writer = await writerFor(tx, p.user.id, input.personId, input.organizationId ?? null);
    const [row] = await tx
      .insert(passportSkill)
      .values({
        personId: input.personId,
        name,
        progress: input.progress,
        on: date.on,
        precision: date.precision,
        teacherPersonId: writer.teacherPersonId,
        organizationId: writer.organizationId,
        createdByUserId: p.user.id,
      })
      .returning({ id: passportSkill.id });
    await writeAudit(tx, { action: 'passport.add', ...audited(meta, p), subjectType: 'passport_skill', subjectId: row!.id, after: { personId: input.personId, progress: input.progress } });
    await tellStudent(tx, input.personId, p.user.id, 'skill', row!.id, name);
    return { kind: 'skill' as const, id: row!.id };
  });
}

const WRITER_FIELDS = ['rank', 'awardedRank', 'name', 'progress', 'date', 'organizationId', 'examinerPersonId'] as const;

/**
 * passport.updateEntry: whoever wrote a rank, an examination or a skill changes it (the student's
 * proposal, if any, is then settled); the student sends only `correction`, which waits for them
 * and tells them (DEFAULT M19, question 1).
 */
export async function updateEntry(principal: Principal | null, raw: z.input<typeof updateEntryInput>, meta: RequestMeta): Promise<WrittenEntry & { correction: boolean }> {
  const p = requireUser(principal);
  const input = parse(updateEntryInput, raw);
  return getDb().transaction(async (tx) => {
    const entry = await loadEntry(tx, input.kind, input.id, true);
    if (!entry || entry.status !== 'active') throw notFound();
    const own = await ownPersonId(tx, p.user.id);
    const table = sql.identifier(TABLES[input.kind]);
    if (own === entry.person_id) {
      // The student: a proposed correction only.
      if (WRITER_FIELDS.some((f) => input[f] !== undefined)) throw new ServiceError('FORBIDDEN', ONLY_A_CORRECTION);
      const note = block(input.correction);
      if (note.length < 1 || note.length > PASSPORT_NOTE_MAX) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { correction: FIELD_LABELS.correction! });
      await tx.execute(sql`UPDATE ${table} SET correction_note = ${note}, correction_at = now(), updated_at = now() WHERE id = ${entry.id}::uuid`);
      await writeAudit(tx, { action: 'passport.correction', ...audited(meta, p), subjectType: TABLES[input.kind], subjectId: entry.id });
      if (entry.created_by_user_id && entry.created_by_user_id !== p.user.id) {
        await notify(tx, entry.created_by_user_id, 'passport.correction', { kind: input.kind, title: entry.title.slice(0, 200) }, { key: `passport.correction:${entry.id}:${Date.now()}` });
      }
      return { kind: input.kind, id: entry.id, correction: true };
    }
    // Anyone who neither owns nor wrote it gets the answer of an entry that is not there.
    const may = await mayChange(tx, p.user.id, entry);
    if (may === 'no') throw notFound();
    if (input.correction !== undefined && input.correction !== null) throw new ServiceError('FORBIDDEN', 'Only the student proposes a correction to their own passport.');
    if (may === 'arbitration') throw new ServiceError('FORBIDDEN', ARBITRATION_READ_ONLY);
    const changes: Record<string, unknown> = {};
    const changed: string[] = [];
    if (input.date !== undefined) {
      const date = cleanDate(input.date);
      changes[input.kind === 'rank' ? 'awarded_on' : input.kind === 'exam' ? 'exam_on' : 'since_on'] = date.on;
      changes.precision = date.precision;
      changed.push('date');
    }
    if (input.organizationId !== undefined) {
      if (input.organizationId && !(await activeOrganization(tx, input.organizationId))) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { organizationId: FIELD_LABELS.organizationId! });
      }
      // An organization's admin who is not the teacher keeps the entry their organization's.
      if (!entry.teacher_person_id && input.organizationId !== entry.organization_id) throw new ServiceError('FORBIDDEN', 'An entry of an organization stays that organization’s.');
      changes.organization_id = input.organizationId ?? null;
      changed.push('organization');
    }
    if (input.kind === 'rank' && input.rank !== undefined) {
      changes.rank = cleanText(input.rank, 'rank', PASSPORT_TEXT_MAX);
      changed.push('rank');
    }
    if (input.kind === 'exam') {
      if (input.awardedRank !== undefined) {
        changes.awarded_rank = cleanText(input.awardedRank, 'awardedRank', PASSPORT_TEXT_MAX);
        changed.push('awardedRank');
      }
      if (input.examinerPersonId !== undefined) {
        changes.examiner_person_id = await cleanExaminer(tx, input.examinerPersonId, entry.person_id);
        changed.push('examiner');
      }
    }
    if (input.kind === 'skill') {
      if (input.name !== undefined) {
        changes.name = cleanText(input.name, 'name', PASSPORT_TEXT_MAX);
        changed.push('name');
      }
      if (input.progress !== undefined) {
        changes.progress = input.progress;
        changed.push('progress');
      }
    }
    const sets = Object.entries(changes).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`);
    // A change by whoever wrote it settles the student's proposal.
    await tx.execute(sql`UPDATE ${table} SET ${sql.join([...sets, sql`correction_note = NULL`, sql`correction_at = NULL`, sql`updated_at = now()`], sql`, `)} WHERE id = ${entry.id}::uuid`);
    await writeAudit(tx, { action: 'passport.update', ...audited(meta, p), subjectType: TABLES[input.kind], subjectId: entry.id, after: { fields: changed } });
    return { kind: input.kind, id: entry.id, correction: false };
  });
}

/** passport.withdrawEntry: whoever wrote it withdraws it; it is kept, shown to nobody. */
export async function withdrawEntry(principal: Principal | null, raw: z.input<typeof withdrawEntryInput>, meta: RequestMeta): Promise<WrittenEntry & { withdrawn: boolean }> {
  const p = requireUser(principal);
  const input = parse(withdrawEntryInput, raw);
  return getDb().transaction(async (tx) => {
    const entry = await loadEntry(tx, input.kind, input.id, true);
    if (!entry || entry.status === 'removed') throw notFound();
    const own = await ownPersonId(tx, p.user.id);
    if (own === entry.person_id && input.kind === 'attendance' && entry.status === 'pending' && entry.created_by_user_id === p.user.id) {
      // ADR 0046: the student takes back a claim the organizer has not decided yet.
      await tx.execute(sql`UPDATE event_attendance SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by_user_id = ${p.user.id}::uuid, updated_at = now() WHERE id = ${entry.id}::uuid`);
      await writeAudit(tx, { action: 'passport.withdraw', ...audited(meta, p), subjectType: 'event_attendance', subjectId: entry.id, before: { status: 'pending' }, after: { status: 'withdrawn' } });
      return { kind: input.kind, id: entry.id, withdrawn: true };
    }
    if (entry.status === 'pending' || entry.status === 'refused') throw notFound();
    if (own === entry.person_id) throw new ServiceError('FORBIDDEN', 'Your teacher withdraws what they recorded. You can make an entry private instead.');
    const may = await mayChange(tx, p.user.id, entry);
    if (may === 'arbitration') throw new ServiceError('FORBIDDEN', ARBITRATION_READ_ONLY);
    if (may === 'no') throw notFound();
    if (entry.status === 'withdrawn') return { kind: input.kind, id: entry.id, withdrawn: false };
    await tx.execute(sql`UPDATE ${sql.identifier(TABLES[input.kind])} SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by_user_id = ${p.user.id}::uuid, updated_at = now() WHERE id = ${entry.id}::uuid`);
    await writeAudit(tx, { action: 'passport.withdraw', ...audited(meta, p), subjectType: TABLES[input.kind], subjectId: entry.id, before: { status: 'active' }, after: { status: 'withdrawn' } });
    return { kind: input.kind, id: entry.id, withdrawn: true };
  });
}

/** passport.setVisibility: the student decides, for every entry of the own passport. */
export async function setVisibility(principal: Principal | null, raw: z.input<typeof setVisibilityInput>, meta: RequestMeta): Promise<WrittenEntry & { visibility: 'private' | 'public' }> {
  const p = requireUser(principal);
  const input = parse(setVisibilityInput, raw);
  return getDb().transaction(async (tx) => {
    const entry = await loadEntry(tx, input.kind, input.id, true);
    const own = await ownPersonId(tx, p.user.id);
    if (!entry || entry.status !== 'active' || own !== entry.person_id) throw notFound();
    if (entry.visibility !== input.visibility) {
      await tx.execute(sql`UPDATE ${sql.identifier(TABLES[input.kind])} SET visibility = ${input.visibility}, updated_at = now() WHERE id = ${entry.id}::uuid`);
      await writeAudit(tx, {
        action: 'passport.visibility',
        ...audited(meta, p),
        subjectType: TABLES[input.kind],
        subjectId: entry.id,
        before: { visibility: entry.visibility },
        after: { visibility: input.visibility },
      });
    }
    return { kind: input.kind, id: entry.id, visibility: input.visibility };
  });
}

// --- Grading photos (ADR 0046) -----------------------------------------------------------------------

const RANK_PHOTOS_NEED_PLAN = 'Photos on your ranks are part of Premium Student.';
const RANK_PHOTOS_NOT_YOURS = 'Choose photos from your own gallery.';

export const setRankPhotosInput = z.object({
  rankId: id(),
  photoIds: z
    .array(z.uuid({ error: RANK_PHOTOS_NOT_YOURS }))
    .max(PASSPORT_RANK_PHOTOS_MAX, { error: `Choose at most ${PASSPORT_RANK_PHOTOS_MAX} photos.` }),
});

/**
 * passport.setRankPhotos: the student puts up to three photos of their own gallery on one of their
 * active ranks, in the order given (an empty list takes them all off). Part of the full passport
 * (Premium Student, Professional Sifu); on a lower plan the photos already chosen are kept but not
 * shown (DEFAULT D08), and choosing again is refused at the plan. Audited with ids and a count only.
 */
export async function setRankPhotos(principal: Principal | null, raw: z.input<typeof setRankPhotosInput>, meta: RequestMeta): Promise<{ id: string; photoIds: string[] }> {
  const p = requireUser(principal);
  const input = parse(setRankPhotosInput, raw);
  const photoIds = [...new Set(input.photoIds)];
  return getDb().transaction(async (tx) => {
    const entry = await loadEntry(tx, 'rank', input.rankId, true);
    const own = await ownPersonId(tx, p.user.id);
    if (!entry || entry.status !== 'active' || own === null || own !== entry.person_id) throw notFound();
    const { level } = await planOf(tx, own);
    if (level !== 'full') throw new ServiceError('ENTITLEMENT_REQUIRED', RANK_PHOTOS_NEED_PLAN);
    if (photoIds.length > 0) {
      const found = await tx
        .select({ id: personPhoto.id })
        .from(personPhoto)
        .where(and(inArray(personPhoto.id, photoIds), eq(personPhoto.personId, own), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])));
      if (found.length !== photoIds.length) throw new ServiceError('BAD_REQUEST', RANK_PHOTOS_NOT_YOURS, { photoIds: RANK_PHOTOS_NOT_YOURS });
    }
    const before = await tx.select({ id: passportRankPhoto.photoId }).from(passportRankPhoto).where(eq(passportRankPhoto.rankId, entry.id)).orderBy(passportRankPhoto.position);
    const unchanged = before.length === photoIds.length && before.every((b, i) => b.id === photoIds[i]);
    if (!unchanged) {
      await tx.delete(passportRankPhoto).where(eq(passportRankPhoto.rankId, entry.id));
      if (photoIds.length > 0) await tx.insert(passportRankPhoto).values(photoIds.map((photoId, position) => ({ rankId: entry.id, photoId, position })));
      await writeAudit(tx, {
        action: 'passport.rank_photos',
        ...audited(meta, p),
        subjectType: 'passport_rank',
        subjectId: entry.id,
        before: { photos: before.length },
        after: { photos: photoIds.length },
      });
    }
    return { id: entry.id, photoIds };
  });
}

// --- Certificates ------------------------------------------------------------------------------------

const CERTIFICATE_SIZES = ['96', '512', 'full'] as const;

/** Deletes a certificate's files (best effort; the row says what was there). */
export async function deleteCertificateFiles(store: ObjectStore, key: string, certificateId: string): Promise<void> {
  for (const size of CERTIFICATE_SIZES) {
    await store.delete(`${key}/${size}`).catch(() => {
      logger().error(`[passport] a stored file of certificate ${certificateId} could not be removed`);
    });
  }
}

/**
 * passport.uploadCertificate: the student's scanned certificate or diploma (DEFAULT M19, question 4:
 * a JPEG, PNG or WebP image; no PDF in the pilot), processed as a gallery photo (no EXIF, GPS, XMP or
 * IPTC) and kept in the private store, private unless the student says public (DEFAULT M19, question 5).
 */
export async function uploadCertificate(
  principal: Principal | null,
  raw: z.input<typeof certificateUploadInput>,
  meta: RequestMeta,
  store: ObjectStore = getEvidenceStore(),
): Promise<{ id: string; visibility: 'private' | 'public'; image: CertificateImageDto }> {
  const p = requireUser(principal);
  const input = parse(certificateUploadInput, raw);
  const db = getDb();
  const own = await ownPersonId(db, p.user.id);
  if (!own) throw notFound(NO_PROFILE);
  const title = oneLine(input.title);
  if (title.length > PASSPORT_TITLE_MAX) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { title: FIELD_LABELS.title! });
  const date = cleanDate(input.date);
  const bytes = await fileBytes(input.file);
  let rendered: Awaited<ReturnType<typeof renderGalleryPhoto>>;
  try {
    rendered = await renderGalleryPhoto(bytes);
  } catch (error) {
    if (error instanceof PhotoRefused) {
      const { code, message } = refusalMessage(error);
      throw new ServiceError(code, message, { file: message });
    }
    throw error;
  }
  const full = rendered.full;
  const content = sha256(full.bytes);
  const key = newStorageKey('certificates');
  try {
    await putRenditions(store, key, rendered);
    const row = await db.transaction(async (tx) => {
      // The person row is the lock of its passport's certificates (the count below and the write).
      await tx.execute(sql`SELECT 1 FROM person WHERE id = ${own}::uuid FOR UPDATE`);
      const counted = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM passport_certificate WHERE person_id = ${own}::uuid AND status = 'active'`);
      if ((counted.rows[0]?.n ?? 0) >= PASSPORT_CERTIFICATES_MAX) {
        throw new ServiceError('CONFLICT', `Your passport holds ${PASSPORT_CERTIFICATES_MAX} certificates. Remove one before you add another.`, { file: `At most ${PASSPORT_CERTIFICATES_MAX} certificates.` });
      }
      const [written] = await tx
        .insert(passportCertificate)
        .values({
          personId: own,
          visibility: input.visibility,
          title: title || null,
          on: date.on,
          precision: date.precision,
          storageKey: key,
          sha256: content,
          width: full.width,
          height: full.height,
          sizeBytes: full.bytes.byteLength,
          createdByUserId: p.user.id,
        })
        .returning({ id: passportCertificate.id });
      await writeAudit(tx, {
        action: 'passport.certificate_upload',
        ...audited(meta, p),
        subjectType: 'passport_certificate',
        subjectId: written!.id,
        after: { visibility: input.visibility, width: full.width, height: full.height, sizeBytes: full.bytes.byteLength, sha256: content },
      });
      return written!;
    });
    return { id: row.id, visibility: input.visibility, image: certificateImage(row.id, content, full.width, full.height)! };
  } catch (error) {
    await deleteCertificateFiles(store, key, 'new');
    throw error;
  }
}

/** passport.removeCertificate: the student's own; the row is kept (withdrawn), the files go. */
export async function removeCertificate(
  principal: Principal | null,
  raw: z.input<typeof certificateIdInput>,
  meta: RequestMeta,
  store: ObjectStore = getEvidenceStore(),
): Promise<{ id: string; removed: boolean }> {
  const p = requireUser(principal);
  const input = parse(certificateIdInput, raw);
  const outcome = await getDb().transaction(async (tx) => {
    const own = await ownPersonId(tx, p.user.id);
    const [row] = await tx
      .select({ id: passportCertificate.id, personId: passportCertificate.personId, status: passportCertificate.status, key: passportCertificate.storageKey })
      .from(passportCertificate)
      .where(eq(passportCertificate.id, input.id))
      .for('update');
    if (!row || row.status === 'removed' || own !== row.personId) throw notFound('No such certificate.');
    if (row.status === 'withdrawn') return { key: null as string | null };
    await tx.update(passportCertificate).set({ status: 'withdrawn', withdrawnAt: new Date(), withdrawnByUserId: p.user.id, updatedAt: new Date() }).where(eq(passportCertificate.id, row.id));
    await writeAudit(tx, { action: 'passport.certificate_remove', ...audited(meta, p), subjectType: 'passport_certificate', subjectId: row.id, before: { status: 'active' }, after: { status: 'withdrawn' } });
    return { key: row.key };
  });
  if (outcome.key) await deleteCertificateFiles(store, outcome.key, input.id);
  return { id: input.id, removed: outcome.key !== null };
}

/**
 * One rendition for GET /api/certificates/<id>/<hash>/<size>.webp. A public certificate that the
 * profile shows (public entry, public person, a plan with the full passport) for everyone, cached
 * `public, no-cache`; otherwise only the student's own account and their teachers (an established
 * relationship), `private, no-store`; null (404) for everyone else, one answer for all (plan §6.4).
 * Read through the app from the private store; never a presigned address.
 */
export async function openCertificate(
  principal: Principal | null,
  address: { id: string; hash: string; file: string },
  store: ObjectStore = getEvidenceStore(),
  options: OpenPhotoOptions = {},
): Promise<PhotoFile | null> {
  if (!PHOTO_ADDRESS.id.safeParse(address.id).success || !PHOTO_ADDRESS.hash.safeParse(address.hash).success || !PHOTO_ADDRESS.file.safeParse(address.file).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ key: passportCertificate.storageKey, sha: passportCertificate.sha256, status: passportCertificate.status, visibility: passportCertificate.visibility, personId: passportCertificate.personId })
    .from(passportCertificate)
    .where(eq(passportCertificate.id, address.id));
  if (!row || row.status !== 'active' || !row.sha.startsWith(address.hash)) return null;
  let open = false;
  if (row.visibility === 'public') {
    const shown = await db.execute(sql`SELECT 1 AS one FROM v_public_passport WHERE id = ${address.id}::uuid AND kind = 'certificate'`);
    open = shown.rows.length > 0 && (await planOf(db, row.personId)).level === 'full';
  }
  let isPublic = open;
  if (!open && principal) {
    const own = await ownPersonId(db, principal.user.id);
    if (own === row.personId || (own && (await relationshipOf(db, own, row.personId)) !== null)) open = true;
    isPublic = false;
  }
  if (!open) return null;
  if (etagMatches(options.ifNoneMatch, photoEtag(row.sha))) return { notModified: true, sha256: row.sha, public: isPublic };
  const bytes = await readObjectBytes(store, renditionFile(row.key, address.file, true), {
    timeoutMs: options.timeoutMs ?? PHOTO_READ_TIMEOUT_MS,
    maxBytes: PHOTO_RENDITION_MAX_BYTES,
    signal: options.signal,
  });
  if (!bytes) return null;
  return { notModified: false, bytes, sha256: row.sha, public: isPublic };
}

// --- Attendance --------------------------------------------------------------------------------------

/**
 * passport.markAttendance: the organizer or an instructor of a past published event marks their
 * own established students (verified) as attending; once per event and person.
 */
export async function markAttendance(principal: Principal | null, raw: z.input<typeof markAttendanceInput>, meta: RequestMeta): Promise<{ eventId: string; marked: number }> {
  const p = requireUser(principal);
  const parsed = markAttendanceInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'eventId')) throw notFound('No such event.');
    throw fieldErrors(parsed.error);
  }
  const input = parsed.data;
  return getDb().transaction(async (tx) => {
    const own = await ownPersonId(tx, p.user.id);
    if (!own) throw notFound('No such event.');
    const found = await tx.execute<{ id: string; title: string; status: string; past: boolean; teaches: boolean }>(sql`
      SELECT e.id, e.title, e.status, (e.ends_at < now()) AS past,
             (e.organizer_person_id = ${own}::uuid OR EXISTS (SELECT 1 FROM event_instructor i WHERE i.event_id = e.id AND i.person_id = ${own}::uuid)) AS teaches
        FROM event e WHERE e.id = ${input.eventId}::uuid`);
    const ev = found.rows[0];
    if (!ev || !ev.teaches || ev.status === 'removed') throw notFound('No such event.');
    if (ev.status !== 'published' || !ev.past) throw new ServiceError('CONFLICT', EVENT_NOT_PAST);
    const people = [...new Set(input.personIds)];
    for (const personId of people) {
      if ((await relationshipOf(tx, own, personId)) !== 'verified') {
        throw new ServiceError('BAD_REQUEST', 'Attendance is marked only for your own established students.', { personIds: FIELD_LABELS.personIds! });
      }
    }
    let marked = 0;
    for (const personId of people) {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO event_attendance (id, person_id, event_id, teacher_person_id, created_by_user_id)
        VALUES (${uuidv7()}::uuid, ${personId}::uuid, ${ev.id}::uuid, ${own}::uuid, ${p.user.id}::uuid)
        ON CONFLICT DO NOTHING RETURNING id`);
      // ADR 0046: the student's own claim (waiting or refused) becomes the organizer's record.
      const row =
        inserted.rows[0] ??
        (
          await tx.execute<{ id: string }>(sql`
            UPDATE event_attendance SET status = 'active', teacher_person_id = ${own}::uuid, decided_at = now(), decided_by_user_id = ${p.user.id}::uuid, updated_at = now()
             WHERE event_id = ${ev.id}::uuid AND person_id = ${personId}::uuid AND status IN ('pending', 'refused') RETURNING id`)
        ).rows[0];
      if (!row) continue;
      marked += 1;
      await writeAudit(tx, { action: 'passport.attendance', ...audited(meta, p), subjectType: 'event_attendance', subjectId: row.id, after: { eventId: ev.id, personId } });
      await tellStudent(tx, personId, p.user.id, 'attendance', row.id, ev.title);
    }
    return { eventId: ev.id, marked };
  });
}

// --- Attendance claims (owner decision 2026-11-18, docs/adr/0046-passport-extras.md) ----------------

/** At most this many claims wait for organizers at a time, per student. */
export const ATTENDANCE_CLAIMS_PENDING_MAX = 20;
/** The past events a student can choose from: the latest ones. */
export const CLAIMABLE_EVENTS_LIMIT = 100;
const CLAIM_NEEDS_PLAN = 'Asking an organizer to confirm your attendance is part of Premium Student.';
const CLAIM_TOO_MANY = `You have ${ATTENDANCE_CLAIMS_PENDING_MAX} requests waiting for organizers. Wait for an answer, or take one back, before you ask again.`;
const CLAIM_EXISTS = 'This event is already in your passport, or you already asked its organizer.';
const CLAIM_OWN_EVENT = 'You organized or taught at this event. Mark your students from your passport page instead.';

export const claimAttendanceInput = z.object({ eventId: z.uuid({ error: 'No such event.' }) });
export const decideAttendanceInput = z.object({ id: id('No such request.'), decision: z.enum(['approve', 'refuse']) });

export interface ClaimableEvent {
  id: string;
  slug: string;
  title: string;
  kind: EventKind;
  kindLabel: string;
  dateText: string;
}

export interface AttendanceClaimOptions {
  /** Whether the plan of the account lets it claim (the full passport). */
  allowed: boolean;
  /** Past published events the student has not claimed or been marked at, newest first. */
  events: ClaimableEvent[];
  pending: number;
  limit: number;
}

/** passport.claimable: the past events the signed-in student may say they attended. */
export async function attendanceClaimable(principal: Principal | null): Promise<AttendanceClaimOptions> {
  const p = requireUser(principal);
  const db = getDb();
  const own = await ownPersonId(db, p.user.id);
  if (!own) throw notFound(NO_PROFILE);
  const { level } = await planOf(db, own);
  const pending = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM event_attendance WHERE person_id = ${own}::uuid AND status = 'pending'`);
  if (level !== 'full') return { allowed: false, events: [], pending: pending.rows[0]?.n ?? 0, limit: ATTENDANCE_CLAIMS_PENDING_MAX };
  const rows = await db.execute<{ id: string; slug: string; title: string; kind: EventKind; day: string }>(sql`
    SELECT e.id, e.slug, e.title, e.kind, to_char((e.starts_at AT TIME ZONE e.timezone)::date, 'YYYY-MM-DD') AS day
      FROM event e
     WHERE e.status = 'published' AND e.ends_at < now()
       AND e.organizer_person_id IS DISTINCT FROM ${own}::uuid
       AND NOT EXISTS (SELECT 1 FROM event_instructor i WHERE i.event_id = e.id AND i.person_id = ${own}::uuid)
       AND NOT EXISTS (SELECT 1 FROM event_attendance a WHERE a.event_id = e.id AND a.person_id = ${own}::uuid AND a.status IN ('active', 'pending', 'refused'))
     ORDER BY e.starts_at DESC, e.id
     LIMIT ${CLAIMABLE_EVENTS_LIMIT}`);
  return {
    allowed: true,
    events: rows.rows.map((e) => ({ id: e.id, slug: e.slug, title: e.title, kind: e.kind, kindLabel: EVENT_KIND_LABELS[e.kind], dateText: formatPartialDate(e.day) })),
    pending: pending.rows[0]?.n ?? 0,
    limit: ATTENDANCE_CLAIMS_PENDING_MAX,
  };
}

/** The accounts told about a new claim: the Sifu organizer, or the admins of the organizing organization. */
async function claimRecipients(db: Executor, eventId: string): Promise<string[]> {
  const result = await db.execute<{ user_id: string }>(sql`
    SELECT e.organizer_user_id AS user_id FROM event e WHERE e.id = ${eventId}::uuid AND e.organizer_user_id IS NOT NULL
    UNION
    SELECT a.user_id FROM event e
      JOIN organization_admin a ON a.organization_id = e.organization_id AND a.revoked_at IS NULL
      JOIN organization o ON o.id = e.organization_id AND o.status = 'active' AND o.deleted_at IS NULL
     WHERE e.id = ${eventId}::uuid`);
  return result.rows.map((r) => r.user_id);
}

/**
 * passport.attendance.claim: a student on a plan with the full passport says they attended a past
 * published event. The claim waits, shown only in their own passport, until the organizer, an
 * instructor or an admin of the organizing organization decides (ADR 0046).
 */
export async function claimAttendance(principal: Principal | null, raw: z.input<typeof claimAttendanceInput>, meta: RequestMeta): Promise<{ id: string; eventId: string }> {
  const p = requireUser(principal);
  const parsed = claimAttendanceInput.safeParse(raw);
  if (!parsed.success) throw notFound('No such event.');
  const input = parsed.data;
  return getDb().transaction(async (tx) => {
    const own = await ownPersonId(tx, p.user.id);
    if (!own) throw notFound(NO_PROFILE);
    // Serialises one student's claims, so the waiting limit holds.
    await tx.execute(sql`SELECT id FROM person WHERE id = ${own}::uuid FOR UPDATE`);
    const { level } = await planOf(tx, own);
    if (level !== 'full') throw new ServiceError('ENTITLEMENT_REQUIRED', CLAIM_NEEDS_PLAN);
    const found = await tx.execute<{ id: string; title: string; status: string; past: boolean; teaches: boolean }>(sql`
      SELECT e.id, e.title, e.status, (e.ends_at < now()) AS past,
             (e.organizer_person_id = ${own}::uuid OR EXISTS (SELECT 1 FROM event_instructor i WHERE i.event_id = e.id AND i.person_id = ${own}::uuid)) AS teaches
        FROM event e WHERE e.id = ${input.eventId}::uuid`);
    const ev = found.rows[0];
    if (!ev || ev.status === 'removed') throw notFound('No such event.');
    if (ev.status !== 'published' || !ev.past) throw new ServiceError('CONFLICT', EVENT_NOT_PAST);
    if (ev.teaches) throw new ServiceError('CONFLICT', CLAIM_OWN_EVENT);
    const waiting = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM event_attendance WHERE person_id = ${own}::uuid AND status = 'pending'`);
    if ((waiting.rows[0]?.n ?? 0) >= ATTENDANCE_CLAIMS_PENDING_MAX) throw new ServiceError('CONFLICT', CLAIM_TOO_MANY);
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO event_attendance (id, person_id, event_id, status, claimed, created_by_user_id)
      VALUES (${uuidv7()}::uuid, ${own}::uuid, ${ev.id}::uuid, 'pending', true, ${p.user.id}::uuid)
      ON CONFLICT DO NOTHING RETURNING id`);
    const row = inserted.rows[0];
    if (!row) throw new ServiceError('CONFLICT', CLAIM_EXISTS);
    await writeAudit(tx, { action: 'passport.attendance_claim', ...audited(meta, p), subjectType: 'event_attendance', subjectId: row.id, after: { eventId: ev.id, status: 'pending' } });
    for (const userId of await claimRecipients(tx, ev.id)) {
      if (userId === p.user.id) continue;
      await notify(tx, userId, 'passport.attendance-claimed', { title: ev.title.slice(0, 200) }, { key: `passport.attendance-claimed:${row.id}` });
    }
    return { id: row.id, eventId: ev.id };
  });
}

export interface AttendanceClaim {
  id: string;
  event: { id: string; slug: string; title: string; dateText: string };
  /** The student, by their primary name; their page only while it is public. */
  student: { name: { value: string; lang: string | null }; slug: string | null };
  claimedAt: string;
}

/** Whether the account decides claims on this event: its organizer, an instructor, or an admin of the organizing organization. */
const DECIDES = (userId: string, own: string | null) => sql`(
  e.organizer_user_id = ${userId}::uuid
  OR (${own}::uuid IS NOT NULL AND (e.organizer_person_id = ${own}::uuid OR EXISTS (SELECT 1 FROM event_instructor i WHERE i.event_id = e.id AND i.person_id = ${own}::uuid)))
  OR EXISTS (SELECT 1 FROM organization_admin oa JOIN organization o ON o.id = oa.organization_id AND o.status = 'active' AND o.deleted_at IS NULL
              WHERE oa.organization_id = e.organization_id AND oa.user_id = ${userId}::uuid AND oa.revoked_at IS NULL))`;

/** At most this many waiting claims are listed at once (oldest first). */
export const ATTENDANCE_CLAIMS_LIST_LIMIT = 100;

/** passport.attendance.claims: the claims waiting on events this account decides, oldest first. */
export async function attendanceClaims(principal: Principal | null): Promise<{ claims: AttendanceClaim[] }> {
  const p = requireUser(principal);
  const db = getDb();
  const own = await ownPersonId(db, p.user.id);
  const rows = await db.execute<{ id: string; event_id: string; event_slug: string; event_title: string; day: string; name: string | null; lang: string | null; slug: string | null; created_at: string | Date }>(sql`
    SELECT a.id, e.id AS event_id, e.slug AS event_slug, e.title AS event_title, to_char((e.starts_at AT TIME ZONE e.timezone)::date, 'YYYY-MM-DD') AS day,
           (SELECT n.value FROM person_name n WHERE n.person_id = a.person_id AND n.is_primary LIMIT 1) AS name,
           (SELECT n.lang FROM person_name n WHERE n.person_id = a.person_id AND n.is_primary LIMIT 1) AS lang,
           pp.slug, a.created_at
      FROM event_attendance a
      JOIN event e ON e.id = a.event_id AND e.status = 'published'
      JOIN person sp ON sp.id = a.person_id AND sp.deleted_at IS NULL
      LEFT JOIN v_public_person pp ON pp.id = a.person_id
     WHERE a.status = 'pending' AND ${DECIDES(p.user.id, own)}
     ORDER BY a.created_at, a.id
     LIMIT ${ATTENDANCE_CLAIMS_LIST_LIMIT}`);
  return {
    claims: rows.rows.map((r) => ({
      id: r.id,
      event: { id: r.event_id, slug: r.event_slug, title: r.event_title, dateText: formatPartialDate(r.day) },
      student: { name: { value: r.name ?? 'A student', lang: r.lang }, slug: r.slug },
      claimedAt: iso(r.created_at),
    })),
  };
}

/**
 * passport.attendance.decide: the organizer, an instructor or an admin of the organizing
 * organization approves a claim (it joins the passport, "Confirmed by the organizer") or refuses
 * it (kept, shown to nobody). Audited; the student is told.
 */
export async function decideAttendanceClaim(
  principal: Principal | null,
  raw: z.input<typeof decideAttendanceInput>,
  meta: RequestMeta,
): Promise<{ id: string; status: 'active' | 'refused' }> {
  const p = requireUser(principal);
  const input = parse(decideAttendanceInput, raw);
  return getDb().transaction(async (tx) => {
    const own = await ownPersonId(tx, p.user.id);
    const found = await tx.execute<{ id: string; person_id: string; status: string; title: string; teaches: boolean; may: boolean }>(sql`
      SELECT a.id, a.person_id, a.status, e.title,
             (${own}::uuid IS NOT NULL AND (e.organizer_person_id = ${own}::uuid OR EXISTS (SELECT 1 FROM event_instructor i WHERE i.event_id = e.id AND i.person_id = ${own}::uuid))) AS teaches,
             ${DECIDES(p.user.id, own)} AS may
        FROM event_attendance a JOIN event e ON e.id = a.event_id AND e.status = 'published'
       WHERE a.id = ${input.id}::uuid
         FOR UPDATE OF a`);
    const claim = found.rows[0];
    if (!claim || !claim.may || (claim.status !== 'pending' && claim.status !== 'active' && claim.status !== 'refused')) throw notFound('No such request.');
    const status = input.decision === 'approve' ? 'active' : 'refused';
    if (claim.status !== 'pending') {
      if (claim.status === status) return { id: claim.id, status };
      throw new ServiceError('CONFLICT', 'This request was already answered.');
    }
    await tx.execute(sql`
      UPDATE event_attendance
         SET status = ${status}, decided_at = now(), decided_by_user_id = ${p.user.id}::uuid,
             teacher_person_id = ${status === 'active' && claim.teaches ? own : null}::uuid, updated_at = now()
       WHERE id = ${claim.id}::uuid`);
    await writeAudit(tx, {
      action: 'passport.attendance_decide',
      ...audited(meta, p),
      subjectType: 'event_attendance',
      subjectId: claim.id,
      before: { status: 'pending' },
      after: { status },
    });
    const owner = await accountOf(tx, claim.person_id);
    if (owner && owner !== p.user.id) {
      await notify(tx, owner, 'passport.attendance-decided', { title: claim.title.slice(0, 200), approved: status === 'active' }, { key: `passport.attendance-decided:${claim.id}` });
    }
    return { id: claim.id, status };
  });
}

// --- Staff ---------------------------------------------------------------------------------------------

/** passport.remove: staff with a verified second factor, with a reason (audited); the owner is told. */
export async function removePassportEntry(
  principal: Principal | null,
  raw: z.input<typeof passportRemoveInput>,
  meta: RequestMeta,
  store: ObjectStore = getEvidenceStore(),
): Promise<WrittenEntry & { removed: boolean }> {
  const p = requireStaff2FA(principal);
  const input = parse(passportRemoveInput, raw);
  const reason = block(input.reason);
  const message = 'Say why the entry is removed: the reason is kept in the audit log and sent to its owner.';
  if (reason.length === 0) throw new ServiceError('BAD_REQUEST', message, { reason: message });
  if (reason.length > PASSPORT_NOTE_MAX) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: FIELD_LABELS.reason! });
  const outcome = await getDb().transaction(async (tx) => {
    const entry = await loadEntry(tx, input.kind, input.id, true);
    if (!entry) throw notFound();
    if (entry.status === 'removed') return { removed: false, key: null as string | null };
    await tx.execute(sql`
      UPDATE ${sql.identifier(TABLES[input.kind])}
         SET status = 'removed', removed_at = now(), removed_by_user_id = ${p.user.id}::uuid, removal_reason = ${reason}, updated_at = now()
       WHERE id = ${entry.id}::uuid`);
    await writeAudit(tx, {
      action: 'passport.remove',
      ...audited(meta, p),
      subjectType: TABLES[input.kind],
      subjectId: entry.id,
      before: { status: entry.status },
      after: { status: 'removed' },
      reason,
    });
    const owner = await accountOf(tx, entry.person_id);
    if (owner && owner !== p.user.id) await notify(tx, owner, 'content.removed', { content: 'passport_entry', reason }, { key: `content.removed:passport_entry:${entry.id}` });
    let key: string | null = null;
    if (input.kind === 'certificate') {
      const [c] = await tx.select({ key: passportCertificate.storageKey }).from(passportCertificate).where(eq(passportCertificate.id, entry.id));
      key = c?.key ?? null;
    }
    return { removed: true, key };
  });
  if (outcome.key) await deleteCertificateFiles(store, outcome.key, input.id);
  return { kind: input.kind, id: input.id, removed: outcome.removed };
}
