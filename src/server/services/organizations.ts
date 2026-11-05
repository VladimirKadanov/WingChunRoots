// Organizations (milestone M15; specification §4.3, §9, §10.3; plan §6.2, §6.4, §6.8;
// docs/adr/0018-organizations.md).
//
// Public reads (anyone, no session needed; public DTOs only, src/server/dto/organizations.ts):
//   organizations.list   approved organizations (v_public_organization)
//   organizations.get    an approved organization's page: its current members who are public people
//                        (DEFAULT D03) and the public schools that accepted a link, by city only
//
// The applicant and the organization's admins (accounts; DEFAULT D12: authority is
// organization_admin, never a person's membership):
//   organizations.mine     the account's organizations and whether it may apply
//   organizations.apply    an application (official name, kind, leader's name and title, website,
//                          headquarters' country, approximate number of schools, an optional
//                          supporting document kept as private evidence: DEFAULT D13/D25, and a
//                          note): a pending organization, its applicant its owner, and an
//                          organization_application case in the review queue
//   organizations.manage   one organization for its dashboard: approval, plan, details, admins,
//                          members, schools, the application's case
//   organizations.update   the details. DEFAULT (no D number, ADR 0018): a pending organization edits
//                          only its own application (every field); an approved one edits its
//                          website, leader and number of schools, never its official name, kind or
//                          country (a new review would be needed: a later milestone)
//   organizations.addAdmin / removeAdmin
//                          an owner adds an existing account as an admin, removes an admin; an admin
//                          may leave. Approved organizations only
//   organizations.addMember / endMember
//                          a current public person as a member (leader, official or member), or the
//                          end of a membership (kept as history: ends_on)
//   organizations.requestSchool / endSchoolLink
//                          ask a public school to link to the organization; end a link (either side)
// The school's side (the account that listed the school):
//   organizations.schoolLinks        the links its schools were asked for or accepted
//   organizations.answerSchoolLink   accept or refuse; the school and its pin never change (DEFAULT D12)
//
// Approval, plan and verification are three states, shown apart (DEFAULT D04): the reviewers
// approve the application (organization-review.ts); an administrator gives a test or
// complimentary Federation plan (organization-grants.ts; DEFAULT D09: never charged); no
// organization action creates, verifies or edits a teaching relationship or a person's
// visibility (DEFAULT D12). Member and school administration needs the approval and an active
// Federation grant; revoking the grant hides only that administration (DEFAULT D08): the members,
// the links and the public page stay.
//
// Authorization: every procedure here checks the account itself. An organization's admin reaches
// only the organizations they administer; any other id is 404 (the same answer as for none), so one
// organization's admin can never read or edit another's data. Staff roles give no authority here.
//
// Logs and audit rows carry ids, statuses and field names; never a leader's name, a website, an
// e-mail address or a note (plan §6.4).

import { randomBytes } from 'node:crypto';

import { and, asc, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import { isoDay, parseIsoDay } from '../../lib/dates';
import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, ORGANIZATIONS_TAG, personTag, SCHOOLS_TAG, tagCacheEntry } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authUser, organization, organizationAdmin, organizationMembership, organizationSchool, reviewCase, reviewEvent, reviewNote, school } from '../db/schema';
import {
  EVIDENCE_MAX_FILES_PER_CASE,
  OPEN_REVIEW_CASE_STATUSES,
  type ORGANIZATION_ADMIN_ROLES,
  ORGANIZATION_KINDS,
  ORGANIZATION_ROLES,
  type ORGANIZATION_SCHOOL_STATUSES,
  ORGANIZATION_SCHOOLS_ESTIMATE_MAX,
  type ORGANIZATION_STATUSES,
} from '../db/schema/common';
import { type OrganizationListDto, type OrganizationPageDto, toPublicOrganizationList, toPublicOrganizationPage } from '../dto/organizations';
import { type Executor, organizationPlan } from '../entitlements/access';
import { PLANS } from '../entitlements/plans';
import { CLAIM_STATUS_LABELS, type ReviewCaseStatus } from '../templates/review';
import type { Transaction } from '../jobs/outbox';
import type { NotificationKind } from '../templates/catalog';
import { COUNTRIES, isCountryCode } from './account';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { type EvidenceFileView, fileView, filesOfCases, linkOptionalFilesToCase } from './evidence';
import { cleanName } from './names';
import { photoOf, publicPhotoRefs } from './photo-refs';
import { idempotencyKey, keyReused } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';
import { notify, notifyEach } from './notify';

// --- Words ---------------------------------------------------------------------------------------

export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];
export type OrganizationAdminRole = (typeof ORGANIZATION_ADMIN_ROLES)[number];
export type OrganizationMemberRole = (typeof ORGANIZATION_ROLES)[number];
export type SchoolLinkStatus = (typeof ORGANIZATION_SCHOOL_STATUSES)[number];

export const ORGANIZATION_KIND_LABELS: Record<OrganizationKind, string> = {
  federation: 'Federation',
  association: 'Association',
  school_group: 'Group of schools',
};

/** The approval, in words (DEFAULT D04: never the plan, never a verification). */
export const APPROVAL_LABELS: Record<OrganizationStatus, string> = {
  pending: 'Waiting for review',
  active: 'Approved',
  rejected: 'Declined',
  suspended: 'Suspended',
};

export const MEMBER_ROLE_LABELS: Record<OrganizationMemberRole, string> = { leader: 'Leader', admin: 'Official', member: 'Member' };
export const ADMIN_ROLE_LABELS: Record<OrganizationAdminRole, string> = { owner: 'Owner', admin: 'Admin' };
export const LINK_STATUS_LABELS: Record<SchoolLinkStatus, string> = {
  pending: 'Waiting for the school',
  accepted: 'Linked',
  refused: 'Refused by the school',
  ended: 'Ended',
};

/** What the dashboard says when the administration needs the Federation plan (no urgency, plan §5.6). */
export const FEDERATION_NEEDED =
  'Member and school administration is part of the Federation plan. In the pilot an administrator of WingChunRoots can give it as a test plan; nothing is charged.';

// --- Limits --------------------------------------------------------------------------------------

export const ORGANIZATION_NAME_MAX = 160;
export const ORGANIZATION_NOTE_MAX = 2000;
/** At most this many applications from one account in 24 hours. */
export const ORGANIZATION_APPLICATIONS_PER_DAY = 3;
/** The most members and schools an organization page and dashboard list. */
export const ORGANIZATION_LIST_LIMIT = 200;

const NO_ORGANIZATION = 'No such organization.';
const notFound = () => new ServiceError('NOT_FOUND', NO_ORGANIZATION);
const NO_LINK = 'No such link.';

// --- Input ---------------------------------------------------------------------------------------

const text = (max: number, message: string) =>
  z
    .string()
    .max(max * 2, { error: message })
    .transform((s) => cleanName(s))
    .refine((s) => s.length <= max, { error: message });

const optionalText = (max: number, message: string) =>
  text(max, message)
    .nullish()
    .transform((s) => (s ? s : null));

/** An official name in Latin script (plan §5.3): Latin letters, digits and the usual punctuation. */
const ORGANIZATION_NAME = /^[\p{Script=Latin}\p{Script=Inherited}0-9\s'’.,&()\-/:]+$/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
/** A person's name in Latin script: letters, accents and the usual separators. */
const LATIN_PERSON = /^[\p{Script=Latin}\p{Script=Inherited}\s'’.\-·]+$/u;

export const organizationFieldsInput = z.object({
  name: text(ORGANIZATION_NAME_MAX, `Use at most ${ORGANIZATION_NAME_MAX} characters.`)
    .refine((s) => s.length >= 2, { error: 'Give the official name of the organization.' })
    .refine((s) => ORGANIZATION_NAME.test(s) && LATIN_LETTER.test(s), { error: 'Write the official name in Latin letters (digits and & , . - ( ) are fine).' }),
  kind: z.enum(ORGANIZATION_KINDS, { error: 'Choose what kind of organization it is.' }),
  leaderName: text(120, 'Use at most 120 characters.')
    .refine((s) => s.length >= 2, { error: 'Give the name of the organization’s leader.' })
    .refine((s) => LATIN_PERSON.test(s) && LATIN_LETTER.test(s), { error: 'Write the leader’s name in Latin letters.' }),
  leaderTitle: optionalText(80, 'Use at most 80 characters.'),
  websiteUrl: optionalText(300, 'Use at most 300 characters.').refine((s) => s === null || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s), {
    error: 'Give the full address of the website, starting with https://.',
  }),
  countryCode: z
    .string({ error: 'Choose the country of the headquarters.' })
    .trim()
    .toUpperCase()
    .refine((s) => isCountryCode(s), { error: 'Choose the country of the headquarters.' }),
  schoolsEstimate: z
    .number({ error: 'Give the approximate number of affiliated schools, as a whole number.' })
    .int({ error: 'Give the approximate number of affiliated schools, as a whole number.' })
    .min(0, { error: 'Give a number from 0 up.' })
    .max(ORGANIZATION_SCHOOLS_ESTIMATE_MAX, { error: `Give a number up to ${ORGANIZATION_SCHOOLS_ESTIMATE_MAX}.` }),
});
export type OrganizationFieldsInput = z.input<typeof organizationFieldsInput>;

export const organizationApplyInput = organizationFieldsInput.extend({
  /** The optional supporting document (registration, charter, brand ownership): evidence files. */
  evidenceIds: z
    .array(z.uuid({ error: 'Upload the files again.' }))
    .max(EVIDENCE_MAX_FILES_PER_CASE, { error: `Attach at most ${EVIDENCE_MAX_FILES_PER_CASE} files.` })
    .default([]),
  note: z
    .string()
    .max(ORGANIZATION_NOTE_MAX * 2, { error: `Use at most ${ORGANIZATION_NOTE_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= ORGANIZATION_NOTE_MAX, { error: `Use at most ${ORGANIZATION_NOTE_MAX} characters.` })
    .nullish()
    .transform((s) => (s ? s : null)),
  idempotencyKey,
});
export type OrganizationApplyInput = z.input<typeof organizationApplyInput>;

export const organizationIdInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }) });
export const organizationSlugInput = z.object({ slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9-]+$/, { error: NO_ORGANIZATION }) });
export const organizationUpdateInput = organizationFieldsInput.extend({ organizationId: z.uuid({ error: NO_ORGANIZATION }) });

export const addAdminInput = z.object({
  organizationId: z.uuid({ error: NO_ORGANIZATION }),
  email: z.string({ error: 'Enter the e-mail address of the account.' }).trim().toLowerCase().max(320).check(z.email({ error: 'Enter the e-mail address of the account.' })),
});
export const removeAdminInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }), adminId: z.uuid({ error: 'Choose an admin from the list.' }) });

export const addMemberInput = z.object({
  organizationId: z.uuid({ error: NO_ORGANIZATION }),
  /** The address of the person's public profile (/people/<slug>). */
  personSlug: z
    .string({ error: 'Give the address of the person’s public profile.' })
    .trim()
    .transform((s) => s.replace(/^.*\/people\//, '').replace(/[/?#].*$/, ''))
    .pipe(z.string().min(1, { error: 'Give the address of the person’s public profile.' }).max(160).regex(/^[a-z0-9-]+$/, { error: 'Give the address of the person’s public profile.' })),
  role: z.enum(ORGANIZATION_ROLES, { error: 'Choose the member’s role.' }).default('member'),
  /** "YYYY-MM-DD"; empty when not known. */
  startsOn: z
    .string()
    .trim()
    .max(10)
    .nullish()
    .transform((s) => (s ? s : null))
    .refine((s) => s === null || parseIsoDay(s) !== null, { error: 'Enter the date as YYYY-MM-DD, or leave it empty.' })
    // A member is current from the day they are listed; a later start would be a membership nobody can see or end.
    .refine((s) => s === null || parseIsoDay(s) === null || s <= isoDay(new Date()), { error: 'The start date cannot be later than today.' }),
});
export const endMemberInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }), membershipId: z.uuid({ error: 'Choose a member from the list.' }) });

export const requestSchoolInput = z.object({
  organizationId: z.uuid({ error: NO_ORGANIZATION }),
  /** The address of the school's public page (/schools/<slug>). */
  schoolSlug: z
    .string({ error: 'Give the address of the school’s public page.' })
    .trim()
    .transform((s) => s.replace(/^.*\/schools\//, '').replace(/[/?#].*$/, ''))
    .pipe(z.string().min(1, { error: 'Give the address of the school’s public page.' }).max(160).regex(/^[a-z0-9-]+$/, { error: 'Give the address of the school’s public page.' })),
});
export const linkIdInput = z.object({ linkId: z.uuid({ error: NO_LINK }) });
export const answerSchoolLinkInput = z.object({ linkId: z.uuid({ error: NO_LINK }), accept: z.boolean({ error: 'Accept or refuse the link.' }) });

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  return parsed.data;
}

/** An id-only input: a malformed id is 404, the same answer as for none. */
function parseId<T extends z.ZodType>(schema: T, raw: unknown, notFoundError: () => ServiceError = notFound): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // A malformed field other than an id is a field error; a malformed id is 404.
    const idIssue = parsed.error.issues.some((i) => ['organizationId', 'linkId', 'adminId', 'membershipId'].includes(String(i.path[0])) && i.code !== 'invalid_type');
    if (idIssue) throw notFoundError();
    throw fieldErrors(parsed.error);
  }
  return parsed.data;
}

// --- Shared reads --------------------------------------------------------------------------------

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  countryCode: string | null;
  websiteUrl: string | null;
  leaderName: string | null;
  leaderTitle: string | null;
  schoolsEstimate: number | null;
  createdByUserId: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
}

const orgColumns = {
  id: organization.id,
  slug: organization.slug,
  name: organization.name,
  kind: organization.kind,
  status: organization.status,
  countryCode: organization.countryCode,
  websiteUrl: organization.websiteUrl,
  leaderName: organization.leaderName,
  leaderTitle: organization.leaderTitle,
  schoolsEstimate: organization.schoolsEstimate,
  createdByUserId: organization.createdByUserId,
  approvedAt: organization.approvedAt,
  updatedAt: organization.updatedAt,
};

/** An organization's version: its updated_at in whole microseconds since 1970, as text (exact). */
export const ORGANIZATION_VERSION = sql<string>`(extract(epoch from ${organization.updatedAt}) * 1000000)::bigint::text`;

/** The organization (not deleted), locked FOR UPDATE when `lock`. */
export async function organizationRow(db: Executor, id: string, lock = false): Promise<(OrgRow & { version: string }) | null> {
  const query = db
    .select({ ...orgColumns, version: ORGANIZATION_VERSION })
    .from(organization)
    .where(and(eq(organization.id, id), isNull(organization.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** The account's active admin role in the organization, or null. */
export async function adminRoleOf(db: Executor, organizationId: string, userId: string): Promise<OrganizationAdminRole | null> {
  const [row] = await db
    .select({ role: organizationAdmin.role })
    .from(organizationAdmin)
    .where(and(eq(organizationAdmin.organizationId, organizationId), eq(organizationAdmin.userId, userId), isNull(organizationAdmin.revokedAt)));
  return row?.role ?? null;
}

/** The accounts that administer the organization now. */
export async function adminIdsOf(db: Executor, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: organizationAdmin.userId })
    .from(organizationAdmin)
    .where(and(eq(organizationAdmin.organizationId, organizationId), isNull(organizationAdmin.revokedAt)));
  return rows.map((r) => r.userId);
}

/**
 * The organization this account administers, locked (the organization first: every write here
 * takes it before any other row), with the account's role; 404 for an organization it does not
 * administer, whatever exists (one organization's admin never learns about another's).
 */
async function managed(tx: Executor, p: Principal, organizationId: string): Promise<{ org: OrgRow & { version: string }; role: OrganizationAdminRole }> {
  const org = await organizationRow(tx, organizationId, true);
  if (!org) throw notFound();
  const role = await adminRoleOf(tx, org.id, p.user.id);
  if (!role) throw notFound();
  return { org, role };
}

/** Member and school administration: approved, and an active Federation grant (DEFAULT D08). */
async function requireAdministration(tx: Executor, org: OrgRow): Promise<void> {
  if (org.status !== 'active') throw new ServiceError('CONFLICT', 'Members and schools are managed once the organization is approved.');
  const plan = await organizationPlan({ kind: 'organization', organizationId: org.id }, { db: tx });
  if (!plan.plan) {
    throw new ServiceError('ENTITLEMENT_REQUIRED', FEDERATION_NEEDED, {}, { entitlement: { ok: false, code: 'plan', plan: 'federation', limit: 0, current: 0, grantedBy: 'federation' } });
  }
}

async function tellAdmins(tx: Transaction, organizationId: string, template: NotificationKind, payload: Record<string, unknown>, except: readonly string[] = []): Promise<void> {
  const ids = (await adminIdsOf(tx, organizationId)).filter((id) => !except.includes(id));
  if (ids.length > 0) await notifyEach(tx, ids, template, payload);
}

function organizationSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'organization'}-${randomBytes(3).toString('hex')}`;
}

const SQL_IDS = (ids: readonly string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;

// --- Public reads ------------------------------------------------------------------------------

async function cachedOrganizationList(): Promise<OrganizationListDto> {
  'use cache';
  cacheLife('minutes');
  tagCacheEntry([ORGANIZATIONS_TAG]);
  const result = await getDb().execute<{ slug: string; name: string; kind: OrganizationKind; country_code: string | null }>(sql`
    SELECT v.slug, v.name, v.kind, v.country_code FROM v_public_organization v ORDER BY v.name, v.slug LIMIT 500`);
  return toPublicOrganizationList({
    organizations: result.rows.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, kindLabel: ORGANIZATION_KIND_LABELS[r.kind], countryCode: r.country_code })),
  });
}

/** organizations.list: the approved organizations (anyone). */
export async function organizationsList(): Promise<OrganizationListDto> {
  return cachedOrganizationList();
}

interface PublicMemberRow extends Record<string, unknown> {
  id: string;
  slug: string;
  display_name: string;
  lang: string | null;
  role: OrganizationMemberRole;
}

async function cachedOrganizationPage(slug: string): Promise<OrganizationPageDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const found = await db.execute<{ id: string; slug: string; name: string; kind: OrganizationKind; country_code: string | null; website_url: string | null; approved_at: Date | string | null }>(sql`
    SELECT v.id, v.slug, v.name, v.kind, v.country_code, v.website_url, v.approved_at FROM v_public_organization v WHERE v.slug = ${slug}`);
  const row = found.rows[0];
  if (!row) {
    tagCacheEntry([ORGANIZATIONS_TAG]);
    return null;
  }
  // DEFAULT D03: only current members who are public people (v_public_person); the others, and
  // their number, never show.
  const members = await db.execute<PublicMemberRow>(sql`
    SELECT p.id, p.slug, p.display_name,
           (SELECT pn.lang FROM person_name pn WHERE pn.person_id = p.id AND pn.is_primary LIMIT 1) AS lang,
           m.role
      FROM organization_membership m
      JOIN v_public_person p ON p.id = m.person_id
     WHERE m.organization_id = ${row.id}::uuid AND (m.starts_on IS NULL OR m.starts_on <= current_date) AND (m.ends_on IS NULL OR m.ends_on > current_date)
     ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, p.display_name, p.id
     LIMIT ${ORGANIZATION_LIST_LIMIT}`);
  const ids = members.rows.map((m) => m.id);
  const originals =
    ids.length === 0
      ? []
      : (
          await db.execute<{ person_id: string; value: string; lang: string; script: string }>(sql`
            SELECT DISTINCT ON (pn.person_id) pn.person_id, pn.value, pn.lang, pn.script
              FROM person_name pn
             WHERE pn.person_id = ANY (${SQL_IDS(ids)}) AND NOT pn.is_primary AND pn.kind = 'name' AND pn.script <> 'Latn'
             ORDER BY pn.person_id, pn.sort_order, pn.id`)
        ).rows;
  const photos = await publicPhotoRefs(db, ids);
  // Plan §6.4: a school by its name and city, never a point; only while it is public.
  const schools = await db.execute<{ slug: string; name: string; city_name: string; country_code: string }>(sql`
    SELECT s.slug, s.name, s.city_name, s.country_code
      FROM organization_school l
      JOIN v_public_school s ON s.id = l.school_id
     WHERE l.organization_id = ${row.id}::uuid AND l.status = 'accepted'
     ORDER BY s.name, s.slug
     LIMIT ${ORGANIZATION_LIST_LIMIT}`);
  // Every member's tag, the hidden ones too: a member who makes their profile public (or hides it)
  // changes this page, and that person's tag is what the profile change invalidates.
  const everyMember = await db.execute<{ person_id: string }>(sql`
    SELECT DISTINCT m.person_id FROM organization_membership m WHERE m.organization_id = ${row.id}::uuid`);
  tagCacheEntry([ORGANIZATIONS_TAG, SCHOOLS_TAG, ...everyMember.rows.map((m) => personTag(m.person_id))]);
  const approved = row.approved_at === null ? null : row.approved_at instanceof Date ? row.approved_at : new Date(row.approved_at);
  return toPublicOrganizationPage({
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    kindLabel: ORGANIZATION_KIND_LABELS[row.kind],
    countryCode: row.country_code,
    websiteUrl: row.website_url,
    approvedOn: approved ? isoDay(approved) : null,
    members: members.rows.map((m) => {
      const original = originals.find((o) => o.person_id === m.id);
      return {
        slug: m.slug,
        displayName: { value: m.display_name, lang: m.lang ?? 'und-Latn', script: 'Latn' },
        original: original ? { value: original.value, lang: original.lang, script: original.script } : null,
        role: m.role,
        roleLabel: MEMBER_ROLE_LABELS[m.role],
        photo: photoOf(photos.get(m.id)),
      };
    }),
    schools: schools.rows.map((s) => ({ slug: s.slug, name: s.name, city: s.city_name, countryCode: s.country_code })),
  });
}

/** organizations.get: an approved organization's public page (404 when there is none, or it is not approved). */
export async function organizationGet(_principal: Principal | null, raw: z.input<typeof organizationSlugInput>): Promise<OrganizationPageDto> {
  const parsed = organizationSlugInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const page = await cachedOrganizationPage(parsed.data.slug);
  if (!page) throw notFound();
  return page;
}

// --- The account's organizations -----------------------------------------------------------------

export interface PlanView {
  /** 'federation' while an active grant holds; null without one. */
  code: 'federation' | null;
  label: string;
  until: string | null;
}

async function planView(db: Executor, organizationId: string): Promise<PlanView> {
  const plan = await organizationPlan({ kind: 'organization', organizationId }, { db });
  if (!plan.plan) return { code: null, label: 'No plan', until: null };
  return { code: 'federation', label: PLANS.federation.name, until: plan.until?.toISOString() ?? null };
}

export interface MyOrganizationRow {
  id: string;
  slug: string;
  name: string;
  kindLabel: string;
  status: OrganizationStatus;
  approvalLabel: string;
  role: OrganizationAdminRole;
  roleLabel: string;
  plan: PlanView;
}

export interface MyOrganizations {
  organizations: MyOrganizationRow[];
  /** No application of this account waits for review. */
  canApply: boolean;
  refusal: string | null;
}

/** organizations.mine: the organizations the signed-in account administers, and whether it may apply. */
export async function myOrganizations(principal: Principal | null): Promise<MyOrganizations> {
  const p = requireUser(principal);
  const db = getDb();
  const rows = await db
    .select({ ...orgColumns, role: organizationAdmin.role })
    .from(organizationAdmin)
    .innerJoin(organization, and(eq(organization.id, organizationAdmin.organizationId), isNull(organization.deletedAt)))
    .where(and(eq(organizationAdmin.userId, p.user.id), isNull(organizationAdmin.revokedAt)))
    .orderBy(asc(organization.name), asc(organization.id));
  const pending = rows.some((r) => r.status === 'pending' && r.createdByUserId === p.user.id);
  return {
    organizations: await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        kindLabel: ORGANIZATION_KIND_LABELS[r.kind],
        status: r.status,
        approvalLabel: APPROVAL_LABELS[r.status],
        role: r.role,
        roleLabel: ADMIN_ROLE_LABELS[r.role],
        plan: await planView(db, r.id),
      })),
    ),
    canApply: !pending,
    refusal: pending ? 'Your organization’s application is with the reviewers. You can edit it until they decide.' : null,
  };
}

export interface ApplicationView {
  caseId: string;
  status: ReviewCaseStatus;
  statusLabel: string;
  open: boolean;
  resolution: 'approved' | 'rejected' | null;
  /** The reviewers' reason of a declined application. */
  reason: string | null;
  /** The reviewers' notes the applicant reads (their questions) and the applicant's own. */
  messages: { fromYou: boolean; body: string; createdAt: string }[];
  /** The supporting documents; each opens only for its uploader (and the reviewers). */
  files: EvidenceFileView[];
}

export interface ManagedOrganization {
  id: string;
  slug: string;
  name: string;
  kind: OrganizationKind;
  kindLabel: string;
  countryCode: string | null;
  websiteUrl: string | null;
  leaderName: string | null;
  leaderTitle: string | null;
  schoolsEstimate: number | null;
  /** DEFAULT D04: the approval, the plan and (elsewhere) a person's verification are separate states. */
  approval: { status: OrganizationStatus; label: string; approvedAt: string | null };
  plan: PlanView;
  you: { role: OrganizationAdminRole; roleLabel: string };
  can: { editApplication: boolean; editDetails: boolean; manageAdmins: boolean; administration: boolean };
  /** Why member and school administration is closed, when it is. */
  administrationNote: string | null;
  application: ApplicationView | null;
  admins: { id: string; userId: string; label: string; role: OrganizationAdminRole; roleLabel: string; you: boolean }[];
  members: { id: string; person: PersonRef; role: OrganizationMemberRole; roleLabel: string; startsOn: string | null; endsOn: string | null; current: boolean }[];
  schools: { id: string; schoolId: string; slug: string; name: string; city: string; countryCode: string; status: SchoolLinkStatus; statusLabel: string }[];
  countries: readonly { code: string; name: string }[];
  kinds: { value: OrganizationKind; label: string }[];
  memberRoles: { value: OrganizationMemberRole; label: string }[];
}

async function applicationOf(db: Executor, p: Principal, organizationId: string): Promise<ApplicationView | null> {
  const [latest] = await db
    .select({ id: reviewCase.id, status: reviewCase.status, resolution: reviewCase.resolution, reason: reviewCase.resolutionReason })
    .from(reviewCase)
    .where(and(eq(reviewCase.organizationId, organizationId), eq(reviewCase.kind, 'organization_application')))
    .orderBy(desc(reviewCase.createdAt), desc(reviewCase.id))
    .limit(1);
  if (!latest) return null;
  const notes = await db
    .select({ author: reviewNote.authorUserId, body: reviewNote.body, createdAt: reviewNote.createdAt })
    .from(reviewNote)
    .where(and(eq(reviewNote.reviewCaseId, latest.id), eq(reviewNote.isInternal, false)))
    .orderBy(asc(reviewNote.createdAt), asc(reviewNote.id));
  const files = (await filesOfCases(db, [latest.id])).get(latest.id) ?? [];
  return {
    caseId: latest.id,
    status: latest.status,
    statusLabel: CLAIM_STATUS_LABELS[latest.status],
    open: (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(latest.status),
    resolution: latest.resolution,
    reason: latest.resolution === 'rejected' ? latest.reason : null,
    messages: notes.map((n) => ({ fromYou: n.author === p.user.id, body: n.body, createdAt: n.createdAt.toISOString() })),
    files: files.map((f) => fileView(f, f.uploadedByUserId === p.user.id)),
  };
}

/** organizations.manage: one organization the account administers, for its dashboard (404 otherwise). */
export async function manageOrganization(principal: Principal | null, raw: z.input<typeof organizationIdInput>): Promise<ManagedOrganization> {
  const p = requireUser(principal);
  const { organizationId } = parseId(organizationIdInput, raw);
  const db = getDb();
  const org = await organizationRow(db, organizationId);
  if (!org) throw notFound();
  const role = await adminRoleOf(db, org.id, p.user.id);
  if (!role) throw notFound();
  const plan = await planView(db, org.id);
  const active = org.status === 'active';
  const admins = await db
    .select({ id: organizationAdmin.id, userId: organizationAdmin.userId, role: organizationAdmin.role, name: authUser.name, email: authUser.email })
    .from(organizationAdmin)
    .innerJoin(authUser, eq(authUser.id, organizationAdmin.userId))
    .where(and(eq(organizationAdmin.organizationId, org.id), isNull(organizationAdmin.revokedAt)))
    .orderBy(sql`CASE ${organizationAdmin.role} WHEN 'owner' THEN 0 ELSE 1 END`, asc(organizationAdmin.createdAt), asc(organizationAdmin.id));
  const memberRows = await db
    .select({ id: organizationMembership.id, personId: organizationMembership.personId, role: organizationMembership.role, startsOn: organizationMembership.startsOn, endsOn: organizationMembership.endsOn })
    .from(organizationMembership)
    .where(eq(organizationMembership.organizationId, org.id))
    .orderBy(sql`(${organizationMembership.endsOn} IS NOT NULL)`, sql`CASE ${organizationMembership.role} WHEN 'leader' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`, asc(organizationMembership.createdAt))
    .limit(ORGANIZATION_LIST_LIMIT);
  const refs = await peopleRefs(memberRows.map((m) => m.personId));
  const today = isoDay(new Date());
  const links = await db.execute<{ id: string; school_id: string; slug: string; name: string; city: string; country_code: string; status: SchoolLinkStatus }>(sql`
    SELECT l.id, l.school_id, s.slug, s.name, pl.name AS city, pl.country_code, l.status
      FROM organization_school l
      JOIN school s ON s.id = l.school_id AND s.deleted_at IS NULL
      JOIN place pl ON pl.id = s.place_id
     WHERE l.organization_id = ${org.id}::uuid AND l.status IN ('pending', 'accepted')
     ORDER BY l.status DESC, s.name, l.id
     LIMIT ${ORGANIZATION_LIST_LIMIT}`);
  const administration = active && plan.code === 'federation';
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    kind: org.kind,
    kindLabel: ORGANIZATION_KIND_LABELS[org.kind],
    countryCode: org.countryCode,
    websiteUrl: org.websiteUrl,
    leaderName: org.leaderName,
    leaderTitle: org.leaderTitle,
    schoolsEstimate: org.schoolsEstimate,
    approval: { status: org.status, label: APPROVAL_LABELS[org.status], approvedAt: org.approvedAt?.toISOString() ?? null },
    plan,
    you: { role, roleLabel: ADMIN_ROLE_LABELS[role] },
    can: { editApplication: org.status === 'pending', editDetails: active, manageAdmins: active && role === 'owner', administration },
    administrationNote: administration ? null : active ? FEDERATION_NEEDED : org.status === 'pending' ? 'Members and schools are managed once the reviewers approve the organization.' : null,
    application: await applicationOf(db, p, org.id),
    admins: admins.map((a) => ({ id: a.id, userId: a.userId, label: a.name ? `${a.name} (${a.email})` : a.email, role: a.role, roleLabel: ADMIN_ROLE_LABELS[a.role], you: a.userId === p.user.id })),
    members: memberRows.flatMap((m) => {
      const person = refs.get(m.personId);
      if (!person) return [];
      const current = membershipIsCurrent(m, today);
      return [{ id: m.id, person, role: m.role, roleLabel: MEMBER_ROLE_LABELS[m.role], startsOn: m.startsOn, endsOn: m.endsOn, current }];
    }),
    schools: links.rows.map((l) => ({ id: l.id, schoolId: l.school_id, slug: l.slug, name: l.name, city: l.city, countryCode: l.country_code, status: l.status, statusLabel: LINK_STATUS_LABELS[l.status] })),
    countries: COUNTRIES,
    kinds: ORGANIZATION_KINDS.map((k) => ({ value: k, label: ORGANIZATION_KIND_LABELS[k] })),
    memberRoles: ORGANIZATION_ROLES.map((r) => ({ value: r, label: MEMBER_ROLE_LABELS[r] })),
  };
}

/** What the application form offers: the countries and the kinds. */
export function applicationOptions(principal: Principal | null): { countries: readonly { code: string; name: string }[]; kinds: { value: OrganizationKind; label: string }[] } {
  requireUser(principal);
  return { countries: COUNTRIES, kinds: ORGANIZATION_KINDS.map((k) => ({ value: k, label: ORGANIZATION_KIND_LABELS[k] })) };
}

// --- Apply ---------------------------------------------------------------------------------------

export interface OrganizationApplied {
  organizationId: string;
  caseId: string;
  replayed: boolean;
}

/** organizations.apply: an organization's application (see the top of this file). */
export async function applyOrganization(principal: Principal | null, raw: OrganizationApplyInput, meta: RequestMeta): Promise<OrganizationApplied> {
  const p = requireUser(principal);
  const input = parse(organizationApplyInput, raw);
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      // The account's case lock first: its pending application and the applications of the day are
      // counted one call after the other.
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, organizationId: reviewCase.organizationId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'organization_application' || !earlier.organizationId) throw keyReused();
        return { organizationId: earlier.organizationId, caseId: replay.caseId, replayed: true };
      }
      const [waiting] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(and(eq(organization.createdByUserId, p.user.id), eq(organization.status, 'pending'), isNull(organization.deletedAt)));
      if (waiting) throw new ServiceError('CONFLICT', 'Your organization’s application is with the reviewers already. You can edit it until they decide.');
      const [recent] = await tx
        .select({ n: count() })
        .from(reviewEvent)
        .innerJoin(reviewCase, eq(reviewCase.id, reviewEvent.reviewCaseId))
        .where(and(eq(reviewEvent.actorUserId, p.user.id), eq(reviewEvent.action, 'open'), eq(reviewCase.kind, 'organization_application'), gt(reviewEvent.createdAt, new Date(Date.now() - 86_400_000))));
      if ((recent?.n ?? 0) >= ORGANIZATION_APPLICATIONS_PER_DAY) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent several applications today. You can send another one tomorrow.');

      const organizationId = uuidv7();
      await tx.insert(organization).values({
        id: organizationId,
        slug: organizationSlug(input.name),
        name: input.name,
        kind: input.kind,
        status: 'pending',
        countryCode: input.countryCode,
        websiteUrl: input.websiteUrl,
        leaderName: input.leaderName,
        leaderTitle: input.leaderTitle,
        schoolsEstimate: input.schoolsEstimate,
        createdByUserId: p.user.id,
      });
      // DEFAULT D12: the applicant's authority is an account's, never a person's membership.
      await tx.insert(organizationAdmin).values({ organizationId, userId: p.user.id, role: 'owner', grantedByUserId: p.user.id });
      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'organization_application', status: 'open', organizationId, openedByUserId: p.user.id });
      // DEFAULT D13/D25: the supporting document is private evidence of the case (optional).
      const evidenceError = await linkOptionalFilesToCase(tx, p.user.id, caseId, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      if (input.note) await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.note, isInternal: false });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'organization.apply',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'organization',
        subjectId: organizationId,
        after: { status: 'pending', kind: input.kind, countryCode: input.countryCode, caseId, evidenceIds: [...new Set(input.evidenceIds)] },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStaff(tx, caseId, 'organization_application', [p.user.id]);
      return { organizationId, caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    if (pgErrorOf(error)?.constraint === 'organization_slug_key') throw new ServiceError('CONFLICT', 'Send the application again.');
    throw error;
  }
}

// --- Update --------------------------------------------------------------------------------------

/** The fields only a new review could change once the organization is approved. */
const REVIEWED_FIELDS = ['name', 'kind', 'countryCode'] as const;

export interface OrganizationSaved {
  organizationId: string;
  slug: string;
  status: OrganizationStatus;
  changed: string[];
}

/** organizations.update: an admin edits the organization (see the top of this file). */
export async function updateOrganization(principal: Principal | null, raw: z.input<typeof organizationUpdateInput>, meta: RequestMeta): Promise<OrganizationSaved> {
  const p = requireUser(principal);
  const input = parseId(organizationUpdateInput, raw);
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    if (org.status !== 'pending' && org.status !== 'active') throw new ServiceError('CONFLICT', 'This organization can no longer be edited.');
    const next = {
      name: input.name,
      kind: input.kind,
      countryCode: input.countryCode,
      websiteUrl: input.websiteUrl,
      leaderName: input.leaderName,
      leaderTitle: input.leaderTitle,
      schoolsEstimate: input.schoolsEstimate,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== org[k]);
    // DEFAULT (ADR 0018): once approved, the official name, kind and country stay as the reviewers saw them.
    if (org.status === 'active') {
      const fields: Record<string, string> = {};
      for (const k of REVIEWED_FIELDS) if (changed.includes(k)) fields[k] = 'This was approved by the reviewers and cannot be changed here.';
      if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
    }
    if (changed.length === 0) return { organizationId: org.id, slug: org.slug, status: org.status, changed };
    await tx
      .update(organization)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(organization.id, org.id));
    await writeAudit(tx, {
      action: 'organization.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { status: org.status },
      after: { status: org.status, changed },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { organizationId: org.id, slug: org.slug, status: org.status, changed };
  });
  if (saved.status === 'active' && saved.changed.length > 0) invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
  return saved;
}

// --- Admins --------------------------------------------------------------------------------------

export interface AdminChanged {
  adminId: string;
}

/** organizations.addAdmin: an owner adds an existing account as an admin of an approved organization. */
export async function addOrganizationAdmin(principal: Principal | null, raw: z.input<typeof addAdminInput>, meta: RequestMeta): Promise<AdminChanged> {
  const p = requireUser(principal);
  const input = parseId(addAdminInput, raw);
  return getDb().transaction(async (tx) => {
    const { org, role } = await managed(tx, p, input.organizationId);
    if (org.status !== 'active') throw new ServiceError('CONFLICT', 'Admins are added once the organization is approved.');
    if (role !== 'owner') throw new ServiceError('FORBIDDEN', 'Only an owner of the organization adds admins.');
    const [account] = await tx.select({ id: authUser.id, banned: authUser.banned }).from(authUser).where(eq(authUser.email, input.email));
    if (!account || account.banned) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { email: 'No account has this e-mail address. The person signs up first.' });
    if (await adminRoleOf(tx, org.id, account.id)) throw new ServiceError('CONFLICT', 'This account is an admin of the organization already.');
    const adminId = uuidv7();
    await tx.insert(organizationAdmin).values({ id: adminId, organizationId: org.id, userId: account.id, role: 'admin', grantedByUserId: p.user.id });
    await writeAudit(tx, {
      action: 'organization.admin_add',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      after: { adminId, userId: account.id, role: 'admin' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await notify(tx, account.id, 'organization.admin_added', { organizationId: org.id });
    return { adminId };
  });
}

/** organizations.removeAdmin: an owner removes an admin, or an admin leaves. An owner is never removed here. */
export async function removeOrganizationAdmin(principal: Principal | null, raw: z.input<typeof removeAdminInput>, meta: RequestMeta): Promise<AdminChanged> {
  const p = requireUser(principal);
  const input = parseId(removeAdminInput, raw);
  return getDb().transaction(async (tx) => {
    const { org, role } = await managed(tx, p, input.organizationId);
    const [row] = await tx
      .select({ id: organizationAdmin.id, userId: organizationAdmin.userId, role: organizationAdmin.role })
      .from(organizationAdmin)
      .where(and(eq(organizationAdmin.id, input.adminId), eq(organizationAdmin.organizationId, org.id), isNull(organizationAdmin.revokedAt)))
      .for('update');
    if (!row) throw new ServiceError('NOT_FOUND', 'No such admin.');
    if (row.role === 'owner') throw new ServiceError('CONFLICT', 'An owner cannot be removed here.');
    if (role !== 'owner' && row.userId !== p.user.id) throw new ServiceError('FORBIDDEN', 'Only an owner of the organization removes another admin.');
    const now = new Date();
    await tx.update(organizationAdmin).set({ revokedAt: now, revokedByUserId: p.user.id, updatedAt: now }).where(eq(organizationAdmin.id, row.id));
    await writeAudit(tx, {
      action: 'organization.admin_remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { adminId: row.id, userId: row.userId, role: row.role },
      after: { revokedAt: now.toISOString() },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { adminId: row.id };
  });
}

// --- Members -------------------------------------------------------------------------------------

export interface MemberChanged {
  membershipId: string;
}

/**
 * organizations.addMember: a public person as a current member (DEFAULT D03: only a person whose
 * profile is public can be listed, so a membership never reveals a hidden one). DEFAULT D12: the
 * membership is the organization's statement of affiliation; it creates, verifies and edits no
 * teaching relationship and changes nobody's visibility.
 */
export async function addOrganizationMember(principal: Principal | null, raw: z.input<typeof addMemberInput>, meta: RequestMeta): Promise<MemberChanged> {
  const p = requireUser(principal);
  const input = parseId(addMemberInput, raw);
  const db = getDb();
  const out = await db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await requireAdministration(tx, org);
    const found = await tx.execute<{ id: string }>(sql`SELECT v.id FROM v_public_person v WHERE v.slug = ${input.personSlug}`);
    const personId = found.rows[0]?.id;
    if (!personId) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { personSlug: 'No public profile has this address. Only people whose profile is public can be listed.' });
    const [existing] = await tx
      .select({ id: organizationMembership.id, startsOn: organizationMembership.startsOn, endsOn: organizationMembership.endsOn })
      .from(organizationMembership)
      .where(and(eq(organizationMembership.organizationId, org.id), eq(organizationMembership.personId, personId)))
      .for('update');
    const today = isoDay(new Date());
    if (existing && !membershipHasEnded(existing, today)) throw new ServiceError('CONFLICT', 'This person is a member of the organization already.');
    const now = new Date();
    const membershipId = existing?.id ?? uuidv7();
    if (existing) {
      // A former member again: the same row, its end cleared (the audit log keeps the earlier period).
      await tx.update(organizationMembership).set({ role: input.role, startsOn: input.startsOn, endsOn: null, updatedAt: now }).where(eq(organizationMembership.id, existing.id));
    } else {
      await tx.insert(organizationMembership).values({ id: membershipId, organizationId: org.id, personId, role: input.role, startsOn: input.startsOn });
    }
    await writeAudit(tx, {
      action: 'organization.member_add',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: existing ? { membershipId, endsOn: existing.endsOn } : null,
      after: { membershipId, personId, role: input.role },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { membershipId, personId };
  });
  invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
  return { membershipId: out.membershipId };
}

type MembershipDays = { startsOn: string | null; endsOn: string | null };
/**
 * Ended: its end has come, or it was ended before it began (ends_on = starts_on in the future, the
 * only end a later start allows under ends_on >= starts_on).
 */
export function membershipHasEnded(m: MembershipDays, today: string): boolean {
  return m.endsOn !== null && (m.endsOn <= today || (m.startsOn !== null && m.endsOn <= m.startsOn));
}
/** Current: begun (or no start known) and not ended; the public page uses the same rule in SQL. */
export function membershipIsCurrent(m: MembershipDays, today: string): boolean {
  return (m.startsOn === null || m.startsOn <= today) && !membershipHasEnded(m, today);
}

/** organizations.endMember: ends a current membership today; the row stays as history. */
export async function endOrganizationMember(principal: Principal | null, raw: z.input<typeof endMemberInput>, meta: RequestMeta): Promise<MemberChanged> {
  const p = requireUser(principal);
  const input = parseId(endMemberInput, raw);
  const out = await getDb().transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await requireAdministration(tx, org);
    const [row] = await tx
      .select({ id: organizationMembership.id, startsOn: organizationMembership.startsOn, endsOn: organizationMembership.endsOn })
      .from(organizationMembership)
      .where(and(eq(organizationMembership.id, input.membershipId), eq(organizationMembership.organizationId, org.id)))
      .for('update');
    if (!row) throw new ServiceError('NOT_FOUND', 'No such member.');
    const today = isoDay(new Date());
    if (membershipHasEnded(row, today)) throw new ServiceError('CONFLICT', 'This membership has ended already.');
    // A membership that starts later than today ends on its first day (ends_on >= starts_on).
    const endsOn = row.startsOn !== null && row.startsOn > today ? row.startsOn : today;
    await tx.update(organizationMembership).set({ endsOn, updatedAt: new Date() }).where(eq(organizationMembership.id, row.id));
    await writeAudit(tx, {
      action: 'organization.member_end',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { membershipId: row.id, endsOn: row.endsOn },
      after: { endsOn },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { membershipId: row.id };
  });
  invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
  return out;
}

// --- Schools -------------------------------------------------------------------------------------

export interface LinkChanged {
  linkId: string;
  status: SchoolLinkStatus;
}

/**
 * organizations.requestSchool: asks a public school to link to the organization. The school's
 * listing account answers (answerSchoolLink); a school of the platform's record (no account) has
 * nobody to answer, so it cannot be asked. Nothing changes for the school until it accepts, and
 * its pin never depends on the link (DEFAULT D12).
 */
export async function requestOrganizationSchool(principal: Principal | null, raw: z.input<typeof requestSchoolInput>, meta: RequestMeta): Promise<LinkChanged> {
  const p = requireUser(principal);
  const input = parseId(requestSchoolInput, raw);
  try {
    return await getDb().transaction(async (tx) => {
      const { org } = await managed(tx, p, input.organizationId);
      await requireAdministration(tx, org);
      const found = await tx.execute<{ id: string; created_by_user_id: string | null }>(sql`
        SELECT s.id, s.created_by_user_id FROM v_public_school v JOIN school s ON s.id = v.id WHERE v.slug = ${input.schoolSlug}`);
      const target = found.rows[0];
      if (!target) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { schoolSlug: 'No listed school has this address.' });
      if (!target.created_by_user_id) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { schoolSlug: 'This school is kept by the platform and has no account to answer a request.' });
      }
      const [open] = await tx
        .select({ id: organizationSchool.id, status: organizationSchool.status })
        .from(organizationSchool)
        .where(and(eq(organizationSchool.organizationId, org.id), eq(organizationSchool.schoolId, target.id), inArray(organizationSchool.status, ['pending', 'accepted'])));
      if (open) throw new ServiceError('CONFLICT', open.status === 'accepted' ? 'This school is linked to the organization already.' : 'This school has the organization’s request already.');
      const linkId = uuidv7();
      await tx.insert(organizationSchool).values({ id: linkId, organizationId: org.id, schoolId: target.id, status: 'pending', requestedByUserId: p.user.id });
      await writeAudit(tx, {
        action: 'organization.school_request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'organization',
        subjectId: org.id,
        after: { linkId, schoolId: target.id, status: 'pending' },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await notify(tx, target.created_by_user_id, 'organization.school_requested', { linkId });
      return { linkId, status: 'pending' as const };
    });
  } catch (error) {
    if (pgErrorOf(error)?.constraint === 'organization_school_one_open_key') throw new ServiceError('CONFLICT', 'This school has the organization’s request already.');
    throw error;
  }
}

interface LinkRow {
  id: string;
  organizationId: string;
  schoolId: string;
  status: SchoolLinkStatus;
  schoolOwner: string | null;
}

/** A link, locked after its organization (the order every write here takes), or null. */
async function lockLink(tx: Executor, linkId: string): Promise<LinkRow | null> {
  const [seen] = await tx.select({ organizationId: organizationSchool.organizationId }).from(organizationSchool).where(eq(organizationSchool.id, linkId));
  if (!seen) return null;
  await organizationRow(tx, seen.organizationId, true);
  const [row] = await tx
    .select({ id: organizationSchool.id, organizationId: organizationSchool.organizationId, schoolId: organizationSchool.schoolId, status: organizationSchool.status, schoolOwner: school.createdByUserId })
    .from(organizationSchool)
    .innerJoin(school, eq(school.id, organizationSchool.schoolId))
    .where(eq(organizationSchool.id, linkId))
    .for('update', { of: organizationSchool });
  return row ?? null;
}

/** organizations.answerSchoolLink: the school's listing account accepts or refuses a pending link. */
export async function answerSchoolLink(principal: Principal | null, raw: z.input<typeof answerSchoolLinkInput>, meta: RequestMeta): Promise<LinkChanged> {
  const p = requireUser(principal);
  const input = parseId(answerSchoolLinkInput, raw, () => new ServiceError('NOT_FOUND', NO_LINK));
  const out = await getDb().transaction(async (tx) => {
    const link = await lockLink(tx, input.linkId);
    if (!link || link.schoolOwner !== p.user.id) throw new ServiceError('NOT_FOUND', NO_LINK);
    if (link.status !== 'pending') throw new ServiceError('CONFLICT', 'This request has been answered already.');
    const status = input.accept ? 'accepted' : 'refused';
    const now = new Date();
    await tx.update(organizationSchool).set({ status, answeredByUserId: p.user.id, answeredAt: now, updatedAt: now }).where(eq(organizationSchool.id, link.id));
    await writeAudit(tx, {
      action: 'organization.school_answer',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization_school',
      subjectId: link.id,
      before: { status: 'pending' },
      after: { status, organizationId: link.organizationId, schoolId: link.schoolId },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await tellAdmins(tx, link.organizationId, 'organization.school_answered', { organizationId: link.organizationId, decision: status });
    return { linkId: link.id, status: status as SchoolLinkStatus };
  });
  if (out.status === 'accepted') invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
  return out;
}

/**
 * organizations.endSchoolLink: either side ends a link: an admin of the organization (a pending
 * request withdrawn, or an accepted link ended) or the school's listing account (an accepted link
 * ended). The school and its pin stay as they are.
 */
export async function endSchoolLink(principal: Principal | null, raw: z.input<typeof linkIdInput>, meta: RequestMeta): Promise<LinkChanged> {
  const p = requireUser(principal);
  const input = parseId(linkIdInput, raw, () => new ServiceError('NOT_FOUND', NO_LINK));
  const out = await getDb().transaction(async (tx) => {
    const link = await lockLink(tx, input.linkId);
    if (!link) throw new ServiceError('NOT_FOUND', NO_LINK);
    const orgAdmin = (await adminRoleOf(tx, link.organizationId, p.user.id)) !== null;
    const schoolSide = link.schoolOwner === p.user.id;
    if (!orgAdmin && !schoolSide) throw new ServiceError('NOT_FOUND', NO_LINK);
    if (link.status !== 'accepted' && !(orgAdmin && link.status === 'pending')) throw new ServiceError('CONFLICT', 'This link has ended already.');
    // The organization's side ends it as part of its administration (DEFAULT D08: with the plan);
    // a school may always leave.
    if (orgAdmin && !schoolSide) {
      const org = await organizationRow(tx, link.organizationId);
      // A deleted organization has no administration left: its admins see no link (as any 404).
      if (!org) throw new ServiceError('NOT_FOUND', NO_LINK);
      await requireAdministration(tx, org);
    }
    const now = new Date();
    await tx.update(organizationSchool).set({ status: 'ended', endedByUserId: p.user.id, endedAt: now, updatedAt: now }).where(eq(organizationSchool.id, link.id));
    await writeAudit(tx, {
      action: 'organization.school_end',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization_school',
      subjectId: link.id,
      before: { status: link.status },
      after: { status: 'ended', side: schoolSide ? 'school' : 'organization', organizationId: link.organizationId, schoolId: link.schoolId },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    if (schoolSide && !orgAdmin) await tellAdmins(tx, link.organizationId, 'organization.school_answered', { organizationId: link.organizationId, decision: 'ended' });
    return { linkId: link.id, status: 'ended' as const, wasAccepted: link.status === 'accepted' };
  });
  if (out.wasAccepted) invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
  return { linkId: out.linkId, status: out.status };
}

export interface SchoolLinkRow {
  id: string;
  status: SchoolLinkStatus;
  statusLabel: string;
  school: { id: string; name: string };
  organization: { name: string; slug: string; kindLabel: string; countryCode: string | null; public: boolean };
  requestedAt: string;
}

/** organizations.schoolLinks: the pending and accepted links of the schools the account listed. */
export async function mySchoolLinks(principal: Principal | null): Promise<{ links: SchoolLinkRow[] }> {
  const p = requireUser(principal);
  const rows = await getDb()
    .select({
      id: organizationSchool.id,
      status: organizationSchool.status,
      createdAt: organizationSchool.createdAt,
      schoolId: school.id,
      schoolName: school.name,
      orgName: organization.name,
      orgSlug: organization.slug,
      orgKind: organization.kind,
      orgCountry: organization.countryCode,
      orgStatus: organization.status,
    })
    .from(organizationSchool)
    .innerJoin(school, and(eq(school.id, organizationSchool.schoolId), isNull(school.deletedAt)))
    .innerJoin(organization, and(eq(organization.id, organizationSchool.organizationId), isNull(organization.deletedAt)))
    .where(and(eq(school.createdByUserId, p.user.id), inArray(organizationSchool.status, ['pending', 'accepted']), ne(organization.status, 'rejected')))
    .orderBy(asc(organizationSchool.status), desc(organizationSchool.createdAt), asc(organizationSchool.id))
    .limit(ORGANIZATION_LIST_LIMIT);
  return {
    links: rows.map((r) => ({
      id: r.id,
      status: r.status,
      statusLabel: r.status === 'pending' ? 'Waiting for your answer' : LINK_STATUS_LABELS[r.status],
      school: { id: r.schoolId, name: r.schoolName },
      organization: { name: r.orgName, slug: r.orgSlug, kindLabel: ORGANIZATION_KIND_LABELS[r.orgKind], countryCode: r.orgCountry, public: r.orgStatus === 'active' },
      requestedAt: r.createdAt.toISOString(),
    })),
  };
}

/** Used by tests and the review card: whether this account administers the organization. */
export async function isOrganizationAdmin(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  return (await adminRoleOf(db, organizationId, userId)) !== null;
}
