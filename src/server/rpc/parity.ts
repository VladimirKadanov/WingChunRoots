// Server Action ↔ API mapping (plan §6.8; milestone M02, In scope 3). Every Server Action of the
// app is a thin wrapper over either oRPC procedures (the account data: /api/rpc and /api/v1) or
// Better Auth endpoints (signing up and in, e-mail confirmation, password reset, two-factor
// authentication: /api/auth, cookie or bearer), or both (sign-in, then account.landing for where
// to go next). A native client therefore reaches everything a web form does. api-parity.test.ts
// checks this table against the code: every exported Server Action is listed, every target exists
// and is served, and the action itself (or a helper of its file that it calls) calls it.

/** The procedures (`rpc`) and Better Auth endpoints (`auth`) an action wraps; at least one. */
export type ActionTarget = { rpc?: readonly string[]; auth?: readonly string[] };

/** `<file>#<exported function>` → what it wraps. */
export const SERVER_ACTION_TARGETS: Readonly<Record<string, ActionTarget>> = {
  'src/app/sign-up/actions.ts#signUpAction': { auth: ['/sign-up/email'] },
  'src/app/sign-in/actions.ts#signInAction': { auth: ['/sign-in/email'], rpc: ['account.landing'] },
  'src/app/sign-in/actions.ts#verifySecondFactorAction': {
    auth: ['/two-factor/verify-totp', '/two-factor/verify-backup-code'],
    rpc: ['account.landing'],
  },
  'src/app/verify-email/actions.ts#confirmEmailAction': { auth: ['/verify-email'] },
  'src/app/verify-email/actions.ts#resendConfirmationAction': { auth: ['/send-verification-email'] },
  'src/app/reset-password/actions.ts#requestResetAction': { auth: ['/request-password-reset'] },
  'src/app/reset-password/actions.ts#resetPasswordAction': { auth: ['/reset-password'] },
  'src/app/account/actions.ts#signOutAction': { auth: ['/sign-out'] },
  'src/app/account/security/actions.ts#enableTwoFactorAction': { auth: ['/two-factor/enable'] },
  'src/app/account/security/actions.ts#confirmTwoFactorAction': { auth: ['/two-factor/verify-totp', '/two-factor/verify-backup-code'] },
  'src/app/account/security/actions.ts#verifySessionAction': { auth: ['/two-factor/verify-totp', '/two-factor/verify-backup-code'] },
  'src/app/account/security/actions.ts#newBackupCodesAction': { auth: ['/two-factor/generate-backup-codes'] },
  'src/app/account/security/actions.ts#disableTwoFactorAction': { auth: ['/two-factor/disable'] },
  'src/app/onboarding/actions.ts#onboardAction': { rpc: ['consent.record', 'account.onboard'] },
  'src/app/onboarding/actions.ts#confirmConsentsAction': { rpc: ['consent.record'] },
  // M08: plans, test plans and notifications.
  'src/app/dashboard/actions.ts#markReadAction': { rpc: ['notifications.markRead'] },
  'src/app/dashboard/actions.ts#requestPilotAccessAction': { rpc: ['plans.requestPilotAccess'] },
  'src/app/dashboard/settings/actions.ts#setAccountTypeAction': { rpc: ['account.setType'] },
  'src/app/admin/grants/actions.ts#createGrantAction': { rpc: ['grants.create'] },
  'src/app/admin/grants/actions.ts#revokeGrantAction': { rpc: ['grants.revoke'] },
  'src/app/admin/grants/actions.ts#closeRequestAction': { rpc: ['grants.closeRequest'] },
  // M07: the profile editor, consents and account deletion.
  'src/app/dashboard/profile/actions.ts#saveProfileAction': { rpc: ['profile.update'] },
  'src/app/account/privacy/actions.ts#withdrawConsentAction': { rpc: ['consent.withdraw'] },
  'src/app/account/privacy/actions.ts#requestDeletionAction': { rpc: ['account.requestDeletion'] },
  // M09: teacher requests and independent approvals.
  'src/app/dashboard/teachers/actions.ts#requestTeacherAction': { rpc: ['relationships.request'] },
  'src/app/dashboard/teachers/actions.ts#resubmitRequestAction': { rpc: ['relationships.resubmit'] },
  'src/app/dashboard/teachers/actions.ts#withdrawRequestAction': { rpc: ['relationships.withdraw'] },
  'src/app/dashboard/teachers/actions.ts#endTrainingAction': { rpc: ['relationships.end'] },
  'src/app/dashboard/students/requests/actions.ts#approveRequestAction': { rpc: ['relationships.approve'] },
  'src/app/dashboard/students/requests/actions.ts#rejectRequestAction': { rpc: ['relationships.reject'] },
  // M10a: historical teachers, evidence and the review queue.
  'src/app/dashboard/teachers/historical/actions.ts#requestHistoricalAction': { rpc: ['relationships.requestHistorical'] },
  'src/app/dashboard/teachers/historical/actions.ts#discardEvidenceAction': { rpc: ['evidence.discard'] },
  'src/app/admin/review/actions.ts#assignCaseAction': { rpc: ['review.assign'] },
  'src/app/admin/review/actions.ts#decideCaseAction': { rpc: ['review.decide'] },
  'src/app/admin/review/actions.ts#addNoteAction': { rpc: ['review.note'] },
  'src/app/admin/review/actions.ts#archiveUpdateAction': { rpc: ['archive.update'] },
  // M11: schools and their listing.
  'src/app/dashboard/schools/actions.ts#createSchoolAction': { rpc: ['schools.create'] },
  'src/app/dashboard/schools/actions.ts#updateSchoolAction': { rpc: ['schools.update'] },
  'src/app/dashboard/schools/actions.ts#submitSchoolAction': { rpc: ['schools.submit'] },
  'src/app/dashboard/schools/actions.ts#confirmSchoolAction': { rpc: ['schools.confirm'] },
};
