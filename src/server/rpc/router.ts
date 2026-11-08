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
import { eventListSchema, eventPageSchema } from '../dto/events';
import { passportSchema } from '../dto/passport';
import type { Principal } from '../auth/principal';
import { accountOverview, landingInput, landingPath, onboard, onboardingOptions, onboardInput } from '../services/account';
import { adminOverview } from '../services/admin';
import { recordConsents, recordConsentsInput } from '../services/consent';
import type { RequestMeta } from '../services/context';
import { dashboardOverview } from '../services/dashboard';
import { discardEvidence, discardInput } from '../services/evidence';
import { isServiceError } from '../services/errors';
import {
  cancelEvent,
  createEvent,
  eventCancelInput,
  eventCreateInput,
  eventEditor,
  eventEditorInput,
  eventGet,
  eventIdInput,
  eventPosterUploadInput,
  eventRemoveInput,
  eventSlugInput,
  eventsList,
  eventsListInput,
  eventUpdateInput,
  myEvents,
  removeEvent,
  removeEventPoster,
  updateEvent,
  uploadEventPoster,
} from '../services/events';
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
import {
  addExam,
  addExamInput,
  addRank,
  addRankInput,
  addSkill,
  addSkillInput,
  certificateIdInput,
  certificateUploadInput,
  markAttendance,
  markAttendanceInput,
  myPassport,
  passportGet,
  passportRemoveInput,
  passportSlugInput,
  passportStudents,
  passportStudentsInput,
  removeCertificate,
  removePassportEntry,
  setVisibility,
  setVisibilityInput,
  updateEntry,
  updateEntryInput,
  uploadCertificate,
  withdrawEntry,
  withdrawEntryInput,
} from '../services/passport';
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
import { getPhoto, photoGetInput, photoRemoveInput, photoUploadInput, removePhoto, uploadPhoto } from '../services/photos';
import {
  addGalleryPhoto,
  galleryAddInput,
  galleryGetInput,
  galleryRemoveInput,
  galleryReorderInput,
  gallerySetProfileInput,
  galleryUpdateInput,
  getGallery,
  getOwnGallery,
  removeGalleryPhoto,
  reorderGallery,
  setProfilePhoto,
  updateGalleryPhoto,
} from '../services/gallery';
import {
  getSchoolPhotos,
  removeSchoolPhoto,
  reorderSchoolPhotos,
  schoolPhotoRemoveInput,
  schoolPhotoReorderInput,
  schoolPhotosGetInput,
  schoolPhotoUpdateInput,
  schoolPhotoUploadInput,
  updateSchoolPhoto,
  uploadSchoolPhoto,
} from '../services/school-photos';
import { myReports, reportInput, reportProfile } from '../services/reports';
import {
  listNotifications,
  listNotificationsInput,
  markAllNotificationsRead,
  markAllReadInput,
  markNotificationsRead,
  markReadInput,
  notificationPreferences,
  setNotificationPreference,
  setPreferenceInput,
  unsubscribe,
  unsubscribeInfo,
  unsubscribeInput,
} from '../services/notifications';
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
import { systemStatus } from '../services/system';
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
import { organizationListSchema, organizationPageSchema } from '../dto/organizations';
import {
  addAdminInput,
  addMemberInput,
  addOrganizationAdmin,
  addOrganizationMember,
  answerSchoolLink,
  answerSchoolLinkInput,
  applicationOptions,
  applyOrganization,
  endMemberInput,
  endOrganizationMember,
  endSchoolLink,
  linkIdInput,
  manageOrganization,
  myOrganizations,
  mySchoolLinks,
  organizationApplyInput,
  organizationGet,
  organizationIdInput,
  organizationSlugInput,
  organizationsList,
  organizationUpdateInput,
  removeAdminInput,
  removeOrganizationAdmin,
  requestOrganizationSchool,
  requestSchoolInput,
  updateOrganization,
} from '../services/organizations';
import {
  adminOrganization,
  adminOrganizationInput,
  adminOrganizations,
  grantOrganizationPlan,
  organizationGrantInput,
  organizationRevokeInput,
  revokeOrganizationPlan,
} from '../services/organization-grants';
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
      .route({
        method: 'GET',
        path: '/notifications',
        summary: "The signed-in account's notifications, newest first, 20 a page, optionally of one category (M18), and its unread count",
      })
      .input(listNotificationsInput)
      .handler(({ context, input }) => listNotifications(context.principal, input)),
    markRead: signedIn
      .route({ method: 'POST', path: '/notifications/mark-read', summary: 'Mark own notifications read: some by id, or all' })
      .input(markReadInput)
      .handler(({ context, input }) => markNotificationsRead(context.principal, input)),
    // M18: lifecycle notices (docs/adr/0021-notices.md).
    markAllRead: signedIn
      .route({ method: 'POST', path: '/notifications/mark-all-read', summary: 'Mark every own notification read, or every one of a category' })
      .input(markAllReadInput)
      .handler(({ context, input }) => markAllNotificationsRead(context.principal, input)),
    preferences: signedIn
      .route({
        method: 'GET',
        path: '/notifications/preferences',
        summary: 'E-mail on or off per category of notices; security and account are always on; dashboard notices always on',
      })
      .handler(({ context }) => notificationPreferences(context.principal)),
    setPreference: signedIn
      .route({ method: 'POST', path: '/notifications/preferences/set', summary: 'Switch the e-mail of one category on or off (never security or account); old unsubscribe links stop working' })
      .input(setPreferenceInput)
      .handler(({ context, input }) => setNotificationPreference(context.principal, input)),
    unsubscribeInfo: base
      .route({ method: 'GET', path: '/notifications/unsubscribe', summary: 'What an unsubscribe link from an e-mail switches off; no sign-in; 404 once the preference changed' })
      .input(unsubscribeInput)
      .handler(({ input }) => unsubscribeInfo(input)),
    unsubscribe: base
      .route({ method: 'POST', path: '/notifications/unsubscribe', summary: "Switch off the e-mails of an unsubscribe link's category, without signing in (idempotent)" })
      .input(unsubscribeInput)
      .handler(({ input }) => unsubscribe(input)),
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
  // M14: profile photos (docs/adr/0016-profile-photos.md). The upload is multipart/form-data with
  // one `file` (JPEG, PNG or WebP, at most 5 MB, refused by size before the body is buffered:
  // src/server/rpc/handler.ts); the photo itself is served by GET /api/photos/{id}/{hash}/{size}.webp.
  photos: {
    get: base
      .route({ method: 'GET', path: '/photos/{slug}', summary: "A person's current profile photo (the 96 px and 512 px addresses), and whether this viewer may change or remove it; 404 for a person this viewer may not see" })
      .input(photoGetInput)
      .handler(({ context, input }) => getPhoto(context.principal, input)),
    upload: signedIn
      .route({
        method: 'POST',
        path: '/photos/upload',
        summary:
          'Upload or replace the profile photo of your own person (multipart `file`: JPEG, PNG or WebP, at most 5 MB): metadata and location removed, cropped square, stored as WebP at 96 and 512 px; counts as one photo of your plan (D07); audited',
      })
      .input(photoUploadInput)
      .handler(({ context, input }) => uploadPhoto(context.principal, input, context.meta)),
    remove: signedIn
      .route({
        method: 'POST',
        path: '/photos/remove',
        summary: "Remove a profile photo: your own (no slug), or as staff with a verified second factor anyone's, with a reason kept in the audit log; audited",
      })
      .input(photoRemoveInput)
      .handler(({ context, input }) => removePhoto(context.principal, input, context.meta)),
  },
  // M16: a person's gallery (docs/adr/0019-galleries.md). The profile photo is one of its photos;
  // every photo counts against the plan's `photos` allowance (DEFAULT D07). The upload is
  // multipart/form-data like photos.upload; the images are served by GET /api/photos/{id}/{hash}/{file}.
  gallery: {
    mine: signedIn
      .route({ method: 'GET', path: '/gallery/mine', summary: 'Your own gallery, with your plan\'s photo allowance and, at the limit, the upgrade offer; 404 without a profile yet' })
      .handler(({ context }) => getOwnGallery(context.principal)),
    get: base
      .route({
        method: 'GET',
        path: '/gallery/{slug}',
        summary: "A person's gallery (the photos in their order, their captions, which is the profile photo); for its owner also the allowance and, at the limit, the upgrade offer; 404 for a person this viewer may not see",
      })
      .input(galleryGetInput)
      .handler(({ context, input }) => getGallery(context.principal, input)),
    add: signedIn
      .route({
        method: 'POST',
        path: '/gallery/add',
        summary:
          'Add a photo to your own gallery (multipart `file`: JPEG, PNG or WebP, at most 5 MB; optional `caption`): metadata and location removed, stored as WebP squares and the whole photo; counts against your plan (D07, ENTITLEMENT_REQUIRED at the limit); audited',
      })
      .input(galleryAddInput)
      .handler(({ context, input }) => addGalleryPhoto(context.principal, input, context.meta)),
    remove: signedIn
      .route({ method: 'POST', path: '/gallery/remove', summary: "Remove a photo of your own gallery, or as staff with a verified second factor anyone's, with a reason kept in the audit log; audited" })
      .input(galleryRemoveInput)
      .handler(({ context, input }) => removeGalleryPhoto(context.principal, input, context.meta)),
    update: signedIn
      .route({ method: 'POST', path: '/gallery/update', summary: 'Change the caption of a photo of your own gallery (the alt text in the viewer); audited' })
      .input(galleryUpdateInput)
      .handler(({ context, input }) => updateGalleryPhoto(context.principal, input, context.meta)),
    reorder: signedIn
      .route({ method: 'POST', path: '/gallery/reorder', summary: 'Put the photos of your own gallery in a new order (every photo once; CONFLICT when the gallery changed); audited' })
      .input(galleryReorderInput)
      .handler(({ context, input }) => reorderGallery(context.principal, input, context.meta)),
    setProfile: signedIn
      .route({ method: 'POST', path: '/gallery/profile', summary: 'Make a photo of your own gallery your profile photo; the previous one stays in the gallery; audited' })
      .input(gallerySetProfileInput)
      .handler(({ context, input }) => setProfilePhoto(context.principal, input, context.meta)),
  },
  // M16: a school's logo and room photos (a gallery of its own, DEFAULT D07: at most 12 room photos),
  // for the account that listed the school; shown on the public page through schools.get.
  schoolPhotos: {
    get: signedIn
      .route({ method: 'GET', path: '/schools/mine/{schoolId}/photos', summary: "The logo and room photos of one of your schools, for its editor (or staff with a verified second factor); 404 for any other school" })
      .input(schoolPhotosGetInput)
      .handler(({ context, input }) => getSchoolPhotos(context.principal, input)),
    upload: signedIn
      .route({
        method: 'POST',
        path: '/schools/photos/upload',
        summary:
          'Upload the logo of your school (replacing the old one) or one more room photo (multipart `schoolId`, `kind` logo|room, `file`, optional `caption`): metadata and location removed, stored as WebP; at most 12 room photos (D07, CONFLICT past it); audited',
      })
      .input(schoolPhotoUploadInput)
      .handler(({ context, input }) => uploadSchoolPhoto(context.principal, input, context.meta)),
    remove: signedIn
      .route({ method: 'POST', path: '/schools/photos/remove', summary: "Remove a photo of your school, or as staff with a verified second factor any school's, with a reason kept in the audit log; audited" })
      .input(schoolPhotoRemoveInput)
      .handler(({ context, input }) => removeSchoolPhoto(context.principal, input, context.meta)),
    update: signedIn
      .route({ method: 'POST', path: '/schools/photos/update', summary: 'Change the caption of a room photo of your school; audited' })
      .input(schoolPhotoUpdateInput)
      .handler(({ context, input }) => updateSchoolPhoto(context.principal, input, context.meta)),
    reorder: signedIn
      .route({ method: 'POST', path: '/schools/photos/reorder', summary: "Put your school's room photos in a new order (every photo once; CONFLICT when they changed); audited" })
      .input(schoolPhotoReorderInput)
      .handler(({ context, input }) => reorderSchoolPhotos(context.principal, input, context.meta)),
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
  // M15: organizations (docs/adr/0018-organizations.md). The public reads give public DTOs only;
  // an organization's admin reaches only the organizations they administer (404 for any other).
  organizations: {
    list: base
      .route({ method: 'GET', path: '/organizations', summary: 'Approved organizations: name, kind and country' })
      .output(organizationListSchema)
      .handler(() => organizationsList()),
    mine: base
      .route({ method: 'GET', path: '/organizations/mine', summary: 'The organizations the signed-in account administers, their approval and plan, and whether it may apply' })
      .handler(({ context }) => myOrganizations(context.principal)),
    options: base
      .route({ method: 'GET', path: '/organizations/apply', summary: 'What the application form offers: countries and kinds of organization' })
      .handler(({ context }) => applicationOptions(context.principal)),
    schoolLinks: base
      .route({ method: 'GET', path: '/organizations/school-links', summary: 'The organization links the schools of the signed-in account were asked for or accepted' })
      .handler(({ context }) => mySchoolLinks(context.principal)),
    manage: base
      .route({ method: 'GET', path: '/organizations/mine/{organizationId}', summary: 'One organization the account administers: approval, plan, details, admins, members, schools, its application (404 for any other)' })
      .input(organizationIdInput)
      .handler(({ context, input }) => manageOrganization(context.principal, input)),
    get: base
      .route({ method: 'GET', path: '/organizations/{slug}', summary: "An approved organization's public page: public members and public schools by city; 404 when not approved" })
      .input(organizationSlugInput)
      .output(organizationPageSchema)
      .handler(({ context, input }) => organizationGet(context.principal, input)),
    apply: signedIn
      .route({ method: 'POST', path: '/organizations/apply', summary: 'Apply for an organization: official name, kind, leader, website, country, number of schools and an optional private document; opens a review case' })
      .input(organizationApplyInput)
      .handler(({ context, input }) => applyOrganization(context.principal, input, context.meta)),
    update: signedIn
      .route({ method: 'POST', path: '/organizations/update', summary: "Edit your organization: a pending one edits its application, an approved one its website, leader and number of schools" })
      .input(organizationUpdateInput)
      .handler(({ context, input }) => updateOrganization(context.principal, input, context.meta)),
    addAdmin: signedIn
      .route({ method: 'POST', path: '/organizations/admins/add', summary: 'An owner adds an existing account as an admin of an approved organization (audited)' })
      .input(addAdminInput)
      .handler(({ context, input }) => addOrganizationAdmin(context.principal, input, context.meta)),
    removeAdmin: signedIn
      .route({ method: 'POST', path: '/organizations/admins/remove', summary: 'An owner removes an admin, or an admin leaves (audited); an owner stays' })
      .input(removeAdminInput)
      .handler(({ context, input }) => removeOrganizationAdmin(context.principal, input, context.meta)),
    addMember: signedIn
      .route({ method: 'POST', path: '/organizations/members/add', summary: 'List a public person as a member (needs approval and the Federation plan); never creates or verifies a teaching relationship' })
      .input(addMemberInput)
      .handler(({ context, input }) => addOrganizationMember(context.principal, input, context.meta)),
    endMember: signedIn
      .route({ method: 'POST', path: '/organizations/members/end', summary: 'End a membership today; it stays as history (needs approval and the Federation plan)' })
      .input(endMemberInput)
      .handler(({ context, input }) => endOrganizationMember(context.principal, input, context.meta)),
    requestSchool: signedIn
      .route({ method: 'POST', path: '/organizations/schools/request', summary: "Ask a public school to link to the organization; the school's account accepts or refuses (needs approval and the Federation plan)" })
      .input(requestSchoolInput)
      .handler(({ context, input }) => requestOrganizationSchool(context.principal, input, context.meta)),
    answerSchoolLink: signedIn
      .route({ method: 'POST', path: '/organizations/schools/answer', summary: "The school's account accepts or refuses an organization's link; the school and its pin do not change" })
      .input(answerSchoolLinkInput)
      .handler(({ context, input }) => answerSchoolLink(context.principal, input, context.meta)),
    endSchoolLink: signedIn
      .route({ method: 'POST', path: '/organizations/schools/end', summary: 'End a school link, from either side (the school and its pin do not change)' })
      .input(linkIdInput)
      .handler(({ context, input }) => endSchoolLink(context.principal, input, context.meta)),
    adminList: adminWithSecondFactor
      .route({ method: 'GET', path: '/admin/organizations', summary: 'Every organization with its approval and its plan, apart (admin with a verified second factor)' })
      .handler(({ context }) => adminOrganizations(context.principal)),
    adminGet: adminWithSecondFactor
      .route({ method: 'GET', path: '/admin/organizations/{organizationId}', summary: 'One organization with its plan grants (admin with a verified second factor)' })
      .input(adminOrganizationInput)
      .handler(({ context, input }) => adminOrganization(context.principal, input)),
    grant: adminWithSecondFactor
      .route({ method: 'POST', path: '/admin/organizations/grant', summary: 'Give an approved organization a test or complimentary Federation plan with a reason, start and end (admin, audited; never charged)' })
      .input(organizationGrantInput)
      .handler(({ context, input }) => grantOrganizationPlan(context.principal, input, context.meta)),
    revokeGrant: adminWithSecondFactor
      .route({ method: 'POST', path: '/admin/organizations/revoke-grant', summary: "Revoke an organization's plan with a reason (admin, audited); members, school links and the public page stay" })
      .input(organizationRevokeInput)
      .handler(({ context, input }) => revokeOrganizationPlan(context.principal, input, context.meta)),
  },
  // M17: the event calendar (docs/adr/0020-events.md). The public reads give public DTOs only
  // (v_public_event); an event is changed and cancelled only by its organizer, removed by staff.
  events: {
    list: base
      .route({
        method: 'GET',
        path: '/events',
        summary: 'Upcoming (still running or later) or past events, by start; filters: country, kind, online or in person, a person or a school; 20 per page',
      })
      .input(eventsListInput)
      .output(eventListSchema)
      .handler(({ context, input }) => eventsList(context.principal, input)),
    mine: signedIn
      .route({
        method: 'GET',
        path: '/events/mine',
        summary: "Your events and the organizations' you administer, your plan's monthly allowance (in each event's own time zone) and, at the limit, the upgrade offer",
      })
      .handler(({ context }) => myEvents(context.principal)),
    editor: signedIn
      .route({ method: 'GET', path: '/events/editor', summary: 'What the event form offers: kinds, cities, your listed schools, public people to name as instructors, time zones; with `id`, your event to edit (404 for any other)' })
      .input(eventEditorInput)
      .handler(({ context, input }) => eventEditor(context.principal, input)),
    get: base
      .route({ method: 'GET', path: '/events/{slug}', summary: "An event's public page: dates in its own time zone, city or online, organizer and instructors who are public, school, poster; 404 for a removed one" })
      .input(eventSlugInput)
      .output(eventPageSchema)
      .handler(({ context, input }) => eventGet(context.principal, input)),
    create: signedIn
      .route({
        method: 'POST',
        path: '/events/create',
        summary:
          'Publish an event at once, as your Sifu account or (`organizationId`) an approved organization you administer: Professional Sifu up to 3 a month (in the event\'s time zone), an organization with Federation without a limit (ENTITLEMENT_REQUIRED otherwise); notifies Premium Students of the teachers; audited',
      })
      .input(eventCreateInput)
      .handler(({ context, input }) => createEvent(context.principal, input, context.meta)),
    update: signedIn
      .route({ method: 'POST', path: '/events/update', summary: 'Change your event (a move to another month is checked against that month\'s allowance); audited' })
      .input(eventUpdateInput)
      .handler(({ context, input }) => updateEvent(context.principal, input, context.meta)),
    cancel: signedIn
      .route({ method: 'POST', path: '/events/cancel', summary: 'Cancel your event with an optional public note: it stays shown as Cancelled; notifies Premium Students of the teachers; audited' })
      .input(eventCancelInput)
      .handler(({ context, input }) => cancelEvent(context.principal, input, context.meta)),
    remove: staffWithSecondFactor
      .route({ method: 'POST', path: '/events/remove', summary: 'Remove an event with a reason kept in the audit log (staff with a verified second factor): 404 everywhere after' })
      .input(eventRemoveInput)
      .handler(({ context, input }) => removeEvent(context.principal, input, context.meta)),
    uploadPoster: signedIn
      .route({
        method: 'POST',
        path: '/events/poster/upload',
        summary: "Upload or replace your event's poster (multipart `id`, `file`: JPEG, PNG or WebP, at most 5 MB): metadata and location removed, stored as WebP squares and the whole image; apart from every gallery; audited",
      })
      .input(eventPosterUploadInput)
      .handler(({ context, input }) => uploadEventPoster(context.principal, input, context.meta)),
    removePoster: signedIn
      .route({ method: 'POST', path: '/events/poster/remove', summary: "Remove your event's poster; audited" })
      .input(eventIdInput)
      .handler(({ context, input }) => removeEventPoster(context.principal, input, context.meta)),
  },
  // M19: the training passport (docs/adr/0022-passport.md). passport.get gives the public DTO only
  // (public entries of public people, as the plan of the passport's account shows them); the
  // teacher or the issuing organization records, the student decides what is public.
  passport: {
    get: base
      .route({
        method: 'GET',
        path: '/passport/{slug}',
        summary:
          "A public person's training passport as their plan shows it: the current rank, the teachers with their periods and the year training began; on Premium Student and Professional Sifu also the timeline of examinations, forms and skills, certificates and events. Public entries only; 404 for a person who is not public",
      })
      .input(passportSlugInput)
      .output(passportSchema)
      .handler(({ context, input }) => passportGet(context.principal, input)),
    mine: signedIn
      .route({
        method: 'GET',
        path: '/passport/mine',
        summary: 'Your own passport: every entry with its visibility, whether your profile shows it on your plan, proposed corrections, certificates and, where entries are kept but hidden by the plan, the upgrade offer',
      })
      .handler(({ context }) => myPassport(context.principal)),
    students: signedIn
      .route({
        method: 'GET',
        path: '/passport/students',
        summary:
          'The students you record for (your established students, and members of the approved organizations you administer); with `personId`, their entries you may see and change and your past events for attendance',
      })
      .input(passportStudentsInput)
      .handler(({ context, input }) => passportStudents(context.principal, input)),
    addRank: signedIn
      .route({
        method: 'POST',
        path: '/passport/rank/add',
        summary:
          "Record a rank for your student (their teacher, while the relationship is verified) or for a member of an organization you administer (`organizationId`); never your own; the student is told; audited",
      })
      .input(addRankInput)
      .handler(({ context, input }) => addRank(context.principal, input, context.meta)),
    addExam: signedIn
      .route({ method: 'POST', path: '/passport/exam/add', summary: 'Record an examination: date (as precise as known), the awarded rank, optionally the examiner (a person of the archive) and the organization; as for addRank' })
      .input(addExamInput)
      .handler(({ context, input }) => addExam(context.principal, input, context.meta)),
    addSkill: signedIn
      .route({ method: 'POST', path: '/passport/skill/add', summary: 'Record a form or skill, learning or approved; as for addRank' })
      .input(addSkillInput)
      .handler(({ context, input }) => addSkill(context.principal, input, context.meta)),
    updateEntry: signedIn
      .route({
        method: 'POST',
        path: '/passport/entry/update',
        summary: 'Change a rank, examination or skill you recorded (settles a proposed correction); the student sends only `correction`, which tells whoever recorded it; audited',
      })
      .input(updateEntryInput)
      .handler(({ context, input }) => updateEntry(context.principal, input, context.meta)),
    withdrawEntry: signedIn
      .route({ method: 'POST', path: '/passport/entry/withdraw', summary: 'Withdraw an entry you recorded: kept, shown to nobody; audited' })
      .input(withdrawEntryInput)
      .handler(({ context, input }) => withdrawEntry(context.principal, input, context.meta)),
    setVisibility: signedIn
      .route({ method: 'POST', path: '/passport/entry/visibility', summary: 'Make an entry of your own passport private or public; audited' })
      .input(setVisibilityInput)
      .handler(({ context, input }) => setVisibility(context.principal, input, context.meta)),
    uploadCertificate: signedIn
      .route({
        method: 'POST',
        path: '/passport/certificate/upload',
        summary:
          'Upload a scanned certificate to your passport (multipart `file`: JPEG, PNG or WebP, at most 5 MB; `title`, `date`, `visibility`, private by default): metadata and location removed, kept in the private store, at most 20; a scanned document, not a certificate this platform issues; audited',
      })
      .input(certificateUploadInput)
      .handler(({ context, input }) => uploadCertificate(context.principal, input, context.meta)),
    removeCertificate: signedIn
      .route({ method: 'POST', path: '/passport/certificate/remove', summary: 'Remove a certificate of your passport: its files are deleted, the record kept; audited' })
      .input(certificateIdInput)
      .handler(({ context, input }) => removeCertificate(context.principal, input, context.meta)),
    markAttendance: signedIn
      .route({ method: 'POST', path: '/passport/attendance/mark', summary: 'Mark your own established students as attending a past event you organized or taught at; once per event and student; audited' })
      .input(markAttendanceInput)
      .handler(({ context, input }) => markAttendance(context.principal, input, context.meta)),
    remove: staffWithSecondFactor
      .route({ method: 'POST', path: '/passport/remove', summary: 'Remove any passport entry with a reason kept in the audit log and sent to its owner (staff with a verified second factor)' })
      .input(passportRemoveInput)
      .handler(({ context, input }) => removePassportEntry(context.principal, input, context.meta)),
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
  // M12: /admin/system (plan §3.1 "Наблюдение"): counts, queue names and times only.
  system: {
    status: staffWithSecondFactor
      .route({
        method: 'GET',
        path: '/admin/system',
        summary: 'Job queue depth, failed jobs, failed e-mail deliveries and the time of the last local backup (staff with a verified second factor)',
      })
      .handler(({ context }) => systemStatus(context.principal)),
  },
};

export type Router = typeof router;
/** The router as a client sees it: the type src/lib/rpc-client gives the browser's client (M05). */
export type AppRouterClient = RouterClient<Router>;
