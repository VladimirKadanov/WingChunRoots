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
import { authSession, authUser, notification, person, personName, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleEvidenceDownload, handleEvidenceUpload } from '../evidence-http';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { recordConsents } from '../services/consent';
import { uploadEvidence } from '../services/evidence';
import { createGrant } from '../services/grants';
import { requestHistoricalTeacher } from '../services/historical';
import { requestInstructorVerification } from '../services/instructor';
import { inviteTeacher } from '../services/invitations';
import { requestPilotAccess } from '../services/plans';
import { approveRelationship, rejectRelationship, requestTeacher } from '../services/relationships';
import { assignReviewCase } from '../services/review';
import { type Account, createUser, key, meta, newLineage, ongoingFrom, principalOf } from '../services/relationships.test-support';
import { createSchool } from '../services/schools';
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
  { path: 'places.search', make: () => ({ input: { q: 'Sofia' } }), expect: everyone },
  { path: 'dashboard.overview', make: noInput, expect: own() },
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
        actual[who] = row.path.includes('/api/evidence') ? await viaEvidenceRoute(caller?.token ?? null, row, made.input) : await viaRpc(caller?.token ?? null, row.path, made.input);
      }
      // Line by line, so a failure shows every role's answer.
      const lines = (answers: Partial<Record<Who, string>>) => ROLES.filter((w) => row.expect[w]).map((w) => `${w}: ${answers[w]}`);
      expect(lines(actual)).toEqual(lines(row.expect));
    });
  }
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
  { action: 'src/app/admin/review/actions.ts#archiveUpdateAction', row: 'archive.update', form: same, roles: ['anonymous', 'member', 'moderator', 'adminNo2fa', 'archivist'] },
  { action: 'src/app/dashboard/schools/actions.ts#updateSchoolAction', row: 'schools.update', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#submitSchoolAction', row: 'schools.submit', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#confirmSchoolAction', row: 'schools.confirm', form: same, roles: ['anonymous', 'member', 'owner'] },
  { action: 'src/app/dashboard/schools/actions.ts#createSchoolAction', row: 'schools.create', form: same, roles: ['anonymous', 'member', 'owner'] },
  // The editor saves the account's own person only: the form has no person to choose.
  { action: 'src/app/dashboard/profile/actions.ts#saveProfileAction', row: 'profile.update', form: () => ({ 'names.0.value': 'Demo Profile Person', primary: '0', showPublicly: 'on' }), roles: ['anonymous', 'owner'] },
];

/** The actions the matrix does not call, each with the reason. */
const ACTIONS_ELSEWHERE: Record<string, string> = {
  'src/app/dashboard/teachers/historical/actions.ts#requestHistoricalAction': 'its form carries uploaded files; relationships.requestHistorical is in the matrix and M10a E2E posts the form',
  'src/app/dashboard/teachers/invite/actions.ts#inviteTeacherAction': 'relationships.invite takes no object of another account (a new record); in the matrix over HTTP',
  'src/app/dashboard/instructor/actions.ts#requestInstructorAction': 'its form carries uploaded files; instructor.request is in the matrix and M10b E2E posts the form',
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

