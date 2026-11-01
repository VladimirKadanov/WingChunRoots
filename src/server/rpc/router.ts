// The oRPC router (plan §6.8; milestone M02, In scope 3): every read and every mutation of the
// account data is a procedure here, served at /api/rpc (the web) and /api/v1 (OpenAPI, the future
// native app). Procedures only adapt: the services check the principal and the input themselves.
// Server Actions call the same procedures through serverClient() (./server.ts), and
// api-parity.test.ts checks that every Server Action names its procedure.
//
// Sign-up, sign-in, e-mail confirmation, password reset and two-factor authentication are Better
// Auth's own HTTP API under /api/auth (cookie or bearer, docs/adr/0004-auth.md).

import { ORPCError, os, type RouterClient, ValidationError } from '@orpc/server';

import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { accountOverview, landingInput, landingPath, onboard, onboardingOptions, onboardInput } from '../services/account';
import { adminOverview } from '../services/admin';
import { recordConsents, recordConsentsInput } from '../services/consent';
import type { RequestMeta } from '../services/context';
import { dashboardOverview } from '../services/dashboard';
import { discardEvidence, discardInput } from '../services/evidence';
import { isServiceError } from '../services/errors';
import {
  closePilotRequest,
  closePilotRequestInput,
  createGrant,
  createGrantInput,
  listGrants,
  listGrantsInput,
  revokeGrant,
  revokeGrantInput,
} from '../services/grants';
import { historicalClaimInput, requestHistoricalTeacher } from '../services/historical';
import { arbitrateInput, arbitrateRelationship } from '../services/arbitration';
import { caseIdInput, caseReplyInput, getPartyCase, myCases, replyToCase } from '../services/cases';
import { instructorOverview, instructorRequestInput, requestInstructorVerification } from '../services/instructor';
import {
  acceptInvitation,
  acceptInvitationInput,
  getInvitation,
  invitationTokenInput,
  inviteInput,
  inviteTeacher,
  sendInvitation,
  sendInvitationInput,
} from '../services/invitations';
import { myReports, reportInput, reportProfile } from '../services/reports';
import { listNotifications, markNotificationsRead, markReadInput } from '../services/notifications';
import { myPlan, planCatalog, requestPilotAccess, requestPilotAccessInput, setAccountType, setAccountTypeInput } from '../services/plans';
import {
  approveRelationship,
  endInput,
  endRelationship,
  getRelationship,
  myTeachers,
  rejectInput,
  rejectRelationship,
  relationshipActionInput,
  relationshipIdInput,
  requestInput,
  requestOptions,
  requestTeacher,
  resubmitInput,
  resubmitRelationship,
  studentRequests,
  withdrawRelationship,
} from '../services/relationships';
import {
  addReviewNote,
  archiveGetInput,
  archiveUpdateInput,
  assignReviewCase,
  decideReviewCase,
  getArchiveRecord,
  getReviewCase,
  listReviewCases,
  reviewAssignInput,
  reviewDecideInput,
  reviewIdInput,
  reviewListInput,
  reviewNoteInput,
  updateArchiveRecord,
} from '../services/review';
import { setRoleInput, setUserRole } from '../services/roles';
import { twoFactorOverview } from '../services/two-factor';
import { profileGet, profileUpdate, profileUpdateInput } from '../services/profile';
import { consentWithdraw, consentWithdrawInput, privacyOverview, requestAccountDeletion, requestDeletionInput } from '../services/privacy';
import { searchInput, searchQuery } from '../services/search';
import { searchResultSchema } from '../dto/search';
import { placeSearchSchema, schoolPageSchema, schoolSearchSchema, schoolSitemapSchema } from '../dto/schools';
import {
  confirmSchool,
  createSchool,
  mySchools,
  placeSearchInput,
  placesSearch,
  schoolCreateInput,
  schoolEditor,
  schoolEditorInput,
  schoolGet,
  schoolSitemap,
  schoolIdInput,
  schoolSearchInput,
  schoolSlugInput,
  schoolsInViewport,
  schoolsSearch,
  schoolUpdateInput,
  schoolViewportInput,
  submitSchool,
  updateSchool,
} from '../services/schools';
import { lineageGraphSchema, lineagePathsSchema, personProfileSchema, studentsPageSchema } from '../dto/public';
import { exploreStartSchema } from '../dto/explore';
import { exploreStart } from '../services/explore-start';
import {
  ancestorsInput,
  egoInput,
  lineageAncestors,
  lineageEgo,
  lineagePaths,
  lineageSubtree,
  pathsInput,
  personInput,
  personProfile,
  personStudents,
  studentsInput,
  subtreeInput,
} from '../services/lineage';

export interface RpcContext {
  principal: Principal | null;
  meta: RequestMeta;
}

const base = os.$context<RpcContext>().use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Input that fails its schema: the same shape as a service's field errors.
    if (error instanceof ORPCError && error.cause instanceof ValidationError) {
      const fields: Record<string, string> = {};
      for (const issue of error.cause.issues) {
        const key = String(issue.path?.[0] && typeof issue.path[0] === 'object' ? issue.path[0].key : (issue.path?.[0] ?? 'form'));
        fields[key] ??= issue.message;
      }
      throw new ORPCError('BAD_REQUEST', { status: 400, message: 'Check the highlighted fields.', data: { fields } });
    }
    if (isServiceError(error)) {
      const data = { ...(Object.keys(error.fields).length > 0 ? { fields: error.fields } : {}), ...error.details };
      throw new ORPCError(error.code, {
        status: error.status,
        message: error.message,
        data: Object.keys(data).length > 0 ? data : undefined,
      });
    }
    throw error;
  }
});

// The session is checked before the input (middlewares before .input() run before validation), so
// a request without the right session gets 401 or 403, never the field errors of its body. The
// services check the principal again themselves (CLAUDE.md §5).
const signedIn = base.use(({ context, next }) => {
  requireUser(context.principal);
  return next();
});
const adminWithSecondFactor = base.use(({ context, next }) => {
  requireStaff2FA(context.principal, ['admin']);
  return next();
});
// M10a: the review queue, for every staff role with a verified second factor; the services narrow
// each action further (review.ts).
const staffWithSecondFactor = base.use(({ context, next }) => {
  requireStaff2FA(context.principal);
  return next();
});

export const router = {
  account: {
    me: base
      .route({ method: 'GET', path: '/account/me', summary: 'The signed-in account, its own person and missing consents' })
      .handler(({ context }) => accountOverview(context.principal)),
    landing: signedIn
      .route({ method: 'GET', path: '/account/landing', summary: 'Where the signed-in account goes next (onboarding or the page it asked for)' })
      .input(landingInput)
      .handler(async ({ context, input }) => ({ path: await landingPath(context.principal, input.next) })),
    twoFactor: base
      .route({ method: 'GET', path: '/account/two-factor', summary: 'Two-factor authentication: off, the pending setup, or on with the backup codes left' })
      .handler(({ context }) => twoFactorOverview(context.principal)),
    onboardingOptions: base
      .route({ method: 'GET', path: '/account/onboarding-options', summary: 'Countries, cities and scripts for onboarding' })
      .handler(({ context }) => onboardingOptions(context.principal)),
    onboard: signedIn
      .route({ method: 'POST', path: '/account/onboard', summary: "Create the account's own person (onboarding)" })
      .input(onboardInput)
      .handler(({ context, input }) => onboard(context.principal, input, context.meta)),
    // M08: Student or Sifu; sets the free plan and verifies nothing (DEFAULT D04).
    setType: signedIn
      .route({ method: 'POST', path: '/account/type', summary: 'Choose Student or Sifu: sets the free plan, audited, verifies nothing' })
      .input(setAccountTypeInput)
      .handler(({ context, input }) => setAccountType(context.principal, input, context.meta)),
    // M07: /account/privacy.
    privacy: base
      .route({ method: 'GET', path: '/account/privacy', summary: "The account's consents, its open deletion request and whether its profile is public" })
      .handler(({ context }) => privacyOverview(context.principal)),
    requestDeletion: signedIn
      .route({ method: 'POST', path: '/account/request-deletion', summary: 'Ask for the account to be deleted: opens a review case and notifies the admins, audited' })
      .input(requestDeletionInput)
      .handler(({ context, input }) => requestAccountDeletion(context.principal, input, context.meta)),
  },
  consent: {
    record: signedIn
      .route({ method: 'POST', path: '/consent/record', summary: 'Record consents for the current document versions' })
      .input(recordConsentsInput)
      .handler(({ context, input }) => recordConsents(context.principal, input, context.meta)),
    // M07: an optional consent (publication, privacy notice acknowledged); publication also hides the profile.
    withdraw: signedIn
      .route({ method: 'POST', path: '/consent/withdraw', summary: 'Withdraw optional consents: a new consent record each, audited; publication also hides the own profile' })
      .input(consentWithdrawInput)
      .handler(({ context, input }) => consentWithdraw(context.principal, input, context.meta)),
  },
  // M07: the own profile (names in any script, biography, place, public or not).
  profile: {
    get: base
      .route({ method: 'GET', path: '/profile', summary: "The signed-in account's own profile and the editor's options" })
      .handler(({ context }) => profileGet(context.principal)),
    update: signedIn
      .route({ method: 'POST', path: '/profile/update', summary: "Save the account's own profile: names (a Latin-script display name is required), biography, place, public or not; audited" })
      .input(profileUpdateInput)
      .handler(({ context, input }) => profileUpdate(context.principal, input, context.meta)),
  },
  // M07: people, schools and lineages by any spelling; public records only, the same for everyone.
  search: {
    query: base
      // POST, so the names people type stay out of URLs and the access logs of any proxy (plan §6.4).
      .route({ method: 'POST', path: '/search', summary: 'Search people, schools and lineages by any spelling of a name (public records only)' })
      .input(searchInput)
      .output(searchResultSchema)
      .handler(({ context, input }) => searchQuery(context.principal, input, context.meta)),
  },
  admin: {
    overview: base
      .route({ method: 'GET', path: '/admin/overview', summary: 'Counts for the admin page (staff with a verified second factor)' })
      .handler(({ context }) => adminOverview(context.principal)),
    setRole: adminWithSecondFactor
      .route({ method: 'POST', path: '/admin/set-role', summary: "Change an account's role (admin with a verified second factor)" })
      .input(setRoleInput)
      .handler(({ context, input }) => setUserRole(context.principal, input, context.meta)),
  },
  // M04: the public lineage reads (plan §6.3). Anonymous callers get the public graph; a signed-in
  // participant also gets their own involved_only relationships, marked (DEFAULT D03).
  lineage: {
    ego: base
      .route({ method: 'GET', path: '/lineage/ego', summary: 'Ego network of a person: teachers up, students down, capped' })
      .input(egoInput)
      .output(lineageGraphSchema)
      .handler(({ context, input }) => lineageEgo(context.principal, input, context.meta)),
    ancestors: base
      .route({ method: 'GET', path: '/lineage/ancestors', summary: 'Every recorded ancestor of a person' })
      .input(ancestorsInput)
      .output(lineageGraphSchema)
      .handler(({ context, input }) => lineageAncestors(context.principal, input, context.meta)),
    subtree: base
      .route({ method: 'GET', path: '/lineage/subtree', summary: 'Descendants of a person, optionally in one lineage, to a depth' })
      .input(subtreeInput)
      .output(lineageGraphSchema)
      .handler(({ context, input }) => lineageSubtree(context.principal, input, context.meta)),
    paths: base
      .route({ method: 'GET', path: '/lineage/paths', summary: 'Routes of descent from the earliest recorded teachers to a person' })
      .input(pathsInput)
      .output(lineagePathsSchema)
      .handler(({ context, input }) => lineagePaths(context.principal, input, context.meta)),
    // M05: the explorer's starting points (public lineages with a public root).
    start: base
      .route({ method: 'GET', path: '/lineage/start', summary: 'Public lineages with their public root: where the explorer starts' })
      .output(exploreStartSchema)
      .handler(({ context }) => exploreStart(context.meta)),
  },
  people: {
    get: base
      .route({ method: 'GET', path: '/people/{slug}', summary: 'Public profile of a person (404 when missing or not public)' })
      .input(personInput)
      .output(personProfileSchema)
      .handler(({ context, input }) => personProfile(context.principal, input, context.meta)),
    students: base
      .route({ method: 'GET', path: '/people/{slug}/students', summary: "A page of a person's students, active then historical" })
      .input(studentsInput)
      .output(studentsPageSchema)
      .handler(({ context, input }) => personStudents(context.principal, input, context.meta)),
  },
  // M08: plans, test plans, notifications and the dashboard (plan §5.6, §6.5).
  plans: {
    catalog: base
      .route({ method: 'GET', path: '/plans', summary: 'The plan matrix: plans, proposed prices (not final) and features with their availability' })
      .handler(() => planCatalog()),
    mine: base
      .route({ method: 'GET', path: '/plans/mine', summary: "The signed-in account's type, plan in effect, grants and open pilot request" })
      .handler(({ context }) => myPlan(context.principal)),
    requestPilotAccess: signedIn
      .route({ method: 'POST', path: '/plans/request-pilot-access', summary: 'Ask the admins for pilot access to a plan; notifies them and never charges' })
      .input(requestPilotAccessInput)
      .handler(({ context, input }) => requestPilotAccess(context.principal, input, context.meta)),
  },
  grants: {
    list: adminWithSecondFactor
      .route({ method: 'GET', path: '/admin/grants', summary: 'Plan grants and open pilot requests (admin with a verified second factor)' })
      .input(listGrantsInput)
      .handler(({ context, input }) => listGrants(context.principal, input)),
    create: adminWithSecondFactor
      .route({ method: 'POST', path: '/admin/grants/create', summary: 'Give a test or complimentary plan with a reason, start and end (admin, audited)' })
      .input(createGrantInput)
      .handler(({ context, input }) => createGrant(context.principal, input, context.meta)),
    revoke: adminWithSecondFactor
      .route({ method: 'POST', path: '/admin/grants/revoke', summary: 'Revoke a plan grant with a reason (admin, audited); confirmed links stay confirmed' })
      .input(revokeGrantInput)
      .handler(({ context, input }) => revokeGrant(context.principal, input, context.meta)),
    // M08 review round 2: the other answer to a pilot access request.
    closeRequest: adminWithSecondFactor
      .route({ method: 'POST', path: '/admin/grants/close-request', summary: 'Close a pilot access request without giving the plan, with a reason (admin, audited)' })
      .input(closePilotRequestInput)
      .handler(({ context, input }) => closePilotRequest(context.principal, input, context.meta)),
  },
  notifications: {
    list: base
      .route({ method: 'GET', path: '/notifications', summary: "The signed-in account's newest notifications and its unread count" })
      .handler(({ context }) => listNotifications(context.principal)),
    markRead: signedIn
      .route({ method: 'POST', path: '/notifications/mark-read', summary: 'Mark own notifications read: some by id, or all' })
      .input(markReadInput)
      .handler(({ context, input }) => markNotificationsRead(context.principal, input)),
  },
  // M09: teacher requests and independent approvals (plan §6.3, §6.7). Every mutation takes an
  // idempotency key; the services check who may do what (relationships.ts, the authorization matrix).
  relationships: {
    request: signedIn
      .route({ method: 'POST', path: '/relationships/request', summary: 'Ask a teacher to confirm that they taught you: pending, visible only to the two of you and the reviewers' })
      .input(requestInput)
      .handler(({ context, input }) => requestTeacher(context.principal, input, context.meta)),
    resubmit: signedIn
      .route({ method: 'POST', path: '/relationships/resubmit', summary: 'Correct a declined request and send it again (the student)' })
      .input(resubmitInput)
      .handler(({ context, input }) => resubmitRelationship(context.principal, input, context.meta)),
    approve: signedIn
      .route({ method: 'POST', path: '/relationships/approve', summary: "Approve a student's request (the teacher): verified and public; refused at the plan's limit" })
      .input(relationshipActionInput)
      .handler(({ context, input }) => approveRelationship(context.principal, input, context.meta)),
    reject: signedIn
      .route({ method: 'POST', path: '/relationships/reject', summary: "Decline a student's request with a neutral reason (the teacher); the student can correct it" })
      .input(rejectInput)
      .handler(({ context, input }) => rejectRelationship(context.principal, input, context.meta)),
    withdraw: signedIn
      .route({ method: 'POST', path: '/relationships/withdraw', summary: 'Withdraw a request that waits or was declined (the student)' })
      .input(relationshipActionInput)
      .handler(({ context, input }) => withdrawRelationship(context.principal, input, context.meta)),
    end: signedIn
      .route({ method: 'POST', path: '/relationships/end', summary: 'Mark the training as ended (the student or the teacher): the link stays, as historical' })
      .input(endInput)
      .handler(({ context, input }) => endRelationship(context.principal, input, context.meta)),
    mine: base
      .route({ method: 'GET', path: '/relationships/mine', summary: "The signed-in account's teachers and its requests to teachers" })
      .handler(({ context }) => myTeachers(context.principal)),
    incoming: base
      .route({ method: 'GET', path: '/relationships/incoming', summary: 'Requests waiting for the signed-in teacher, their students and the approval allowance' })
      .handler(({ context }) => studentRequests(context.principal)),
    options: base
      .route({ method: 'GET', path: '/relationships/options', summary: 'The lineages and schools the request form offers' })
      .handler(({ context }) => requestOptions(context.principal)),
    get: base
      .route({ method: 'GET', path: '/relationships/{id}', summary: 'One relationship, for its student, its teacher or a reviewer (404 for anyone else)' })
      .input(relationshipIdInput)
      .handler(({ context, input }) => getRelationship(context.principal, input)),
    // M10a: a historical or deceased teacher, confirmed by the review committee from evidence.
    requestHistorical: signedIn
      .route({
        method: 'POST',
        path: '/relationships/request-historical',
        summary: 'Claim training with a historical or deceased teacher, with evidence: under review, visible only to you and the reviewers',
      })
      .input(historicalClaimInput)
      .handler(({ context, input }) => requestHistoricalTeacher(context.principal, input, context.meta)),
    // M10b: a living teacher who is not on WingChunRoots yet (plan §6.7).
    invite: signedIn
      .route({
        method: 'POST',
        path: '/relationships/invite',
        summary: 'List a living teacher who is not here yet: an unclaimed record and a request awaiting their claim, with an optional e-mail invitation; visible only to you, them and the reviewers',
      })
      .input(inviteInput)
      .handler(({ context, input }) => inviteTeacher(context.principal, input, context.meta)),
  },
  // M10b: invitation links (/invite/<token>). The token is the secret: it travels only in request
  // bodies, never in an API address; only its SHA-256 hash is stored.
  invitations: {
    send: signedIn
      .route({ method: 'POST', path: '/invitations/send', summary: 'Send (or send again) the e-mail invitation of a request awaiting the teacher’s claim (the student); an older link stops working' })
      .input(sendInvitationInput)
      .handler(({ context, input }) => sendInvitation(context.principal, input, context.meta)),
    get: base
      .route({ method: 'POST', path: '/invitations/view', summary: 'What an invitation link is about and whether the signed-in account can accept it (404 for an unknown link)' })
      .input(invitationTokenInput)
      .handler(({ context, input }) => getInvitation(context.principal, input)),
    accept: signedIn
      .route({ method: 'POST', path: '/invitations/accept', summary: 'Accept an invitation: claim the unclaimed record, reviewed by an archivist before it becomes yours; single use' })
      .input(acceptInvitationInput)
      .handler(({ context, input }) => acceptInvitation(context.principal, input, context.meta)),
  },
  // M10b: instructor verification of a Sifu (plan §6.5, DEFAULT D04/D13).
  instructor: {
    mine: base
      .route({ method: 'GET', path: '/instructor', summary: "The signed-in account's instructor status (verified or unverified) and its newest verification case" })
      .handler(({ context }) => instructorOverview(context.principal)),
    request: signedIn
      .route({ method: 'POST', path: '/instructor/request', summary: 'Send evidence that you are an instructor (a Sifu): a review case an archivist decides' })
      .input(instructorRequestInput)
      .handler(({ context, input }) => requestInstructorVerification(context.principal, input, context.meta)),
  },
  // M10b: "Report profile": one report per account and profile; no automatic hiding.
  reports: {
    mine: base
      .route({ method: 'GET', path: '/reports/mine', summary: "The signed-in account's reports of profiles and where each stands" })
      .handler(({ context }) => myReports(context.principal)),
    create: signedIn
      .route({ method: 'POST', path: '/reports/create', summary: 'Report a public profile (copyright, spam, inappropriate, misleading): a review case for the moderators; once per profile' })
      .input(reportInput)
      .handler(({ context, input }) => reportProfile(context.principal, input, context.meta)),
  },
  // M10b: a party's own review cases (profile claims, instructor verifications, disputes).
  cases: {
    mine: base
      .route({ method: 'GET', path: '/cases', summary: "The signed-in account's own review cases: profile claims, instructor verifications and disputes about its relationships" })
      .handler(({ context }) => myCases(context.principal)),
    get: base
      .route({ method: 'GET', path: '/cases/{id}', summary: "One of the account's own cases: status, the reviewers' notes, own replies and files, the decision (404 for anyone else)" })
      .input(caseIdInput)
      .handler(({ context, input }) => getPartyCase(context.principal, input)),
    reply: signedIn
      .route({ method: 'POST', path: '/cases/reply', summary: 'Answer the reviewers of an own open case; a case waiting for information goes back to them' })
      .input(caseReplyInput)
      .handler(({ context, input }) => replyToCase(context.principal, input, context.meta)),
  },
  // M10a: evidence files. The upload and the download are binary route handlers outside the router
  // (POST /api/evidence/upload, GET /api/evidence/{id}; documented in this contract as well).
  evidence: {
    discard: signedIn
      .route({ method: 'POST', path: '/evidence/discard', summary: 'Remove an own evidence file that is in no claim yet (the uploader)' })
      .input(discardInput)
      .handler(({ context, input }) => discardEvidence(context.principal, input, context.meta)),
  },
  // M10a: the review queue (staff with a verified second factor; plan §5.6, §6.7).
  review: {
    list: staffWithSecondFactor
      .route({ method: 'GET', path: '/review', summary: 'The review queue: cases by kind, status and assignee, sorted and paged (staff with a verified second factor)' })
      .input(reviewListInput)
      .handler(({ context, input }) => listReviewCases(context.principal, input)),
    get: staffWithSecondFactor
      .route({ method: 'GET', path: '/review/{id}', summary: 'One review case: the relationship, the evidence, the notes and the allowed actions' })
      .input(reviewIdInput)
      .handler(({ context, input }) => getReviewCase(context.principal, input)),
    assign: staffWithSecondFactor
      .route({ method: 'POST', path: '/review/assign', summary: 'Take a case, give it to another reviewer (an administrator) or unassign it; audited' })
      .input(reviewAssignInput)
      .handler(({ context, input }) => assignReviewCase(context.principal, input, context.meta)),
    decide: staffWithSecondFactor
      .route({
        method: 'POST',
        path: '/review/decide',
        summary:
          'Decide a case: verify, refuse with a reason, or ask for more information (claims and instructors: an archivist or administrator; reports and disputes: a moderator or administrator); audited',
      })
      .input(reviewDecideInput)
      .handler(({ context, input }) => decideReviewCase(context.principal, input, context.meta)),
    // M10b (DEFAULT D19): a verified relationship in arbitration, with a reason both parties read.
    arbitrate: staffWithSecondFactor
      .route({
        method: 'POST',
        path: '/review/arbitrate',
        summary: 'Set a verified relationship in arbitration with a reason (a moderator or administrator): public pages show "Disputed"; both parties are notified and asked for evidence; audited',
      })
      .input(arbitrateInput)
      .handler(({ context, input }) => arbitrateRelationship(context.principal, input, context.meta)),
    note: staffWithSecondFactor
      .route({ method: 'POST', path: '/review/note', summary: 'Add an internal note to a case (reviewers only); audited' })
      .input(reviewNoteInput)
      .handler(({ context, input }) => addReviewNote(context.principal, input, context.meta)),
  },
  // M10a: the archival edit (plan §6.6): only an archivist edits a record kept by the platform or unclaimed.
  archive: {
    get: staffWithSecondFactor
      .route({ method: 'GET', path: '/archive/{slug}', summary: 'A record for the archival edit, with its evidence (staff with a verified second factor)' })
      .input(archiveGetInput)
      .handler(({ context, input }) => getArchiveRecord(context.principal, input)),
    update: staffWithSecondFactor
      .route({ method: 'POST', path: '/archive/update', summary: 'Edit a record kept by the platform or unclaimed with a required reason and optional evidence (archivist only); audited' })
      .input(archiveUpdateInput)
      .handler(({ context, input }) => updateArchiveRecord(context.principal, input, context.meta)),
  },
  // M11: schools, the map and the lineage filter (plan §6.4). The public reads are POST, so a
  // visitor's search centre or map view stays out of URLs and proxy logs (as search.query).
  schools: {
    search: base
      .route({ method: 'POST', path: '/schools/search', summary: 'Public schools within a radius of a centre (nearest first, whole kilometres), or all of them; optionally only those whose instructors descend from a lineage root' })
      .input(schoolSearchInput)
      .output(schoolSearchSchema)
      .handler(({ context, input }) => schoolsSearch(context.principal, input)),
    inViewport: base
      .route({ method: 'POST', path: '/schools/in-viewport', summary: "Public schools inside the map's bounding box; city-only schools at their city's centre" })
      .input(schoolViewportInput)
      .output(schoolSearchSchema)
      .handler(({ context, input }) => schoolsInViewport(context.principal, input)),
    get: base
      .route({ method: 'GET', path: '/schools/{slug}', summary: "A public school's page: instructors, contact, forms and its location (exact or city only); 404 when not public" })
      .input(schoolSlugInput)
      .output(schoolPageSchema)
      .handler(({ context, input }) => schoolGet(context.principal, input)),
    sitemap: base
      .route({ method: 'GET', path: '/sitemap/schools', summary: 'The addresses of the public schools and when each last changed (the sitemap)' })
      .output(schoolSitemapSchema)
      .handler(() => schoolSitemap()),
    mine: base
      .route({ method: 'GET', path: '/schools/mine', summary: 'The schools the signed-in account listed, with their status and whether the pin shows' })
      .handler(({ context }) => mySchools(context.principal)),
    edit: base
      .route({ method: 'GET', path: '/schools/mine/{id}', summary: "One of the account's own schools for the editor, with the review state, the upgrade offer and the cities (optionally those matching `city`)" })
      .input(schoolIdInput.extend({ city: schoolEditorInput.shape.city }))
      .handler(({ context, input }) => schoolEditor(context.principal, input)),
    options: base
      .route({ method: 'GET', path: '/schools/mine/new', summary: 'What the form for a new school offers: cities (optionally those matching `city`), instructors, forms, and whether a pin can be sent for review' })
      .input(schoolEditorInput.pick({ city: true }).optional())
      .handler(({ context, input }) => schoolEditor(context.principal, { city: input?.city })),
    create: signedIn
      .route({ method: 'POST', path: '/schools/create', summary: 'List a new school as a draft (a Sifu with a profile; the head instructor); only you see it' })
      .input(schoolCreateInput)
      .handler(({ context, input }) => createSchool(context.principal, input, context.meta)),
    update: signedIn
      .route({ method: 'POST', path: '/schools/update', summary: 'Edit your school; a listed school stays listed; last activity moves (D17)' })
      .input(schoolUpdateInput)
      .handler(({ context, input }) => updateSchool(context.principal, input, context.meta)),
    submit: signedIn
      .route({ method: 'POST', path: '/schools/submit', summary: 'Send a draft for the listing review (needs Professional Sifu, otherwise ENTITLEMENT_REQUIRED), or answer the reviewers' })
      .input(schoolIdInput)
      .handler(({ context, input }) => submitSchool(context.principal, input, context.meta)),
    confirm: signedIn
      .route({ method: 'POST', path: '/schools/confirm', summary: 'Confirm that a listed school is current (last activity, D17)' })
      .input(schoolIdInput)
      .handler(({ context, input }) => confirmSchool(context.principal, input, context.meta)),
  },
  places: {
    search: base
      .route({ method: 'GET', path: '/places/search', summary: 'Cities of the GeoNames extract (CC BY 4.0) by any spelling, the larger first' })
      .input(placeSearchInput)
      .output(placeSearchSchema)
      .handler(({ context, input }) => placesSearch(context.principal, input)),
  },
  dashboard: {
    overview: base
      .route({ method: 'GET', path: '/dashboard', summary: "The signed-in account's dashboard: teachers, requests, schools, allowance, notifications" })
      .handler(({ context }) => dashboardOverview(context.principal)),
  },
};

export type Router = typeof router;
/** The router as a client sees it: the type src/lib/rpc-client gives the browser's client (M05). */
export type AppRouterClient = RouterClient<Router>;
