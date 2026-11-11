// The full authorization matrix (milestone M13, In scope 3; plan §6.4, §6.7, CLAUDE.md §5): every
// procedure of the oRPC router and the two evidence routes outside it × every role × ownership,
// through the HTTP API (/api/rpc with a real bearer session, as the browser's client and the native
// app call it), and every Server Action that wraps a procedure × the roles that matter, called
// as Next.js calls it (next/headers carrying the same session), with the procedure's answer
// recorded in-process.
//
// The roles: a visitor without a session; an unrelated member; the owner of the object (or the
// party it waits for); the other party; a moderator, an archivist and an administrator, each with
// a verified second factor; and an administrator whose session has not proved the second factor.
// Every call gets fresh fixtures (a new request, case, school…), so a call that succeeds changes
// nothing another call sees. The table is complete: a procedure added to the router without a row
// fails the first test. Fictional data only (D20): demo- slugs, example.test addresses.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { signedSessionToken } from '../auth/credentials';
import type { Principal } from '../auth/principal';
import { startAuthTestDatabase, stopAuthTestDatabase, TEST_APP_URL } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authSession, authUser, notification, person, personName, personPhoto, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleEvidenceDownload, handleEvidenceUpload } from '../evidence-http';
import { handlePhotoRequest } from '../photo-http';
import { writePersonKeys } from '../search/store';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { recordConsents } from '../services/consent';
import { uploadEvidence } from '../services/evidence';
import { createEvent, uploadEventPoster } from '../services/events';
import { addGalleryPhoto } from '../services/gallery';
import { uploadPhoto } from '../services/photos';
import { uploadSchoolPhoto } from '../services/school-photos';
import { plainImage } from '../storage/test-images';
import { createGrant } from '../services/grants';
import { addRank, uploadCertificate } from '../services/passport';
import { requestHistoricalTeacher } from '../services/historical';
import { requestInstructorVerification } from '../services/instructor';
import { inviteTeacher } from '../services/invitations';
import { requestPilotAccess } from '../services/plans';
import { approveRelationship, rejectRelationship, requestTeacher } from '../services/relationships';
import { assignReviewCase } from '../services/review';
import { type Account, createUser, key, meta, newLineage, ongoingFrom, principalOf } from '../services/relationships.test-support';
import { grantOrganizationPlan } from '../services/organization-grants';
import { addOrganizationAdmin, addOrganizationMember, applyOrganization, requestOrganizationSchool } from '../services/organizations';
import { createSchool } from '../services/schools';
import { requestTrial } from '../services/trial-lessons';
import { cancelSubscription, startCheckout, testPay } from '../services/billing';
import { applyPendingBillingEvents, paidSubscription } from '../services/billing.test-support';
import { startFederationTrial } from '../services/federation-trials';
import { signUnsubscribeToken } from '../services/unsubscribe';
import { SIGN_UP_CONSENTS } from '../legal/documents';
import { handleApiRequest } from './handler';
import { SERVER_ACTION_TARGETS } from './parity';
import { router } from './router';

// The procedures' answers inside Server Actions, recorded by the in-process client.
const recorded = vi.hoisted(() => ({ calls: [] as { path: string; code: string }[] }));

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
}));

// next/headers as a Server Action sees it: the request's headers (the session) and a cookie jar.
const request = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    has: (name: string) => request.cookies.has(name),
    set: (name: string, value: string) => void request.cookies.set(name, value),
    delete: (name: string) => void request.cookies.delete(name),
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
  }),
}));

// redirect() throws, as in Next.js; the actions' unstable_rethrow passes it on.
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Redirect) throw error;
  },
  notFound: () => {
    throw new Redirect('/404');
  },
}));

// serverClient with a recorder in front of the real interceptors: which procedure the action
// called and what it answered (ok or the error code).
vi.mock('./server', async (importOriginal) => {
  const original = await importOriginal<typeof import('./server')>();
  const { createRouterClient, ORPCError } = await import('@orpc/server');
  const { createContext } = await import('./context');
  const { logProcedureFailure } = await import('./failure-log');
  const { router: appRouter } = await import('./router');
  return {
    ...original,
    serverClient(headers: Headers, principal?: Principal | null) {
      return createRouterClient(appRouter, {
        context: () => createContext(headers, principal),
        interceptors: [
          async (options: { path: readonly string[]; next: () => Promise<unknown> }) => {
            const procedure = options.path.join('.');
            try {
              const output = await options.next();
              recorded.calls.push({ path: procedure, code: 'ok' });
              return output;
            } catch (error) {
              recorded.calls.push({ path: procedure, code: error instanceof ORPCError ? error.code : 'THROWN' });
              throw error;
            }
          },
          logProcedureFailure,
        ],
      });
    },
  };
});

let testDb: TestDatabase | undefined;
const storageRoot = mkdtempSync(path.join(tmpdir(), 'wcr-authz-matrix-'));
// M14: the photo store, apart from the evidence folder.
const photoRoot = mkdtempSync(path.join(tmpdir(), 'wcr-authz-matrix-photos-'));

// --- actors ---------------------------------------------------------------------------------------

type Role = 'user' | 'moderator' | 'archivist' | 'admin';

interface Actor {
  id: string;
  email: string;
  /** The signed bearer token of a real session row. */
  token: string;
  principal: Principal;
  personId: string | null;
  slug: string | null;
}

/** A session row for `account`, as its signed bearer token; staff sessions prove the second factor unless `unverified`. */
async function sessionFor(account: Account, role: Role, unverified = false): Promise<string> {
  const raw = randomBytes(24).toString('hex');
  await getDb()
    .insert(authSession)
    .values({ id: uuidv7(), userId: account.id, token: raw, expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: role !== 'user' && !unverified ? new Date() : null });
  return signedSessionToken(raw, process.env.BETTER_AUTH_SECRET!);
}

let actors = 0;

/** An account with a session; with its own public person unless `noPerson`; a Sifu when `sifu`. */
async function actor(label: string, opts: { role?: Role; sifu?: boolean; noPerson?: boolean; unverified?: boolean } = {}): Promise<Actor> {
  const role = opts.role ?? 'user';
  actors += 1;
  const account = await createUser(`${label}-${actors}`, role);
  const db = getDb();
  await db.update(authUser).set({ accountType: opts.sifu ? 'sifu' : 'student' }).where(eq(authUser.id, account.id));
  const principal = principalOf(account, role, { unverified: opts.unverified });
  // Every account accepted the documents at sign-up (M02).
  await recordConsents(principal, { kinds: [...SIGN_UP_CONSENTS] }, meta);
  let personId: string | null = null;
  let slug: string | null = null;
  if (!opts.noPerson && role === 'user') {
    personId = uuidv7();
    slug = `demo-${label}-${randomBytes(4).toString('hex')}`;
    await db.insert(person).values({ id: personId, slug, kind: 'living', stewardship: 'self', claimedByUserId: account.id, visibility: 'public' });
    await db.insert(personName).values({ personId, value: `Demo ${label.replace(/[^A-Za-z]+/g, ' ').trim()}`, script: 'Latn', lang: 'en', isPrimary: true });
  }
  return { ...account, token: await sessionFor(account, role, opts.unverified), principal, personId, slug };
}

// --- fixtures ----------------------------------------------------------------------------------

/** A pending request from a new student to a new Sifu, in a lineage of its own. */
async function pendingRequest() {
  const student = await actor('student');
  const teacher = await actor('teacher', { sifu: true });
  const lineageId = await newLineage('m13-authz');
  const result = await requestTeacher(student.principal, { teacherId: teacher.personId!, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
  return { student, teacher, lineageId, relationshipId: result.relationship.id };
}

async function declinedRequest() {
  const r = await pendingRequest();
  await rejectRelationship(r.teacher.principal, { relationshipId: r.relationshipId, reason: 'dates', idempotencyKey: key() }, meta);
  return r;
}

async function verifiedLink() {
  const r = await pendingRequest();
  await approveRelationship(r.teacher.principal, { relationshipId: r.relationshipId, idempotencyKey: key() }, meta);
  return r;
}

function fictionalPdf(seed: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`%PDF-1.4\n% Demo evidence ${seed}, invented for the WingChunRoots tests.\n%%EOF\n`);
}

async function upload(owner: Actor, seed = randomBytes(4).toString('hex')) {
  const bytes = fictionalPdf(seed);
  return uploadEvidence(owner.principal, { declaredLength: bytes.length, body: new Response(bytes).body!, name: encodeURIComponent(`demo-${seed}.pdf`), caseId: null }, meta);
}

/** A historical claim with evidence: an open review case, an unclaimed teacher record. */
async function historicalClaim() {
  const student = await actor('claimant');
  const file = await upload(student);
  const lineageId = await newLineage('m13-authz-hist');
  const result = await requestHistoricalTeacher(
    student.principal,
    { teacherName: 'Demo Historical Teacher', lifeStatus: 'deceased', lineageId, periods: ongoingFrom('1988-03'), evidenceIds: [file.id], note: 'A fictional certificate.', idempotencyKey: key() },
    meta,
  );
  const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, result.relationship.id));
  const [record] = await getDb().select({ slug: person.slug }).from(person).where(eq(person.id, rel!.teacherPersonId));
  return { student, file, caseId: result.caseId, relationshipId: result.relationship.id, recordId: rel!.teacherPersonId, recordSlug: record!.slug };
}

/** An instructor verification: a review case of its Sifu, open for their replies. */
async function instructorCase() {
  const owner = await actor('instructor-case', { sifu: true });
  const file = await upload(owner);
  const result = await requestInstructorVerification(owner.principal, { evidenceIds: [file.id], idempotencyKey: key() }, meta);
  return { owner, caseId: result.caseId };
}

let addresses = 0;

/** The token of the newest invitation e-mail to an address (the e-mail is the only place it is). */
async function tokenSentTo(email: string): Promise<string> {
  const rows = await getDb().execute<{ data: EmailSendJob }>(sql`
    SELECT j.data FROM pgboss.job j JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
     WHERE j.name = 'email.send' AND d.template = 'invitation' AND d.to_email = ${email}
     ORDER BY d.created_at DESC, d.id DESC LIMIT 1`);
  const data = jobTemplateData(rows.rows[0]!.data) as { url: string };
  return new URL(data.url).pathname.replace('/invite/', '');
}

/** A student lists a teacher who is not here yet; with `email`, the invitation is sent. */
async function invitation(withEmail = true) {
  const student = await actor('inviter');
  const email = `demo-invited-${(addresses += 1)}-${randomBytes(3).toString('hex')}@example.test`;
  const lineageId = await newLineage('m13-authz-invite');
  const result = await inviteTeacher(
    student.principal,
    { teacherName: 'Demo Invited Teacher', lineageId, periods: ongoingFrom('2012-09'), email: withEmail ? email : null, evidenceIds: [], idempotencyKey: key() },
    meta,
  );
  return { student, email, relationshipId: result.relationship.id, token: withEmail ? await tokenSentTo(email) : '' };
}

/** A Sifu with a draft school in a city of the GeoNames extract; Professional Sifu when `pro`. */
async function draftSchool(opts: { pro?: boolean; status?: 'active' } = {}) {
  const owner = await actor('school-owner', { sifu: true });
  if (opts.pro) await createGrant(world.admin.principal, { email: owner.email, planCode: 'pro_sifu', reason: 'M13 authorization matrix (fictional)' }, meta);
  const city = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place ORDER BY population DESC NULLS LAST, id LIMIT 1`);
  const saved = await createSchool(owner.principal, { name: 'Demo Matrix Hall', placeId: city.rows[0]!.id, locationPrivacy: 'city_only', idempotencyKey: key() }, meta);
  if (opts.status) await getDb().execute(sql`UPDATE school SET status = ${opts.status} WHERE id = ${saved.id}::uuid`);
  return { owner, schoolId: saved.id, slug: saved.slug, placeId: city.rows[0]!.id };
}

/** M21: a trial lesson request from a new student (the `party`) to a listed school of a Professional Sifu (the `owner`). */
async function trialInquiryOf() {
  const s = await draftSchool({ pro: true, status: 'active' });
  const sender = await actor('trial-sender');
  const sent = await requestTrial(sender.principal, { schoolId: s.schoolId, contactMethod: 'email', message: 'A fictional request.' }, meta);
  return { school: s, sender, inquiryId: sent.id };
}

/** M14: a generated flat-colour image (fictional) as an upload. */
async function photoFile(): Promise<File> {
  return new File([new Uint8Array(await plainImage('png', 160, 120))], 'demo-photo.png', { type: 'image/png' });
}

/** M14: an account whose own person has a profile photo; its person hidden when `hidden`. */
async function withPhoto(label: string, opts: { hidden?: boolean } = {}) {
  const owner = await actor(label);
  const uploaded = await uploadPhoto(owner.principal, { file: await photoFile() }, meta);
  if (opts.hidden) await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, owner.personId!));
  // `/api/photos/<id>/<hash>/96.webp` → the route's params.
  const [, , , id, hash] = uploaded.photo.small.split('/');
  return { owner, slug: owner.slug!, address: { id: id!, hash: hash!, file: '96.webp' } };
}

/** `/api/.../<id>/<hash>/<file>` → the route's params. */
function addressOf(url: string) {
  const [, , , id, hash, file] = url.split('/');
  return { id: id!, hash: hash!, file: file! };
}

/** M16: an account whose gallery holds its profile photo; its person hidden when `hidden`. */
async function withGallery(label: string, opts: { hidden?: boolean } = {}) {
  const owner = await actor(label);
  const added = await addGalleryPhoto(owner.principal, { file: await photoFile() }, meta);
  if (opts.hidden) await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, owner.personId!));
  return { owner, slug: owner.slug!, photoId: added.photo.id, address: addressOf(added.photo.full) };
}

/** M16: the world's member without photos again (its Free Student allowance is one). */
async function clearPhotosOf(who: Actor) {
  await getDb().update(person).set({ photoId: null }).where(eq(person.id, who.personId!));
  await getDb().update(personPhoto).set({ status: 'removed', removedAt: new Date() }).where(eq(personPhoto.personId, who.personId!));
}

/** M16: a room photo of a school (listed, public, of a Professional Sifu when `listed`; a draft otherwise). */
async function schoolWithPhoto(opts: { listed?: boolean } = {}) {
  const s = await draftSchool(opts.listed ? { pro: true, status: 'active' } : {});
  const up = await uploadSchoolPhoto(s.owner.principal, { schoolId: s.schoolId, kind: 'room', file: await photoFile() }, meta);
  return { ...s, photoId: up.room!.id, address: addressOf(up.room!.full) };
}

/** M15: an organization's application by a new account (its owner); approved when `active`, with Federation when `federation`. */
async function organizationOf(opts: { active?: boolean; federation?: boolean } = {}) {
  const owner = await actor('org-owner', { noPerson: true });
  const applied = await applyOrganization(
    owner.principal,
    { name: 'Demo Matrix Federation', kind: 'federation', leaderName: 'Demo Leader', leaderTitle: null, websiteUrl: null, countryCode: 'BG', schoolsEstimate: 3, evidenceIds: [], note: null, idempotencyKey: key() },
    meta,
  );
  if (opts.active || opts.federation) {
    await getDb().execute(sql`UPDATE organization SET status = 'active', approved_at = now() WHERE id = ${applied.organizationId}::uuid`);
    await getDb().execute(sql`UPDATE review_case SET status = 'resolved', resolution = 'approved', resolved_at = now() WHERE id = ${applied.caseId}::uuid`);
  }
  let grantId: string | null = null;
  if (opts.federation) {
    const view = await grantOrganizationPlan(world.admin.principal, { organizationId: applied.organizationId, reason: 'M15 authorization matrix (fictional)' }, meta);
    grantId = view.grants[0]!.id;
  }
  const [row] = await getDb().execute<{ slug: string }>(sql`SELECT slug FROM organization WHERE id = ${applied.organizationId}::uuid`).then((r) => r.rows);
  return { owner, organizationId: applied.organizationId, caseId: applied.caseId, slug: row!.slug, grantId };
}

/** M15: the owner of another approved organization: it administers that one, never this one. */
async function otherOrganizationAdmin(): Promise<Actor> {
  return (await organizationOf({ active: true })).owner;
}

/** M15: a pending link from an organization with Federation to a listed school of a Professional Sifu. */
async function schoolLink() {
  const org = await organizationOf({ federation: true });
  const s = await draftSchool({ pro: true, status: 'active' });
  const link = await requestOrganizationSchool(org.owner.principal, { organizationId: org.organizationId, schoolSlug: s.slug }, meta);
  return { org, school: s, linkId: link.linkId };
}

/** M17: a Professional Sifu's published event in a city (a year ahead, so it is upcoming); with a poster when `poster`. */
async function eventOf(opts: { poster?: boolean } = {}) {
  const owner = await actor('event-owner', { sifu: true });
  await createGrant(world.admin.principal, { email: owner.email, planCode: 'pro_sifu', reason: 'M17 authorization matrix (fictional)' }, meta);
  const city = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place ORDER BY population DESC NULLS LAST, id LIMIT 1`);
  // A new organizer each time, so the allowance (three a month) is never what refuses a call.
  const day = `${new Date().getUTCFullYear() + 1}-03-10`;
  const created = await createEvent(
    owner.principal,
    { title: 'Demo Matrix Seminar', kind: 'seminar', startsAt: `${day}T10:00`, endsAt: `${day}T16:00`, placeId: city.rows[0]!.id },
    meta,
  );
  let poster: { id: string; hash: string; file: string } | null = null;
  if (opts.poster) {
    const up = await uploadEventPoster(owner.principal, { id: created.id, file: await photoFile() }, meta);
    poster = addressOf(up.poster!.small);
  }
  return { owner, id: created.id, slug: created.slug, placeId: city.rows[0]!.id, day, poster };
}

/**
 * M19: a teacher (the `owner`, who records) and their student (the `party`) with a verified
 * relationship; the student on Premium Student when `full`; a rank the teacher recorded.
 */
async function passportOf(opts: { full?: boolean; hidden?: boolean } = {}) {
  const teacher = await actor('passport-teacher', { sifu: true });
  const student = await actor('passport-student');
  const lineageId = await newLineage('m19-authz');
  await getDb().insert(teachingRelationship).values({ teacherPersonId: teacher.personId!, studentPersonId: student.personId!, lineageId, status: 'verified', visibility: 'public' });
  if (opts.full) await createGrant(world.admin.principal, { email: student.email, planCode: 'premium_student', reason: 'M19 authorization matrix (fictional)' }, meta);
  const rank = await addRank(teacher.principal, { personId: student.personId!, rank: 'Demo matrix level', date: '2020' }, meta);
  if (opts.hidden) await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, student.personId!));
  return { teacher, student, rankId: rank.id };
}

/** M19: a certificate of the student (private unless `public`, on Premium Student). */
async function certificateOf(opts: { public?: boolean } = {}) {
  const p = await passportOf({ full: true });
  const up = await uploadCertificate(p.student.principal, { file: await photoFile(), title: 'Demo matrix certificate', visibility: opts.public ? 'public' : 'private' }, meta);
  return { ...p, certificateId: up.id, address: addressOf(up.image.small) };
}

/** M19: a past published event the teacher organized (moved a year back after it was created). */
async function pastEventOf() {
  const p = await passportOf();
  const e = await eventOf();
  await getDb().execute(sql`UPDATE event SET organizer_person_id = ${p.teacher.personId}::uuid, organizer_user_id = ${p.teacher.id}::uuid,
    starts_at = starts_at - interval '2 years', ends_at = ends_at - interval '2 years' WHERE id = ${e.id}::uuid`);
  return { ...p, eventId: e.id };
}

/** M22: an open test checkout of a new Student account (the `owner`). */
async function openCheckoutOf() {
  const owner = await actor('billing-checkout');
  const checkout = await startCheckout(owner.principal, { planCode: 'premium_student' }, meta);
  return { owner, checkoutId: checkout.checkoutId };
}

/** M22: a paid test subscription of a new Student account (the `owner`), cancelled at the period end when `cancelled`. */
async function subscriptionOf(opts: { cancelled?: boolean } = {}) {
  const owner = await actor('billing-subscriber');
  const { subscription } = await paidSubscription(owner.principal, 'premium_student');
  if (opts.cancelled) await cancelSubscription(owner.principal, { subscriptionId: subscription.id }, meta);
  return { owner, subscriptionId: subscription.id };
}

/** M23: an approved federation (its `owner`) with a co-admin (`party`: reads, never changes); with a monthly Federation subscription when `subscribed`. */
async function federationBillingOf(opts: { subscribed?: boolean } = {}) {
  const o = await organizationOf({ active: true });
  const party = await actor('org-co-admin', { noPerson: true });
  await addOrganizationAdmin(o.owner.principal, { organizationId: o.organizationId, email: party.email }, meta);
  let subscriptionId: string | null = null;
  if (opts.subscribed) {
    const checkout = await startCheckout(o.owner.principal, { planCode: 'federation', interval: 'month', organizationId: o.organizationId }, meta);
    await testPay(o.owner.principal, { checkoutId: checkout.checkoutId, card: 'succeeds' }, meta);
    await applyPendingBillingEvents();
    const [row] = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM billing_subscription WHERE checkout_id = ${checkout.checkoutId}::uuid`).then((r) => r.rows);
    subscriptionId = row!.id;
  }
  return { ...o, party, subscriptionId };
}

async function notificationOf(userId: string): Promise<string> {
  const id = uuidv7();
  await getDb().insert(notification).values({ id, userId, template: 'relationship.approved', payload: {} });
  return id;
}

// --- the world: actors whose role, not ownership, matters ------------------------------------

interface World {
  member: Actor;
  moderator: Actor;
  archivist: Actor;
  admin: Actor;
  adminNo2fa: Actor;
}
let world: World;

// --- the matrix ---------------------------------------------------------------------------------

const ROLES = ['anonymous', 'member', 'owner', 'party', 'moderator', 'archivist', 'admin', 'adminNo2fa'] as const;
type Who = (typeof ROLES)[number];
/** 'ok', or the oRPC error code the call is refused with. */
type Outcome = 'ok' | 'UNAUTHORIZED' | 'SECOND_FACTOR_REQUIRED' | 'CONSENT_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'ENTITLEMENT_REQUIRED';

interface Made {
  input: unknown;
  /** The account the object belongs to, or whose answer it waits for. */
  owner?: Actor;
  /** The other party of the object (the student of a request the teacher answers…). */
  party?: Actor;
}

interface Row {
  /** The procedure (`relationships.approve`) or an evidence route (`GET /api/evidence/{id}`). */
  path: string;
  /** Fresh fixtures for one call by `who` (a world role's actor is world[who]). */
  make: (who: Who) => Promise<Made> | Made;
  expect: Partial<Record<Who, Outcome>>;
}

const signedInOnly = { anonymous: 'UNAUTHORIZED' } as const;
const WORLD_ROLES = ['member', 'moderator', 'archivist', 'admin', 'adminNo2fa'] as const;
const worldActor = (who: Who): Actor | null => ((WORLD_ROLES as readonly string[]).includes(who) ? world[who as (typeof WORLD_ROLES)[number]] : null);
/** Every signed-in account, for its own data (no object of another account in the input). */
const own = (outcome: Outcome = 'ok') =>
  ({ ...signedInOnly, member: outcome, moderator: outcome, archivist: outcome, admin: outcome, adminNo2fa: outcome }) as const;
const everyone = { anonymous: 'ok', member: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' } as const;
/** Staff with a verified second factor; the roles the service allows say 'ok'. */
const staffOnly = (allowed: { moderator?: Outcome; archivist?: Outcome; admin?: Outcome }) =>
  ({ ...signedInOnly, member: 'FORBIDDEN', adminNo2fa: 'SECOND_FACTOR_REQUIRED', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', ...allowed }) as const;

const noInput = () => ({ input: undefined });

const ROWS: Row[] = [
  // account
  { path: 'account.me', make: noInput, expect: own() },
  { path: 'account.landing', make: () => ({ input: { next: '/dashboard' } }), expect: own() },
  { path: 'account.twoFactor', make: noInput, expect: own() },
  { path: 'account.onboardingOptions', make: noInput, expect: own() },
  {
    path: 'account.onboard',
    make: async () => ({ owner: await actor('onboarding', { noPerson: true }), input: { primaryName: 'Demo Onboarding Person', showPublicly: false } }),
    expect: { ...signedInOnly, owner: 'ok', member: 'CONFLICT' },
  },
  // Own-account changes run as a fresh account (the owner), so the shared actors stay as they are.
  { path: 'account.setType', make: async () => ({ owner: await actor('type'), input: { accountType: 'sifu' } }), expect: { ...signedInOnly, owner: 'ok' } },
  { path: 'account.privacy', make: noInput, expect: own() },
  { path: 'account.requestDeletion', make: async () => ({ owner: await actor('deleting'), input: { confirm: true } }), expect: { ...signedInOnly, owner: 'ok' } },
  { path: 'consent.record', make: async () => ({ owner: await actor('consenting'), input: { kinds: ['terms'] } }), expect: { ...signedInOnly, owner: 'ok' } },
  { path: 'consent.withdraw', make: async () => ({ owner: await actor('withdrawing'), input: { kinds: ['privacy_ack'] } }), expect: { ...signedInOnly, owner: 'ok' } },
  { path: 'profile.get', make: noInput, expect: own() },
  {
    path: 'profile.update',
    make: async () => {
      const owner = await actor('profile');
      return { owner, input: { personId: owner.personId, names: [{ value: 'Demo Profile Person', script: 'Latn', lang: 'en', isPrimary: true }], showPublicly: true } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'FORBIDDEN', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'FORBIDDEN' },
  },
  { path: 'search.query', make: () => ({ input: { q: 'Demo' } }), expect: everyone },
  { path: 'admin.overview', make: noInput, expect: staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }) },
  // M12: /admin/system, any staff role with a verified second factor (requireStaff2FA).
  { path: 'system.status', make: noInput, expect: staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }) },
  {
    path: 'admin.setRole',
    // A staff account keeps its second factor (a member without one cannot become staff).
    make: async () => ({ input: { userId: (await createUser('set-role-target', 'moderator')).id, role: 'archivist', reason: 'M13 matrix' } }),
    expect: staffOnly({ admin: 'ok' }),
  },
  // public lineage reads
  ...(['lineage.ego', 'lineage.ancestors', 'lineage.paths'] as const).map(
    (p): Row => ({ path: p, make: async () => ({ input: { focusId: (await verifiedLink()).student.personId } }), expect: everyone }),
  ),
  { path: 'lineage.subtree', make: async () => ({ input: { rootId: (await verifiedLink()).teacher.personId } }), expect: everyone },
  { path: 'lineage.start', make: noInput, expect: everyone },
  { path: 'people.get', make: async () => ({ input: { slug: (await verifiedLink()).teacher.slug } }), expect: everyone },
  { path: 'people.students', make: async () => ({ input: { slug: (await verifiedLink()).teacher.slug } }), expect: everyone },
  {
    // A person who is not public is 404 for every visitor and member; its own account and the
    // reviewers (staff with a verified second factor) see it (plan §6.4, DEFAULT D03).
    path: 'people.get (hidden person)',
    make: async () => {
      const owner = await actor('hidden');
      await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, owner.personId!));
      return { owner, input: { slug: owner.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  // plans, grants, notifications
  { path: 'plans.catalog', make: noInput, expect: everyone },
  { path: 'plans.mine', make: noInput, expect: own() },
  { path: 'plans.requestPilotAccess', make: async () => ({ owner: await actor('pilot'), input: { planCode: 'premium_student' } }), expect: { ...signedInOnly, owner: 'ok' } },
  { path: 'grants.list', make: () => ({ input: {} }), expect: staffOnly({ admin: 'ok' }) },
  {
    path: 'grants.create',
    make: async () => ({ input: { email: (await actor('grantee')).email, planCode: 'premium_student', reason: 'M13 matrix (fictional)' } }),
    expect: staffOnly({ admin: 'ok' }),
  },
  {
    path: 'grants.revoke',
    // The account the grant is for has no say in it (party).
    make: async () => {
      const grantee = await actor('revokee');
      const grant = await createGrant(world.admin.principal, { email: grantee.email, planCode: 'premium_student', reason: 'M13 matrix (fictional)' }, meta);
      return { party: grantee, input: { grantId: grant.id, reason: 'M13 matrix' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), party: 'FORBIDDEN' },
  },
  {
    path: 'grants.closeRequest',
    make: async () => {
      const requester = await actor('pilot-requester');
      const outcome = await requestPilotAccess(requester.principal, { planCode: 'premium_student' }, meta);
      return { party: requester, input: { requestId: outcome.request.id, reason: 'M13 matrix' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), party: 'FORBIDDEN' },
  },
  { path: 'notifications.list', make: noInput, expect: own() },
  {
    path: 'notifications.markRead',
    make: async () => {
      const owner = await actor('notified');
      return { owner, input: { ids: [await notificationOf(owner.id)] } };
    },
    // Another account's ids mark nothing (the service matches the caller's own rows only).
    expect: { ...own(), owner: 'ok' },
  },
  // M18: "Mark all as read", the e-mail preferences and the one-press unsubscribe (no sign-in: the
  // link's token is the authority, for its own account and category only).
  { path: 'notifications.markAllRead', make: () => ({ input: { category: 'plan' } }), expect: own() },
  { path: 'notifications.preferences', make: noInput, expect: own() },
  { path: 'notifications.setPreference', make: () => ({ input: { category: 'events', email: true } }), expect: own() },
  ...(['notifications.unsubscribeInfo', 'notifications.unsubscribe'] as const).map(
    (p): Row => ({ path: p, make: async () => ({ input: { token: signUnsubscribeToken({ userId: (await actor('unsubscribed')).id, category: 'teaching', version: 0 }) } }), expect: everyone }),
  ),
  // teacher requests
  {
    path: 'relationships.request',
    make: async () => ({ party: await actor('requested', { sifu: true }), input: undefined }),
    expect: { ...signedInOnly, member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.resubmit',
    make: async () => {
      const r = await declinedRequest();
      return { owner: r.student, party: r.teacher, input: { relationshipId: r.relationshipId, lineageId: r.lineageId, periods: ongoingFrom('2018-01'), idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.approve',
    make: async () => {
      const r = await pendingRequest();
      return { owner: r.teacher, party: r.student, input: { relationshipId: r.relationshipId, idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.reject',
    make: async () => {
      const r = await pendingRequest();
      return { owner: r.teacher, party: r.student, input: { relationshipId: r.relationshipId, reason: 'dates', idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.withdraw',
    make: async () => {
      const r = await pendingRequest();
      return { owner: r.student, party: r.teacher, input: { relationshipId: r.relationshipId, idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.end',
    make: async () => {
      const r = await verifiedLink();
      return { owner: r.student, party: r.teacher, input: { relationshipId: r.relationshipId, endedOn: '2024', idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'ok', member: 'NOT_FOUND', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'relationships.mine', make: noInput, expect: own() },
  { path: 'relationships.incoming', make: noInput, expect: own() },
  { path: 'relationships.options', make: noInput, expect: own() },
  {
    path: 'relationships.get',
    make: async () => {
      const r = await pendingRequest();
      return { owner: r.student, party: r.teacher, input: { id: r.relationshipId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'ok', member: 'NOT_FOUND', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.requestHistorical',
    make: async () => {
      const owner = await actor('historical');
      const file = await upload(owner);
      return {
        owner,
        input: { teacherName: 'Demo Historical Matrix', lifeStatus: 'deceased', lineageId: await newLineage('m13-authz-h'), periods: ongoingFrom('1990-01'), evidenceIds: [file.id], idempotencyKey: key() },
      };
    },
    // Someone else's evidence file is refused as a field error; staff accounts have no profile to claim with.
    expect: { ...signedInOnly, owner: 'ok', member: 'BAD_REQUEST', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'relationships.invite',
    make: async () => ({ input: { teacherName: 'Demo Invitee Matrix', lineageId: await newLineage('m13-authz-i'), periods: ongoingFrom('2012-09'), email: null, evidenceIds: [], idempotencyKey: key() } }),
    expect: { ...signedInOnly, member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'invitations.send',
    make: async () => {
      const r = await invitation(false);
      return { owner: r.student, input: { relationshipId: r.relationshipId, email: `demo-resend-${randomBytes(3).toString('hex')}@example.test`, idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'invitations.get',
    make: async () => {
      const r = await invitation();
      return { owner: r.student, input: { token: r.token } };
    },
    expect: { ...everyone, owner: 'ok' },
  },
  {
    // The token is the secret: an account without a profile of its own that holds the link accepts
    // it (the invitee, a new Sifu account), and an archivist reviews the claim before the record is
    // theirs (M10b). An account with a profile, the student who sent it among them, cannot take
    // another record.
    path: 'invitations.accept',
    make: async () => {
      const r = await invitation();
      return { owner: await actor('invitee', { sifu: true, noPerson: true }), party: r.student, input: { token: r.token, idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'CONFLICT', party: 'CONFLICT', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' },
  },
  { path: 'instructor.mine', make: noInput, expect: own() },
  {
    path: 'instructor.request',
    make: async () => {
      const owner = await actor('instructor', { sifu: true });
      return { owner, input: { evidenceIds: [(await upload(owner)).id], idempotencyKey: key() } };
    },
    // A Student account is not an instructor; staff accounts have no profile.
    expect: { ...signedInOnly, owner: 'ok', member: 'CONFLICT', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'reports.mine', make: noInput, expect: own() },
  {
    path: 'reports.create',
    make: async () => {
      const target = await actor('reported');
      return { party: target, input: { personId: target.personId, reason: 'spam', idempotencyKey: key() } };
    },
    // Not one's own profile.
    expect: { ...signedInOnly, member: 'ok', party: 'FORBIDDEN', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' },
  },
  { path: 'cases.mine', make: noInput, expect: own() },
  {
    path: 'cases.get',
    make: async () => {
      const c = await instructorCase();
      return { owner: c.owner, input: { id: c.caseId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'cases.reply',
    make: async () => {
      const c = await instructorCase();
      return { owner: c.owner, input: { caseId: c.caseId, body: 'A fictional answer.', idempotencyKey: key() } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'evidence.discard',
    make: async () => {
      const owner = await actor('uploader');
      return { owner, input: { id: (await upload(owner)).id } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  // M14: profile photos. Reads follow the person pages (a hidden person: its own account and the
  // reviewers); uploads are the own person's only; staff remove anyone's with a reason.
  { path: 'photos.get', make: async () => ({ input: { slug: (await withPhoto('photo-public')).slug } }), expect: everyone },
  {
    path: 'photos.get (hidden person)',
    make: async () => {
      const p = await withPhoto('photo-hidden', { hidden: true });
      return { owner: p.owner, input: { slug: p.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'photos.upload',
    make: async () => ({ owner: await actor('photo-uploader'), input: null }),
    // Staff accounts have no own person to put a photo on.
    expect: { ...signedInOnly, owner: 'ok', member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'photos.remove',
    make: async () => ({ owner: (await withPhoto('photo-remover')).owner, input: {} }),
    expect: { ...signedInOnly, owner: 'ok', member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'photos.remove (another account\'s photo, with a reason)',
    make: async () => {
      const p = await withPhoto('photo-moderated');
      return { owner: p.owner, input: { slug: p.slug, reason: 'A fictional moderation reason.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'SECOND_FACTOR_REQUIRED' },
  },
  {
    path: 'GET /api/photos/{id}/{hash}/{file}',
    make: async () => ({ input: (await withPhoto('photo-served')).address }),
    expect: { anonymous: 'ok', member: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' },
  },
  {
    path: 'GET /api/photos/{id}/{hash}/{file} (hidden person)',
    make: async () => {
      const p = await withPhoto('photo-served-hidden', { hidden: true });
      return { owner: p.owner, input: p.address };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  // M16: galleries. A person's gallery follows the person pages; changes are the own person's
  // only; staff remove anyone's photo with a reason. A school's photos: the account that listed it.
  {
    path: 'gallery.mine',
    make: noInput,
    expect: { ...signedInOnly, member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'gallery.get', make: async () => ({ input: { slug: (await withGallery('gallery-public')).slug } }), expect: everyone },
  {
    path: 'gallery.get (hidden person)',
    make: async () => {
      const g = await withGallery('gallery-hidden', { hidden: true });
      return { owner: g.owner, input: { slug: g.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'gallery.add',
    make: async (who) => {
      if (who === 'member') await clearPhotosOf(world.member);
      return { owner: await actor('gallery-adder'), input: null };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'gallery.remove',
    make: async () => {
      const g = await withGallery('gallery-remover');
      return { owner: g.owner, input: { photoId: g.photoId } };
    },
    // Staff remove another account's photo only with a reason (the row below).
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'BAD_REQUEST', archivist: 'BAD_REQUEST', admin: 'BAD_REQUEST', adminNo2fa: 'SECOND_FACTOR_REQUIRED' },
  },
  {
    path: "gallery.remove (another account's photo, with a reason)",
    make: async () => {
      const g = await withGallery('gallery-moderated');
      return { owner: g.owner, input: { photoId: g.photoId, reason: 'A fictional moderation reason.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'SECOND_FACTOR_REQUIRED' },
  },
  {
    path: 'gallery.update',
    make: async () => {
      const g = await withGallery('gallery-captioned');
      return { owner: g.owner, input: { photoId: g.photoId, caption: 'A fictional caption' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'gallery.reorder',
    make: async () => {
      const g = await withGallery('gallery-ordered');
      return { owner: g.owner, input: { photoIds: [g.photoId] } };
    },
    // Another member's list is checked against that member's own gallery, which this photo is not in.
    expect: { ...signedInOnly, owner: 'ok', member: 'CONFLICT', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'gallery.setProfile',
    make: async () => {
      const g = await withGallery('gallery-profile');
      return { owner: g.owner, input: { photoId: g.photoId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schoolPhotos.get',
    make: async () => {
      const s = await schoolWithPhoto();
      return { owner: s.owner, input: { schoolId: s.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'SECOND_FACTOR_REQUIRED' },
  },
  {
    path: 'schoolPhotos.upload',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { schoolId: s.schoolId, kind: 'room' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schoolPhotos.remove',
    make: async () => {
      const s = await schoolWithPhoto();
      return { owner: s.owner, input: { photoId: s.photoId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'BAD_REQUEST', archivist: 'BAD_REQUEST', admin: 'BAD_REQUEST', adminNo2fa: 'SECOND_FACTOR_REQUIRED' },
  },
  {
    path: "schoolPhotos.remove (another account's photo, with a reason)",
    make: async () => {
      const s = await schoolWithPhoto();
      return { owner: s.owner, input: { photoId: s.photoId, reason: 'A fictional moderation reason.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'SECOND_FACTOR_REQUIRED' },
  },
  {
    path: 'schoolPhotos.update',
    make: async () => {
      const s = await schoolWithPhoto();
      return { owner: s.owner, input: { photoId: s.photoId, caption: 'A fictional caption' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schoolPhotos.reorder',
    make: async () => {
      const s = await schoolWithPhoto();
      return { owner: s.owner, input: { schoolId: s.schoolId, photoIds: [s.photoId] } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'GET /api/school-photos/{id}/{hash}/{file}',
    make: async () => ({ input: (await schoolWithPhoto({ listed: true })).address }),
    expect: { anonymous: 'ok', member: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' },
  },
  {
    path: 'GET /api/school-photos/{id}/{hash}/{file} (school not public)',
    make: async () => {
      const s = await schoolWithPhoto();
      return { owner: s.owner, input: s.address };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'GET /api/photos/{id}/{hash}/{file} (a hidden person\'s gallery photo, whole)',
    make: async () => {
      const g = await withGallery('gallery-served-hidden', { hidden: true });
      return { owner: g.owner, input: g.address };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  // the review queue and the archive (staff with a verified second factor)
  { path: 'review.list', make: () => ({ input: {} }), expect: staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }) },
  {
    path: 'review.get',
    make: async () => {
      const c = await historicalClaim();
      return { owner: c.student, input: { id: c.caseId } };
    },
    expect: { ...staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    // Any reviewer takes a case (M10a); who decides it depends on its kind (review.decide).
    path: 'review.assign',
    make: async (who) => {
      const c = await historicalClaim();
      const caller = who === 'owner' ? c.student : worldActor(who);
      return { owner: c.student, input: { caseId: c.caseId, assigneeId: caller?.id ?? uuidv7(), idempotencyKey: key() } };
    },
    expect: { ...staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    // Refusing a historical claim: an archivist (who took the case) or an administrator.
    path: 'review.decide',
    make: async (who) => {
      const c = await historicalClaim();
      const reviewer = worldActor(who);
      if (reviewer && reviewer.principal.user.role !== 'user' && reviewer !== world.adminNo2fa) {
        await assignReviewCase(reviewer.principal, { caseId: c.caseId, assigneeId: reviewer.id, idempotencyKey: key() }, meta);
      }
      return { owner: c.student, input: { caseId: c.caseId, decision: 'reject', reason: 'The fictional certificate does not name the teacher.', idempotencyKey: key() } };
    },
    expect: { ...staffOnly({ archivist: 'ok', admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'review.arbitrate',
    make: async () => {
      const r = await verifiedLink();
      return { owner: r.teacher, party: r.student, input: { relationshipId: r.relationshipId, reason: 'A fictional dispute.', idempotencyKey: key() } };
    },
    expect: { ...staffOnly({ moderator: 'ok', admin: 'ok' }), owner: 'FORBIDDEN', party: 'FORBIDDEN' },
  },
  {
    path: 'review.note',
    make: async () => {
      const c = await historicalClaim();
      return { owner: c.student, input: { caseId: c.caseId, body: 'A fictional note.', idempotencyKey: key() } };
    },
    expect: { ...staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'archive.get',
    make: async () => ({ input: { slug: (await historicalClaim()).recordSlug } }),
    expect: staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }),
  },
  {
    path: 'archive.update',
    make: async () => {
      const c = await historicalClaim();
      return { input: { personId: c.recordId, primaryName: 'Demo Historical Teacher', lifeStatus: 'deceased', reason: 'A fictional correction.', evidenceIds: [], idempotencyKey: key() } };
    },
    expect: staffOnly({ archivist: 'ok' }),
  },
  // schools
  { path: 'schools.search', make: () => ({ input: {} }), expect: everyone },
  { path: 'schools.inViewport', make: () => ({ input: { west: -10, south: 35, east: 30, north: 60 } }), expect: everyone },
  {
    path: 'schools.get',
    make: async () => ({ input: { slug: (await draftSchool()).slug } }),
    // A draft is not public: 404 for everyone, its owner included (the editor is schools.edit).
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'schools.sitemap', make: noInput, expect: everyone },
  { path: 'schools.mine', make: noInput, expect: own() },
  {
    path: 'schools.edit',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    // Staff accounts have no profile, so no schools of their own.
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'CONFLICT', archivist: 'CONFLICT', admin: 'CONFLICT', adminNo2fa: 'CONFLICT' },
  },
  { path: 'schools.options', make: () => ({ input: {} }), expect: { ...own('CONFLICT'), member: 'ok' } },
  {
    path: 'schools.create',
    make: async () => {
      const owner = await actor('school-creator', { sifu: true });
      const city = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place ORDER BY population DESC NULLS LAST, id LIMIT 1`);
      return { owner, input: { name: 'Demo Created Hall', placeId: city.rows[0]!.id, locationPrivacy: 'city_only', idempotencyKey: key() } };
    },
    // A Student account lists no school (a Sifu with a profile does); nor does a staff account.
    expect: { ...signedInOnly, owner: 'ok', member: 'FORBIDDEN', moderator: 'FORBIDDEN', archivist: 'FORBIDDEN', admin: 'FORBIDDEN', adminNo2fa: 'FORBIDDEN' },
  },
  {
    path: 'schools.update',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { id: s.schoolId, name: 'Demo Renamed Hall', placeId: s.placeId, locationPrivacy: 'city_only' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schools.submit',
    make: async () => {
      const s = await draftSchool({ pro: true });
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schools.submit (free Sifu)',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    expect: { owner: 'ENTITLEMENT_REQUIRED' },
  },
  {
    path: 'schools.confirm',
    make: async () => {
      const s = await draftSchool({ pro: true, status: 'active' });
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // M20: a school the activity check hid; only its listing account confirms it (and shows it again).
    path: 'schools.confirm (hidden by the activity check)',
    make: async () => {
      const s = await draftSchool({ pro: true, status: 'active' });
      await getDb().execute(sql`
        UPDATE school SET activity_stage = 'hidden', activity_awaiting_since = now() - interval '20 days', activity_hidden_at = now() - interval '5 days'
         WHERE id = ${s.schoolId}::uuid`);
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  // M20: the activity check of the listed schools, for the roles that moderate listings.
  // M21 (docs/adr/0024-trial-lessons.md): the schedule and fees, the statistics and their beacon.
  {
    path: 'schools.schedule',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schools.updateSchedule',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { id: s.schoolId, slots: [{ weekday: 2, startsAt: '18:30', endsAt: '20:00', label: 'Demo class' }], fees: 'A fictional fee.', firstTrialFree: true } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'schools.stats',
    make: async () => {
      const s = await draftSchool({ pro: true, status: 'active' });
      return { owner: s.owner, input: { id: s.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // Anyone may report an event of a public school; the answer says only whether it counted.
    path: 'schools.track',
    make: async () => {
      const s = await draftSchool({ pro: true, status: 'active' });
      return { owner: s.owner, input: { schoolId: s.schoolId, event: 'page_view' } };
    },
    expect: { ...everyone, owner: 'ok' },
  },
  { path: 'schools.adminList', make: () => ({ input: { stage: 'hidden' } }), expect: staffOnly({ moderator: 'ok', admin: 'ok' }) },
  // M21: trial lesson requests. `owner` is the school's listing account, `party` the sender.
  {
    path: 'trial.options',
    make: async () => {
      const s = await draftSchool({ pro: true, status: 'active' });
      return { owner: s.owner, input: { slug: s.slug } };
    },
    expect: { ...everyone, owner: 'ok' },
  },
  {
    path: 'trial.options (a draft)',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { slug: s.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'NOT_FOUND', moderator: 'NOT_FOUND', admin: 'NOT_FOUND' },
  },
  {
    path: 'trial.request',
    make: async () => {
      const s = await draftSchool({ pro: true, status: 'active' });
      return { owner: s.owner, input: { schoolId: s.schoolId, contactMethod: 'email', preferredTimes: 'Weekday evenings', message: 'A fictional request.' } };
    },
    // Never at one's own school; staff accounts have no profile, whose name the school would see.
    expect: { ...signedInOnly, member: 'ok', owner: 'CONFLICT', moderator: 'CONFLICT', archivist: 'CONFLICT', admin: 'CONFLICT', adminNo2fa: 'CONFLICT' },
  },
  {
    path: 'trial.request (a draft)',
    make: async () => {
      const s = await draftSchool();
      return { owner: s.owner, input: { schoolId: s.schoolId, contactMethod: 'email' } };
    },
    expect: { ...signedInOnly, member: 'NOT_FOUND', owner: 'NOT_FOUND' },
  },
  { path: 'trial.mine', make: noInput, expect: own() },
  {
    path: 'trial.inbox',
    make: async () => {
      const t = await trialInquiryOf();
      return { owner: t.school.owner, party: t.sender, input: { schoolId: t.school.schoolId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'trial.answer',
    make: async () => {
      const t = await trialInquiryOf();
      return { owner: t.school.owner, party: t.sender, input: { inquiryId: t.inquiryId, reply: 'A fictional reply.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'trial.decline',
    make: async () => {
      const t = await trialInquiryOf();
      return { owner: t.school.owner, party: t.sender, input: { inquiryId: t.inquiryId, reason: 'A fictional reason.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'trial.close',
    make: async () => {
      const t = await trialInquiryOf();
      return { owner: t.school.owner, party: t.sender, input: { inquiryId: t.inquiryId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  // M22: paid plans in test mode. `owner` holds the checkout or subscription; anyone else gets 404.
  { path: 'billing.mine', make: noInput, expect: own() },
  {
    path: 'billing.checkout',
    make: async () => ({ owner: await actor('billing-buyer', { sifu: true }), input: { planCode: 'pro_sifu' } }),
    // Only the paid plan of one's own account type: the shared member is a Student account.
    expect: { ...signedInOnly, owner: 'ok', member: 'BAD_REQUEST' },
  },
  {
    path: 'billing.testCheckout',
    make: async () => {
      const c = await openCheckoutOf();
      return { owner: c.owner, input: { checkoutId: c.checkoutId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', admin: 'NOT_FOUND' },
  },
  {
    path: 'billing.testPay',
    make: async () => {
      const c = await openCheckoutOf();
      return { owner: c.owner, input: { checkoutId: c.checkoutId, card: 'succeeds' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', admin: 'NOT_FOUND' },
  },
  {
    path: 'billing.cancel',
    make: async () => {
      const s = await subscriptionOf();
      return { owner: s.owner, input: { subscriptionId: s.subscriptionId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'billing.resume',
    make: async () => {
      const s = await subscriptionOf({ cancelled: true });
      return { owner: s.owner, input: { subscriptionId: s.subscriptionId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', admin: 'NOT_FOUND' },
  },
  { path: 'billing.adminList', make: () => ({ input: {} }), expect: staffOnly({ admin: 'ok' }) },
  {
    path: 'billing.adminGet',
    make: async () => {
      const s = await subscriptionOf();
      return { owner: s.owner, input: { subscriptionId: s.subscriptionId } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'billing.testClock',
    make: async () => {
      const s = await subscriptionOf();
      return { owner: s.owner, input: { subscriptionId: s.subscriptionId, step: 'period_end' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  // M23: Federation billing. The organization's owner changes; a co-admin (`party`) reads only
  // (403 on a change); anyone else gets 404. Trials are the administrators' (second factor).
  {
    path: 'billing.organization',
    make: async () => {
      const o = await federationBillingOf();
      return { owner: o.owner, party: o.party, input: { organizationId: o.organizationId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'billing.checkout (Federation, for an organization)',
    make: async () => {
      const o = await federationBillingOf();
      return { owner: o.owner, party: o.party, input: { planCode: 'federation', interval: 'year', organizationId: o.organizationId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // Only Federation has a yearly price (DEFAULT D09), so a change is an organization's.
    path: 'billing.changePlan',
    make: async () => {
      const o = await federationBillingOf({ subscribed: true });
      return { owner: o.owner, party: o.party, input: { subscriptionId: o.subscriptionId, planCode: 'federation', interval: 'year' } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'billing.cancelChange',
    make: async () => {
      const s = await subscriptionOf();
      return { owner: s.owner, input: { subscriptionId: s.subscriptionId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'federationTrials.adminGet',
    make: async () => {
      const o = await federationBillingOf();
      return { owner: o.owner, input: { organizationId: o.organizationId } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'federationTrials.start',
    make: async () => {
      const o = await federationBillingOf();
      return { owner: o.owner, input: { organizationId: o.organizationId, months: 12, reason: 'M23 matrix (fictional)' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'federationTrials.end',
    make: async () => {
      const o = await federationBillingOf();
      const started = await startFederationTrial(world.admin.principal, { organizationId: o.organizationId, reason: 'M23 matrix (fictional)' }, meta);
      return { owner: o.owner, input: { trialId: started.trial!.id, reason: 'M23 matrix end (fictional)' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  { path: 'places.search', make: () => ({ input: { q: 'Sofia' } }), expect: everyone },
  { path: 'dashboard.overview', make: noInput, expect: own() },
  // M15: organizations. `party` is the owner of another organization: it reaches only its own
  // (404 here, the same answer as for none), as does every member and staff account.
  { path: 'organizations.list', make: noInput, expect: everyone },
  { path: 'organizations.mine', make: noInput, expect: own() },
  { path: 'organizations.options', make: noInput, expect: own() },
  { path: 'organizations.schoolLinks', make: noInput, expect: own() },
  {
    path: 'organizations.manage',
    make: async () => {
      const o = await organizationOf({ active: true });
      return { owner: o.owner, party: await otherOrganizationAdmin(), input: { organizationId: o.organizationId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'organizations.get', make: async () => ({ input: { slug: (await organizationOf({ active: true })).slug } }), expect: everyone },
  {
    // A pending application is not public: 404 for everyone, its applicant included (the dashboard is organizations.manage).
    path: 'organizations.get (pending organization)',
    make: async () => {
      const o = await organizationOf();
      return { owner: o.owner, input: { slug: o.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'organizations.apply',
    // A new account each call: an account with an application waiting is refused (CONFLICT).
    make: async () => ({
      owner: await actor('org-applicant', { noPerson: true }),
      input: { name: 'Demo Applied Association', kind: 'association', leaderName: 'Demo Leader', websiteUrl: 'https://example.test', countryCode: 'BG', schoolsEstimate: 2, evidenceIds: [], idempotencyKey: key() },
    }),
    expect: { ...signedInOnly, owner: 'ok' },
  },
  {
    path: 'organizations.update',
    make: async () => {
      const o = await organizationOf();
      return {
        owner: o.owner,
        party: await otherOrganizationAdmin(),
        input: { organizationId: o.organizationId, name: 'Demo Edited Federation', kind: 'federation', leaderName: 'Demo Leader', countryCode: 'BG', schoolsEstimate: 4 },
      };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'organizations.addAdmin',
    make: async () => {
      const o = await organizationOf({ active: true });
      return { owner: o.owner, party: await otherOrganizationAdmin(), input: { organizationId: o.organizationId, email: (await actor('org-new-admin', { noPerson: true })).email } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'organizations.removeAdmin',
    make: async () => {
      const o = await organizationOf({ active: true });
      const added = await addOrganizationAdmin(o.owner.principal, { organizationId: o.organizationId, email: (await actor('org-removed-admin', { noPerson: true })).email }, meta);
      return { owner: o.owner, party: await otherOrganizationAdmin(), input: { organizationId: o.organizationId, adminId: added.adminId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'organizations.addMember',
    make: async () => {
      const o = await organizationOf({ federation: true });
      return { owner: o.owner, party: await otherOrganizationAdmin(), input: { organizationId: o.organizationId, personSlug: (await actor('org-member')).slug, role: 'member' } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // DEFAULT D08: approved but without Federation, members are not managed.
    path: 'organizations.addMember (no Federation plan)',
    make: async () => {
      const o = await organizationOf({ active: true });
      return { owner: o.owner, input: { organizationId: o.organizationId, personSlug: (await actor('org-member')).slug, role: 'member' } };
    },
    expect: { ...signedInOnly, owner: 'ENTITLEMENT_REQUIRED', member: 'NOT_FOUND', admin: 'NOT_FOUND' },
  },
  {
    path: 'organizations.endMember',
    make: async () => {
      const o = await organizationOf({ federation: true });
      const m = await addOrganizationMember(o.owner.principal, { organizationId: o.organizationId, personSlug: (await actor('org-member')).slug! }, meta);
      return { owner: o.owner, party: await otherOrganizationAdmin(), input: { organizationId: o.organizationId, membershipId: m.membershipId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'organizations.requestSchool',
    make: async () => {
      const o = await organizationOf({ federation: true });
      const s = await draftSchool({ pro: true, status: 'active' });
      return { owner: o.owner, party: await otherOrganizationAdmin(), input: { organizationId: o.organizationId, schoolSlug: s.slug } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // The school's listing account answers; the organization that asked does not.
    path: 'organizations.answerSchoolLink',
    make: async () => {
      const l = await schoolLink();
      return { owner: l.school.owner, party: l.org.owner, input: { linkId: l.linkId, accept: true } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // Either side: the organization withdraws its pending request; nobody else reaches it.
    path: 'organizations.endSchoolLink',
    make: async () => {
      const l = await schoolLink();
      return { owner: l.org.owner, party: await otherOrganizationAdmin(), input: { linkId: l.linkId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'organizations.adminList', make: noInput, expect: staffOnly({ admin: 'ok' }) },
  {
    path: 'organizations.adminGet',
    make: async () => {
      const o = await organizationOf({ active: true });
      return { owner: o.owner, input: { organizationId: o.organizationId } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'organizations.grant',
    make: async () => {
      const o = await organizationOf({ active: true });
      return { owner: o.owner, input: { organizationId: o.organizationId, reason: 'M15 matrix (fictional)' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'organizations.revokeGrant',
    make: async () => {
      const o = await organizationOf({ federation: true });
      return { owner: o.owner, input: { grantId: o.grantId, reason: 'M15 matrix' } };
    },
    expect: { ...staffOnly({ admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  // M17: events. The public reads give public DTOs to everyone; a removed event is 404 for everyone.
  // Changes are the organizer's only (404 for any other account, the same answer as for none);
  // staff with a verified second factor remove an event with a reason.
  { path: 'events.list', make: () => ({ input: { when: 'upcoming' } }), expect: everyone },
  { path: 'events.get', make: async () => ({ input: { slug: (await eventOf()).slug } }), expect: everyone },
  {
    path: 'events.get (removed event)',
    make: async () => {
      const e = await eventOf();
      await getDb().execute(sql`UPDATE event SET status = 'removed', removed_at = now() WHERE id = ${e.id}::uuid`);
      return { owner: e.owner, input: { slug: e.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  { path: 'events.mine', make: noInput, expect: own() },
  { path: 'events.editor', make: () => ({ input: {} }), expect: own() },
  {
    path: 'events.editor (an event)',
    make: async () => {
      const e = await eventOf();
      return { owner: e.owner, input: { id: e.id } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'events.create',
    make: async () => {
      const e = await eventOf();
      // The owner's second event in the month of the first: within the allowance of three.
      return { owner: e.owner, input: { title: 'Demo Matrix Camp', kind: 'camp', startsAt: `${e.day}T10:00`, endsAt: `${e.day}T18:00`, placeId: e.placeId } };
    },
    // A Free Student's plan includes no publishing (the plan's refusal, plan §6.5); staff accounts
    // have no own person to name as the organizer.
    expect: { ...signedInOnly, owner: 'ok', member: 'ENTITLEMENT_REQUIRED', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'events.update',
    make: async () => {
      const e = await eventOf();
      return { owner: e.owner, input: { id: e.id, title: 'Demo Matrix Seminar, changed', kind: 'seminar', startsAt: `${e.day}T11:00`, endsAt: `${e.day}T16:00`, placeId: e.placeId } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'events.cancel',
    make: async () => {
      const e = await eventOf();
      return { owner: e.owner, input: { id: e.id, note: 'A fictional note.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'events.remove',
    make: async () => {
      const e = await eventOf();
      return { owner: e.owner, input: { id: e.id, reason: 'A fictional moderation reason.' } };
    },
    expect: { ...staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }), owner: 'FORBIDDEN' },
  },
  {
    path: 'events.uploadPoster',
    make: async () => {
      const e = await eventOf();
      return { owner: e.owner, input: { id: e.id } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'events.removePoster',
    make: async () => {
      const e = await eventOf({ poster: true });
      return { owner: e.owner, input: { id: e.id } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'GET /api/event-posters/{id}/{hash}/{file}',
    make: async () => ({ input: (await eventOf({ poster: true })).poster }),
    expect: { anonymous: 'ok', member: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' },
  },
  {
    path: 'GET /api/event-posters/{id}/{hash}/{file} (removed event)',
    make: async () => {
      const e = await eventOf({ poster: true });
      await getDb().execute(sql`UPDATE event SET status = 'removed', removed_at = now() WHERE id = ${e.id}::uuid`);
      return { owner: e.owner, input: e.poster };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  // M19: the training passport. passport.get is a public DTO for everyone (404 for a person who is
  // not public); the writes are the verified teacher's (the student is refused, FORBIDDEN, anyone
  // else 404); the visibility and the certificates are the student's own; staff with a verified
  // second factor remove an entry with a reason. A private certificate is served to the student
  // and their teachers only, the same 404 for everyone else.
  { path: 'passport.get', make: async () => ({ input: { slug: (await passportOf()).student.slug } }), expect: everyone },
  {
    path: 'passport.get (person not public)',
    make: async () => {
      const p = await passportOf({ hidden: true });
      return { owner: p.student, party: p.teacher, input: { slug: p.student.slug } };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  // Staff accounts have no profile, so no passport of their own.
  { path: 'passport.mine', make: noInput, expect: { ...signedInOnly, member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' } },
  { path: 'passport.students', make: () => ({ input: {} }), expect: own() },
  {
    path: 'passport.students (a student)',
    make: async () => {
      const p = await passportOf();
      return { owner: p.teacher, party: p.student, input: { personId: p.student.personId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  ...(
    [
      ['passport.addRank', { rank: 'Demo matrix second level', date: '2021' }],
      ['passport.addExam', { awardedRank: 'Demo matrix second level', date: '2021-05' }],
      ['passport.addSkill', { name: 'Demo matrix form', progress: 'learning', date: '2021' }],
    ] as const
  ).map(
    ([path, fields]): Row => ({
      path,
      make: async () => {
        const p = await passportOf();
        return { owner: p.teacher, party: p.student, input: { personId: p.student.personId, ...fields } };
      },
      expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
    }),
  ),
  {
    path: 'passport.updateEntry',
    make: async () => {
      const p = await passportOf();
      return { owner: p.teacher, party: p.student, input: { kind: 'rank', id: p.rankId, rank: 'Demo matrix level, changed', date: '2019' } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'passport.updateEntry (a correction)',
    make: async () => {
      const p = await passportOf();
      return { owner: p.student, party: p.teacher, input: { kind: 'rank', id: p.rankId, correction: 'A fictional correction.' } };
    },
    expect: { ...signedInOnly, owner: 'ok', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'passport.withdrawEntry',
    make: async () => {
      const p = await passportOf();
      return { owner: p.teacher, party: p.student, input: { kind: 'rank', id: p.rankId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'FORBIDDEN', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'passport.setVisibility',
    make: async () => {
      const p = await passportOf();
      return { owner: p.student, party: p.teacher, input: { kind: 'rank', id: p.rankId, visibility: 'private' } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  // Through /api/v1 as multipart (viaPhotoUpload): the account's own passport; staff have none.
  { path: 'passport.uploadCertificate', make: () => ({ input: {} }), expect: { ...signedInOnly, member: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' } },
  {
    path: 'passport.removeCertificate',
    make: async () => {
      const c = await certificateOf();
      return { owner: c.student, party: c.teacher, input: { id: c.certificateId } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'passport.markAttendance',
    make: async () => {
      const e = await pastEventOf();
      return { owner: e.teacher, party: e.student, input: { eventId: e.eventId, personIds: [e.student.personId] } };
    },
    expect: { ...signedInOnly, owner: 'ok', party: 'NOT_FOUND', member: 'NOT_FOUND', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'passport.remove',
    make: async () => {
      const p = await passportOf();
      return { owner: p.teacher, party: p.student, input: { kind: 'rank', id: p.rankId, reason: 'A fictional moderation reason.' } };
    },
    expect: { ...staffOnly({ moderator: 'ok', archivist: 'ok', admin: 'ok' }), owner: 'FORBIDDEN', party: 'FORBIDDEN' },
  },
  {
    path: 'GET /api/certificates/{id}/{hash}/{file}',
    make: async () => {
      const c = await certificateOf();
      return { owner: c.student, party: c.teacher, input: c.address };
    },
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', party: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'GET /api/certificates/{id}/{hash}/{file} (public, on Premium Student)',
    make: async () => {
      const c = await certificateOf({ public: true });
      return { owner: c.student, party: c.teacher, input: c.address };
    },
    expect: { anonymous: 'ok', member: 'ok', owner: 'ok', party: 'ok', moderator: 'ok', archivist: 'ok', admin: 'ok', adminNo2fa: 'ok' },
  },
  // the evidence routes outside the router (plan §6.4): streamed only after the permission check
  {
    path: 'GET /api/evidence/{id}',
    make: async () => {
      const c = await historicalClaim();
      return { owner: c.student, input: c.file.id };
    },
    // The uploader, an administrator, and the reviewer the case is assigned to (the next row).
    expect: { anonymous: 'NOT_FOUND', member: 'NOT_FOUND', owner: 'ok', moderator: 'NOT_FOUND', archivist: 'NOT_FOUND', admin: 'ok', adminNo2fa: 'NOT_FOUND' },
  },
  {
    path: 'GET /api/evidence/{id} (case assigned to the caller)',
    make: async (who) => {
      const c = await historicalClaim();
      const reviewer = worldActor(who)!;
      await assignReviewCase(reviewer.principal, { caseId: c.caseId, assigneeId: reviewer.id, idempotencyKey: key() }, meta);
      return { input: c.file.id };
    },
    expect: { moderator: 'ok', archivist: 'ok' },
  },
  {
    path: 'POST /api/evidence/upload',
    make: () => ({ input: null }),
    expect: own(),
  },
];

// relationships.request needs the teacher of the party: its input is built from it.
const requestRow = ROWS.find((r) => r.path === 'relationships.request')!;
requestRow.make = async () => {
  const teacher = await actor('requested', { sifu: true });
  return { party: teacher, input: { teacherId: teacher.personId, lineageId: await newLineage('m13-authz-r'), periods: ongoingFrom(), idempotencyKey: key() } };
};

// --- calling --------------------------------------------------------------------------------------

/** The oRPC error code of an answer (or 'ok'), as /api/rpc returns it to a client. */
async function viaRpc(token: string | null, procedure: string, input: unknown): Promise<string> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await handleApiRequest(
    new Request(`${TEST_APP_URL}/api/rpc/${procedure.split(' ')[0]!.replace(/\./g, '/')}`, { method: 'POST', headers, body: JSON.stringify({ json: input }) }),
    'rpc',
  );
  if (response.ok) return 'ok';
  const body = (await response.json()) as { json?: { code?: string } };
  return body.json?.code ?? `HTTP ${response.status}`;
}

const STATUS_CODES: Record<number, string> = { 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 400: 'BAD_REQUEST', 409: 'CONFLICT' };

async function viaEvidenceRoute(token: string | null, row: Row, input: unknown): Promise<string> {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  if (row.path.startsWith('GET')) {
    response = await handleEvidenceDownload(new Request(`${TEST_APP_URL}/api/evidence/${String(input)}`, { headers }), String(input));
  } else {
    const bytes = fictionalPdf('route');
    headers.set('content-type', 'application/pdf');
    headers.set('content-length', String(bytes.length));
    headers.set('x-file-name', 'demo-route.pdf');
    headers.set('origin', TEST_APP_URL);
    response = await handleEvidenceUpload(new Request(`${TEST_APP_URL}/api/evidence/upload`, { method: 'POST', headers, body: bytes }));
  }
  await response.arrayBuffer();
  return response.ok ? 'ok' : (STATUS_CODES[response.status] ?? `HTTP ${response.status}`);
}

/** M14: GET /api/photos/<id>/<hash>/<file> with this session. */
async function viaPhotoRoute(token: string | null, address: { id: string; hash: string; file: string }, kind: 'person' | 'school' | 'event' | 'certificate' = 'person'): Promise<string> {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const base = kind === 'school' ? 'school-photos' : kind === 'event' ? 'event-posters' : kind === 'certificate' ? 'certificates' : 'photos';
  const response = await handlePhotoRequest(new Request(`${TEST_APP_URL}/api/${base}/${address.id}/${address.hash}/${address.file}`, { headers }), address, { kind });
  await response.arrayBuffer();
  return response.ok ? 'ok' : (STATUS_CODES[response.status] ?? `HTTP ${response.status}`);
}

/** M14: photos.upload as the native app sends it: multipart/form-data to /api/v1 (M16: gallery.add and schoolPhotos.upload too, with their fields). */
async function viaPhotoUpload(token: string | null, route = '/api/v1/photos/upload', fields: Record<string, string> = {}): Promise<string> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  body.set('file', await photoFile());
  const encoded = new Response(body);
  const bytes = await encoded.arrayBuffer();
  const headers = new Headers({ 'content-type': encoded.headers.get('content-type')!, 'content-length': String(bytes.byteLength) });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await handleApiRequest(new Request(`${TEST_APP_URL}${route}`, { method: 'POST', headers, body: bytes }), 'openapi');
  if (response.ok) return 'ok';
  const answer = (await response.json()) as { code?: string };
  return answer.code ?? `HTTP ${response.status}`;
}

function principalFor(who: Who, made: Made): Actor | null | undefined {
  switch (who) {
    case 'anonymous':
      return null;
    case 'owner':
      return made.owner;
    case 'party':
      return made.party;
    default:
      return world[who];
  }
}

beforeAll(async () => {
  process.env.EVIDENCE_STORAGE = 'filesystem';
  process.env.EVIDENCE_STORAGE_DIR = storageRoot;
  process.env.MEDIA_STORAGE_DIR = photoRoot;
  testDb = await startAuthTestDatabase();
  // The GeoNames places (schools need a city).
  const { seedDatabase } = await import('../db/seed');
  await seedDatabase(testDb.url);
  world = {
    member: await actor('member'),
    moderator: await actor('moderator', { role: 'moderator' }),
    archivist: await actor('archivist', { role: 'archivist' }),
    admin: await actor('admin', { role: 'admin' }),
    adminNo2fa: await actor('admin-no2fa', { role: 'admin', unverified: true }),
  };
}, 120_000);

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(storageRoot, { recursive: true, force: true });
  rmSync(photoRoot, { recursive: true, force: true });
});

function procedurePaths(node: Record<string, unknown>, prefix: string[] = []): string[] {
  return Object.entries(node).flatMap(([name, value]) => {
    const here = [...prefix, name];
    // A procedure carries its definition in `~orpc`; anything else is a namespace.
    return value && typeof value === 'object' && '~orpc' in value ? [here.join('.')] : procedurePaths(value as Record<string, unknown>, here);
  });
}

describe('the authorization matrix (M13)', () => {
  it('has a row for every procedure of the router and every evidence route', () => {
    const covered = new Set(ROWS.map((r) => r.path.split(' (')[0]!));
    const missing = procedurePaths(router as unknown as Record<string, unknown>).filter((p) => !covered.has(p));
    expect(missing).toEqual([]);
    for (const row of ROWS) {
      // Anonymous is always decided.
      if (!row.path.includes(' (')) expect(row.expect.anonymous, row.path).toBeDefined();
    }
  });

  it("notifications.markRead with another account's id answers ok and marks nothing", async () => {
    const owner = await actor('notified-owner');
    const id = await notificationOf(owner.id);
    expect(await viaRpc(world.member.token, 'notifications.markRead', { ids: [id] })).toBe('ok');
    const [row] = await getDb().select({ readAt: notification.readAt }).from(notification).where(eq(notification.id, id));
    expect(row!.readAt).toBeNull();
  });

  // One test per procedure: every role it has an answer for, over HTTP with a real session.
  for (const row of ROWS) {
    it(`${row.path}: every role × ownership over the HTTP API`, async () => {
      const actual: Partial<Record<Who, string>> = {};
      for (const who of ROLES) {
        const expected = row.expect[who];
        if (!expected) continue;
        const made = await row.make(who);
        const caller = principalFor(who, made);
        if (caller === undefined) throw new Error(`${row.path}: no ${who} in the fixture`);
        actual[who] = row.path.includes('/api/evidence')
          ? await viaEvidenceRoute(caller?.token ?? null, row, made.input)
          : row.path.includes('/api/photos') || row.path.includes('/api/school-photos') || row.path.includes('/api/event-posters') || row.path.includes('/api/certificates')
            ? await viaPhotoRoute(
                caller?.token ?? null,
                made.input as { id: string; hash: string; file: string },
                row.path.includes('/api/school-photos') ? 'school' : row.path.includes('/api/event-posters') ? 'event' : row.path.includes('/api/certificates') ? 'certificate' : 'person',
              )
            : row.path === 'photos.upload'
              ? await viaPhotoUpload(caller?.token ?? null)
              : row.path === 'gallery.add'
                ? await viaPhotoUpload(caller?.token ?? null, '/api/v1/gallery/add')
                : row.path === 'schoolPhotos.upload'
                  ? await viaPhotoUpload(caller?.token ?? null, '/api/v1/schools/photos/upload', made.input as Record<string, string>)
                  : row.path === 'events.uploadPoster'
                    ? await viaPhotoUpload(caller?.token ?? null, '/api/v1/events/poster/upload', made.input as Record<string, string>)
                    : row.path === 'passport.uploadCertificate'
                      ? await viaPhotoUpload(caller?.token ?? null, '/api/v1/passport/certificate/upload', made.input as Record<string, string>)
                      : await viaRpc(caller?.token ?? null, row.path, made.input);
      }
      // Line by line, so a failure shows every role's answer.
      const lines = (answers: Partial<Record<Who, string>>) => ROLES.filter((w) => row.expect[w]).map((w) => `${w}: ${answers[w]}`);
      expect(lines(actual)).toEqual(lines(row.expect));
    });
  }
});

// --- What the public reads return to each caller (M13 review) ----------------------------------
//
// The rows above only say a public read answers; their fixture is a public link, which every caller
// sees. Here the fixture holds what is not public: a pending request between two public people and
// a verified link whose student is not public (involved_only). DEFAULT D03 (lineage-viewer.ts): the
// people involved see their own such relationships, and the reviewers (staff with a verified second
// factor) on the pages of the person they open; an unrelated member, an anonymous visitor and an
// administrator without the second factor do not. search.query reads public records only, the same
// for everyone (plan §6.4): the hidden person is absent for every caller, their own account included.

/** The JSON body /api/rpc returns, or the oRPC error code. */
async function rpcBody(token: string | null, procedure: string, input: unknown): Promise<{ code: string; text: string }> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await handleApiRequest(
    new Request(`${TEST_APP_URL}/api/rpc/${procedure.replace(/\./g, '/')}`, { method: 'POST', headers, body: JSON.stringify({ json: input }) }),
    'rpc',
  );
  const text = await response.text();
  if (response.ok) return { code: 'ok', text };
  return { code: (JSON.parse(text) as { json?: { code?: string } }).json?.code ?? `HTTP ${response.status}`, text };
}

type Seen = 'present' | 'absent' | Outcome;
interface Exposed {
  owner: Actor;
  party: Actor;
  /** In the answer only when the caller may see what is not public. */
  secret: string;
  input: unknown;
}

interface Exposure {
  procedure: string;
  /** A fresh fixture for each caller. */
  fixture: () => Promise<Exposed>;
  expect: Record<Who, Seen>;
}

/** A pending request from a public student (the owner) to a public teacher (the party). */
async function pendingFixture(read: (r: Awaited<ReturnType<typeof pendingRequest>>) => Pick<Exposed, 'secret' | 'input'>): Promise<Exposed> {
  const r = await pendingRequest();
  return { owner: r.student, party: r.teacher, ...read(r) };
}

/** A verified link whose student (the owner) is not public (involved_only); the teacher (the party) is. */
async function hiddenStudentFixture(read: (r: Awaited<ReturnType<typeof verifiedLink>>) => Pick<Exposed, 'secret' | 'input'>): Promise<Exposed> {
  const r = await verifiedLink();
  await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, r.student.personId!));
  return { owner: r.student, party: r.teacher, ...read(r) };
}

/** Gives a person a name no one else has, with its search keys (as the profile editor does); returns it. */
async function renameUniquely(personId: string, label: string): Promise<string> {
  const name = `Demo ${label} ${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join('')}`;
  await getDb().update(personName).set({ value: name }).where(eq(personName.personId, personId));
  await writePersonKeys(getDb(), personId);
  return name;
}

/** Seen by the people involved and by the reviewers of the person read; by no one else. */
const involvedAndReviewers: Record<Who, Seen> = {
  anonymous: 'absent',
  member: 'absent',
  owner: 'present',
  party: 'present',
  moderator: 'present',
  archivist: 'present',
  admin: 'present',
  adminNo2fa: 'absent',
};
const nobody: Record<Who, Seen> = Object.fromEntries(ROLES.map((w) => [w, 'absent'])) as Record<Who, Seen>;

const EXPOSURES: Exposure[] = [
  // The pending request: the teacher from the student's side, the student from the teacher's side.
  {
    procedure: 'lineage.ego',
    fixture: () => pendingFixture((r) => ({ secret: r.teacher.personId!, input: { focusId: r.student.personId, up: 1, down: 0 } })),
    expect: involvedAndReviewers,
  },
  {
    procedure: 'lineage.ego',
    fixture: () => pendingFixture((r) => ({ secret: r.student.personId!, input: { focusId: r.teacher.personId, up: 0, down: 1 } })),
    expect: involvedAndReviewers,
  },
  { procedure: 'lineage.ancestors', fixture: () => pendingFixture((r) => ({ secret: r.teacher.personId!, input: { focusId: r.student.personId } })), expect: involvedAndReviewers },
  { procedure: 'lineage.paths', fixture: () => pendingFixture((r) => ({ secret: r.teacher.personId!, input: { focusId: r.student.personId } })), expect: involvedAndReviewers },
  { procedure: 'lineage.subtree', fixture: () => pendingFixture((r) => ({ secret: r.student.personId!, input: { rootId: r.teacher.personId } })), expect: involvedAndReviewers },
  { procedure: 'people.students', fixture: () => pendingFixture((r) => ({ secret: r.student.personId!, input: { slug: r.teacher.slug } })), expect: involvedAndReviewers },
  // The hidden student of a public teacher, from the teacher's side.
  {
    procedure: 'lineage.ego',
    fixture: () => hiddenStudentFixture((r) => ({ secret: r.student.personId!, input: { focusId: r.teacher.personId, up: 0, down: 1 } })),
    expect: involvedAndReviewers,
  },
  { procedure: 'lineage.subtree', fixture: () => hiddenStudentFixture((r) => ({ secret: r.student.personId!, input: { rootId: r.teacher.personId } })), expect: involvedAndReviewers },
  { procedure: 'people.students', fixture: () => hiddenStudentFixture((r) => ({ secret: r.student.personId!, input: { slug: r.teacher.slug } })), expect: involvedAndReviewers },
  {
    // The hidden person's own read: no such person for anyone who may not see them.
    procedure: 'lineage.ancestors',
    fixture: () => hiddenStudentFixture((r) => ({ secret: r.teacher.personId!, input: { focusId: r.student.personId } })),
    expect: { ...involvedAndReviewers, anonymous: 'NOT_FOUND', member: 'NOT_FOUND', adminNo2fa: 'NOT_FOUND' },
  },
  {
    // Search: public records only, for every caller.
    procedure: 'search.query',
    fixture: async () => {
      const made = await hiddenStudentFixture((r) => ({ secret: r.student.personId!, input: null }));
      return { ...made, input: { q: await renameUniquely(made.owner.personId!, 'Hidden') } };
    },
    expect: nobody,
  },
];

describe('what the public reads return to each caller (M13 review)', () => {
  for (const [index, exposure] of EXPOSURES.entries()) {
    it(`${exposure.procedure} (#${index + 1}): the people involved and the reviewers, or nobody`, async () => {
      const actual: Partial<Record<Who, Seen>> = {};
      for (const who of ROLES) {
        const made = await exposure.fixture();
        const caller = principalFor(who, made);
        const answer = await rpcBody(caller?.token ?? null, exposure.procedure, made.input);
        actual[who] = answer.code !== 'ok' ? (answer.code as Outcome) : answer.text.includes(made.secret) ? 'present' : 'absent';
      }
      const lines = (seen: Partial<Record<Who, Seen>>) => ROLES.map((w) => `${w}: ${seen[w]}`);
      expect(lines(actual)).toEqual(lines(exposure.expect));
    });
  }

  it('search.query finds the same kind of person while public, for every caller (the control of the row above)', async () => {
    const r = await verifiedLink();
    const name = await renameUniquely(r.student.personId!, 'Visible');
    for (const caller of [null, world.member, r.student, r.teacher, world.admin]) {
      const answer = await rpcBody(caller?.token ?? null, 'search.query', { q: name });
      expect(answer.code).toBe('ok');
      expect(answer.text.includes(r.student.personId!), caller?.email ?? 'anonymous').toBe(true);
    }
  });
});

// --- Server Actions ------------------------------------------------------------------------------

/** The form an action posts, from the input its procedure takes (the actions' field names). */
type FormFrom = (input: Record<string, unknown>) => Record<string, string>;

const same: FormFrom = (input) => Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]));
const periodsForm = { periodCount: '1', 'periods.0.fromYear': '2019', 'periods.0.fromMonth': '4', 'periods.0.ongoing': 'on' };

/**
 * The actions that wrap a procedure of the matrix, with the row whose fixtures they use and how
 * their form is filled. The actions of Better Auth endpoints (sign-up, sign-in, e-mail, password,
 * two-factor) wrap no service and are covered by the M02 tests (auth.int.test.ts, guards.int.test.ts).
 */
type ActionFn = (...args: unknown[]) => Promise<unknown>;

const ACTIONS: { action: string; row: string; form: FormFrom; roles: Who[]; call?: (fn: ActionFn, form: FormData, input: Record<string, unknown>) => Promise<unknown> }[] = [
  { action: 'src/app/onboarding/actions.ts#onboardAction', row: 'account.onboard', form: (i) => ({ primaryName: String(i.primaryName) }), roles: ['anonymous', 'owner'] },
  { action: 'src/app/onboarding/actions.ts#confirmConsentsAction', row: 'consent.record', form: () => ({ terms: 'on', privacy_ack: 'on', authenticity_declaration: 'on', age_18_plus: 'on' }), roles: ['anonymous', 'owner'] },
  {
    action: 'src/app/dashboard/actions.ts#markReadAction',
    row: 'notifications.markRead',
    form: (i) => ({ id: (i.ids as string[])[0]! }),
    roles: ['anonymous', 'member', 'owner'],
    call: (fn, form) => fn(form),
  },
  {
    action: 'src/app/dashboard/actions.ts#markReadAction',
    row: 'notifications.markAllRead',
    form: (i) => ({ all: 'on', category: String(i.category) }),
    roles: ['anonymous', 'member'],
    call: (fn, form) => fn(form),
  },
  // M18: an empty form switches off every category that can be (its procedure is the last call).
  { action: 'src/app/dashboard/settings/actions.ts#setNotificationEmailsAction', row: 'notifications.setPreference', form: () => ({}), roles: ['anonymous', 'member'] },
  { action: 'src/app/unsubscribe/actions.ts#unsubscribeAction', row: 'notifications.unsubscribe', form: same, roles: ['anonymous', 'member'], call: (fn, form) => fn(form) },
  { action: 'src/app/dashboard/actions.ts#requestPilotAccessAction', row: 'plans.requestPilotAccess', form: same, roles: ['anonymous', 'owner'] },
  { action: 'src/app/dashboard/settings/actions.ts#setAccountTypeAction', row: 'account.setType', form: same, roles: ['anonymous', 'owner'] },
  { action: 'src/app/admin/grants/actions.ts#createGrantAction', row: 'grants.create', form: same, roles: ['anonymous', 'member', 'adminNo2fa', 'admin'] },
  { action: 'src/app/admin/grants/actions.ts#revokeGrantAction', row: 'grants.revoke', form: same, roles: ['anonymous', 'member', 'party', 'adminNo2fa', 'admin'] },
  { action: 'src/app/admin/grants/actions.ts#closeRequestAction', row: 'grants.closeRequest', form: same, roles: ['anonymous', 'member', 'party', 'adminNo2fa', 'admin'] },
  { action: 'src/app/account/privacy/actions.ts#withdrawConsentAction', row: 'consent.withdraw', form: () => ({ kind: 'privacy_ack' }), roles: ['anonymous', 'owner'] },
  { action: 'src/app/account/privacy/actions.ts#requestDeletionAction', row: 'account.requestDeletion', form: () => ({ confirm: 'on' }), roles: ['anonymous', 'owner'] },
  { action: 'src/app/dashboard/teachers/actions.ts#requestTeacherAction', row: 'relationships.request', form: (i) => ({ ...same(i), ...periodsForm }), roles: ['anonymous', 'member'] },
  { action: 'src/app/dashboard/teachers/actions.ts#resubmitRequestAction', row: 'relationships.resubmit', form: (i) => ({ ...same(i), ...periodsForm }), roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/teachers/actions.ts#withdrawRequestAction', row: 'relationships.withdraw', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/teachers/actions.ts#endTrainingAction', row: 'relationships.end', form: (i) => ({ ...same(i), endYear: '2024' }), roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/students/requests/actions.ts#approveRequestAction', row: 'relationships.approve', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/students/requests/actions.ts#rejectRequestAction', row: 'relationships.reject', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/teachers/invite/actions.ts#sendInvitationAction', row: 'invitations.send', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/invite/[token]/actions.ts#acceptInvitationAction', row: 'invitations.accept', form: same, roles: ['anonymous', 'party', 'member'] },
  { action: 'src/app/dashboard/cases/[id]/actions.ts#replyCaseAction', row: 'cases.reply', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/people/[slug]/report/actions.ts#reportProfileAction', row: 'reports.create', form: same, roles: ['anonymous', 'member'] },
  {
    action: 'src/app/dashboard/teachers/historical/actions.ts#discardEvidenceAction',
    row: 'evidence.discard',
    form: same,
    roles: ['anonymous', 'member', 'owner'],
    call: (fn, _form, input) => fn(input.id),
  },
  { action: 'src/app/admin/review/actions.ts#assignCaseAction', row: 'review.assign', form: (i) => ({ ...same(i), mode: 'take' }), roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'archivist'] },
  { action: 'src/app/admin/review/actions.ts#decideCaseAction', row: 'review.decide', form: same, roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'archivist'] },
  { action: 'src/app/admin/review/actions.ts#addNoteAction', row: 'review.note', form: same, roles: ['anonymous', 'member', 'owner', 'adminNo2fa', 'moderator'] },
  { action: 'src/app/admin/review/actions.ts#arbitrateAction', row: 'review.arbitrate', form: same, roles: ['anonymous', 'member', 'owner', 'archivist', 'adminNo2fa', 'moderator'] },
  // M14: a moderator's "Remove photo" on a case card; the owner's own removal is the same procedure.
  {
    action: 'src/app/admin/review/actions.ts#removePhotoAction',
    row: "photos.remove (another account's photo, with a reason)",
    form: same,
    roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'archivist'],
  },
  // M16: a moderator's "Remove photo" of a gallery photo or a school photo on a case card.
  {
    action: 'src/app/admin/review/actions.ts#removeGalleryPhotoAction',
    row: "gallery.remove (another account's photo, with a reason)",
    form: same,
    roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'archivist'],
  },
  {
    action: 'src/app/admin/review/actions.ts#removeSchoolPhotoAction',
    row: "schoolPhotos.remove (another account's photo, with a reason)",
    form: same,
    roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'archivist'],
  },
  { action: 'src/app/admin/review/actions.ts#archiveUpdateAction', row: 'archive.update', form: same, roles: ['anonymous', 'member', 'moderator', 'adminNo2fa', 'archivist'] },
  { action: 'src/app/dashboard/schools/actions.ts#updateSchoolAction', row: 'schools.update', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#submitSchoolAction', row: 'schools.submit', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#confirmSchoolAction', row: 'schools.confirm', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#createSchoolAction', row: 'schools.create', form: same, roles: ['anonymous', 'member', 'owner'] },
  // M15: organizations. `party` is another organization's owner (404); the apply form carries uploaded files (below).
  { action: 'src/app/dashboard/organization/actions.ts#updateOrganizationAction', row: 'organizations.update', form: (i) => ({ ...same(i), schoolsEstimate: String(i.schoolsEstimate) }), roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/organization/actions.ts#addOrganizationAdminAction', row: 'organizations.addAdmin', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/organization/actions.ts#removeOrganizationAdminAction', row: 'organizations.removeAdmin', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/organization/actions.ts#addOrganizationMemberAction', row: 'organizations.addMember', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/organization/actions.ts#endOrganizationMemberAction', row: 'organizations.endMember', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/organization/actions.ts#requestOrganizationSchoolAction', row: 'organizations.requestSchool', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/organization/actions.ts#endOrganizationSchoolAction', row: 'organizations.endSchoolLink', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  // M21: the trial lesson request form, the inbox's answers and the schedule form.
  { action: 'src/app/schools/[slug]/trial/actions.ts#requestTrialAction', row: 'trial.request', form: (i) => ({ ...same(i), slug: 'demo-matrix' }), roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#decideTrialAction', row: 'trial.answer', form: (i) => ({ ...same(i), decision: 'answer', schoolId: '00000000-0000-4000-8000-000000000000' }), roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#decideTrialAction', row: 'trial.decline', form: (i) => ({ inquiryId: String(i.inquiryId), reply: String(i.reason), decision: 'decline' }), roles: ['anonymous', 'party', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#decideTrialAction', row: 'trial.close', form: (i) => ({ ...same(i), decision: 'close' }), roles: ['anonymous', 'party', 'owner'] },
  {
    action: 'src/app/dashboard/schools/actions.ts#updateScheduleAction',
    row: 'schools.updateSchedule',
    form: (i) => ({ id: String(i.id), rows: '1', 'slot.0.weekday': '2', 'slot.0.startsAt': '18:30', 'slot.0.endsAt': '20:00', 'slot.0.label': 'Demo class', fees: String(i.fees), firstTrialFree: 'on' }),
    roles: ['anonymous', 'member', 'owner'],
  },
  { action: 'src/app/dashboard/schools/actions.ts#answerOrganizationLinkAction', row: 'organizations.answerSchoolLink', form: (i) => ({ ...same(i), answer: 'accept' }), roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/admin/organizations/actions.ts#grantOrganizationPlanAction', row: 'organizations.grant', form: same, roles: ['anonymous', 'member', 'owner', 'adminNo2fa', 'admin'] },
  { action: 'src/app/admin/organizations/actions.ts#revokeOrganizationPlanAction', row: 'organizations.revokeGrant', form: same, roles: ['anonymous', 'member', 'owner', 'adminNo2fa', 'admin'] },
  // M17: events. The forms post the procedures' fields (a city, not online); `party` is not used.
  { action: 'src/app/dashboard/events/actions.ts#createEventAction', row: 'events.create', form: (i) => ({ ...same(i), where: 'city' }), roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/events/actions.ts#updateEventAction', row: 'events.update', form: (i) => ({ ...same(i), where: 'city' }), roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/events/actions.ts#cancelEventAction', row: 'events.cancel', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/events/[slug]/actions.ts#removeEventAction', row: 'events.remove', form: same, roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'admin'] },
  // M19: the passport forms post the procedures' fields; the entry of the staff form is "kind:id".
  { action: 'src/app/dashboard/passport/actions.ts#setVisibilityAction', row: 'passport.setVisibility', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/passport/actions.ts#proposeCorrectionAction', row: 'passport.updateEntry (a correction)', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/students/actions.ts#addRankAction', row: 'passport.addRank', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/students/actions.ts#addExamAction', row: 'passport.addExam', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/students/actions.ts#addSkillAction', row: 'passport.addSkill', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  {
    action: 'src/app/dashboard/students/actions.ts#updateEntryAction',
    row: 'passport.updateEntry',
    form: (i) => ({ kind: String(i.kind), id: String(i.id), title: String(i.rank), date: String(i.date) }),
    roles: ['anonymous', 'member', 'party', 'owner'],
  },
  { action: 'src/app/dashboard/students/actions.ts#withdrawEntryAction', row: 'passport.withdrawEntry', form: same, roles: ['anonymous', 'member', 'party', 'owner'] },
  {
    action: 'src/app/dashboard/students/actions.ts#markAttendanceAction',
    row: 'passport.markAttendance',
    form: (i) => ({ eventId: String(i.eventId), personId: String((i.personIds as string[])[0]) }),
    roles: ['anonymous', 'member', 'owner'],
  },
  {
    action: 'src/app/people/[slug]/passport-actions.ts#removePassportEntryAction',
    row: 'passport.remove',
    form: (i) => ({ entry: `${String(i.kind)}:${String(i.id)}`, reason: String(i.reason), slug: 'demo-matrix' }),
    roles: ['anonymous', 'member', 'owner', 'moderator', 'adminNo2fa', 'admin'],
  },
  // M22: the billing forms post the procedures' fields; the checkout redirects to its page.
  { action: 'src/app/dashboard/billing/actions.ts#startCheckoutAction', row: 'billing.checkout', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/billing/actions.ts#cancelSubscriptionAction', row: 'billing.cancel', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/billing/actions.ts#resumeSubscriptionAction', row: 'billing.resume', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/billing/test-checkout/[id]/actions.ts#testPayAction', row: 'billing.testPay', form: same, roles: ['anonymous', 'member', 'owner'] },
  // M23: the plan change forms and the administrators' trial forms post the procedures' fields.
  { action: 'src/app/dashboard/billing/actions.ts#changePlanAction', row: 'billing.changePlan', form: (i) => ({ ...same(i), organizationId: '' }), roles: ['anonymous', 'member', 'party', 'owner'] },
  { action: 'src/app/dashboard/billing/actions.ts#cancelChangeAction', row: 'billing.cancelChange', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/admin/organizations/actions.ts#startTrialAction', row: 'federationTrials.start', form: same, roles: ['anonymous', 'member', 'owner', 'adminNo2fa', 'admin'] },
  { action: 'src/app/admin/organizations/actions.ts#endTrialAction', row: 'federationTrials.end', form: same, roles: ['anonymous', 'member', 'owner', 'adminNo2fa', 'admin'] },
  { action: 'src/app/admin/billing/[id]/actions.ts#moveTestClockAction', row: 'billing.testClock', form: same, roles: ['anonymous', 'member', 'owner', 'adminNo2fa', 'admin'] },
  // The editor saves the account's own person only: the form has no person to choose.
  { action: 'src/app/dashboard/profile/actions.ts#saveProfileAction', row: 'profile.update', form: () => ({ 'names.0.value': 'Demo Profile Person', primary: '0', showPublicly: 'on' }), roles: ['anonymous', 'owner'] },
];

/** The actions the matrix does not call, each with the reason. */
const ACTIONS_ELSEWHERE: Record<string, string> = {
  'src/app/dashboard/teachers/historical/actions.ts#requestHistoricalAction': 'its form carries uploaded files; relationships.requestHistorical is in the matrix and M10a E2E posts the form',
  'src/app/dashboard/teachers/invite/actions.ts#inviteTeacherAction': 'relationships.invite takes no object of another account (a new record); in the matrix over HTTP',
  'src/app/dashboard/instructor/actions.ts#requestInstructorAction': 'its form carries uploaded files; instructor.request is in the matrix and M10b E2E posts the form',
  'src/app/dashboard/organization/actions.ts#applyOrganizationAction': 'its form carries uploaded files; organizations.apply is in the matrix and M15 E2E posts the form',
  'src/app/dashboard/schools/actions.ts#endOrganizationLinkAction':
    'the school side of organizations.endSchoolLink, whose row runs the organization side; the school side is in organizations.int.test.ts and M15 E2E',
};

describe('Server Actions run the same checks (M13)', () => {
  it('every Server Action that wraps a procedure is called below or listed with a reason', () => {
    const rpcActions = Object.entries(SERVER_ACTION_TARGETS)
      .filter(([, target]) => target.rpc && !target.auth)
      .map(([name]) => name);
    const covered = new Set([...ACTIONS.map((a) => a.action), ...Object.keys(ACTIONS_ELSEWHERE)]);
    expect(rpcActions.filter((a) => !covered.has(a))).toEqual([]);
  });

  for (const entry of ACTIONS) {
    it(`${entry.action.split('#')[1]}: ${entry.roles.join(', ')}`, async () => {
      const row = ROWS.find((r) => r.path === entry.row)!;
      const [file, name] = entry.action.split('#') as [string, string];
      const mod = (await import(/* @vite-ignore */ `@/${file.replace(/^src\//, '').replace(/\.ts$/, '')}`)) as Record<string, unknown>;
      const target = SERVER_ACTION_TARGETS[entry.action]!.rpc!;
      for (const who of entry.roles) {
        const made = await row.make(who);
        const caller = principalFor(who, made);
        if (caller === undefined) throw new Error(`${entry.action}: no ${who} in the fixture`);
        const input = made.input as Record<string, unknown>;
        const form = new FormData();
        for (const [k, v] of Object.entries(entry.form(input ?? {}))) form.set(k, v);
        if (!form.has('idempotencyKey')) form.set('idempotencyKey', key());
        request.headers = new Headers(caller ? { authorization: `Bearer ${caller.token}` } : {});
        request.cookies.clear();
        recorded.calls = [];
        let redirectedTo: string | null = null;
        let state: unknown = null;
        try {
          const fn = mod[name] as ActionFn;
          state = await (entry.call ? entry.call(fn, form, input ?? {}) : fn({ status: 'idle' }, form));
        } catch (error) {
          if (!(error instanceof Redirect)) throw error;
          redirectedTo = error.url;
        }
        const calls = recorded.calls.filter((c) => target.includes(c.path));
        const expected = row.expect[who]!;
        // Only the procedures the action is a thin wrapper over (src/server/rpc/parity.ts).
        expect(recorded.calls.every((c) => target.includes(c.path)), `${who}: ${JSON.stringify(recorded.calls)}`).toBe(true);
        if (calls.length === 0) {
          // Refused before the procedure (no session): sent to sign in, never a success.
          expect(expected, `${who}: the action called nothing`).not.toBe('ok');
          expect(redirectedTo ?? '', `${who}`).toMatch(/^\/sign-in/);
        } else {
          expect(calls.at(-1)!.code, `${entry.action} as ${who}`).toBe(expected);
          // An allowed call ends as a success of the action too, not an error it caught afterwards.
          if (expected === 'ok' && redirectedTo === null) {
            expect((state as { status?: string } | null)?.status, `${entry.action} as ${who}: ${JSON.stringify(state)}`).not.toBe('error');
          }
        }
      }
    });
  }
});

