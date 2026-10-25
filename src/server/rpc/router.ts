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
import { listNotifications, markNotificationsRead, markReadInput } from '../services/notifications';
import { myPlan, planCatalog, requestPilotAccess, requestPilotAccessInput, setAccountType, setAccountTypeInput } from '../services/plans';
import { setRoleInput, setUserRole } from '../services/roles';
import { twoFactorOverview } from '../services/two-factor';
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
      throw new ORPCError(error.code, {
        status: error.status,
        message: error.message,
        data: Object.keys(error.fields).length > 0 ? { fields: error.fields } : undefined,
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
  },
  consent: {
    record: signedIn
      .route({ method: 'POST', path: '/consent/record', summary: 'Record consents for the current document versions' })
      .input(recordConsentsInput)
      .handler(({ context, input }) => recordConsents(context.principal, input, context.meta)),
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
  dashboard: {
    overview: base
      .route({ method: 'GET', path: '/dashboard', summary: "The signed-in account's dashboard: teachers, requests, schools, allowance, notifications" })
      .handler(({ context }) => dashboardOverview(context.principal)),
  },
};

export type Router = typeof router;
/** The router as a client sees it: the type src/lib/rpc-client gives the browser's client (M05). */
export type AppRouterClient = RouterClient<Router>;
