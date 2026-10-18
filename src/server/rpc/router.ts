// The oRPC router (plan §6.8; milestone M02, In scope 3): every read and every mutation of the
// account data is a procedure here, served at /api/rpc (the web) and /api/v1 (OpenAPI, the future
// native app). Procedures only adapt: the services check the principal and the input themselves.
// Server Actions call the same procedures through serverClient() (./server.ts), and
// api-parity.test.ts checks that every Server Action names its procedure.
//
// Sign-up, sign-in, e-mail confirmation, password reset and two-factor authentication are Better
// Auth's own HTTP API under /api/auth (cookie or bearer, docs/adr/0004-auth.md).

import { ORPCError, os, ValidationError } from '@orpc/server';

import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { accountOverview, landingInput, landingPath, onboard, onboardingOptions, onboardInput } from '../services/account';
import { adminOverview } from '../services/admin';
import { recordConsents, recordConsentsInput } from '../services/consent';
import type { RequestMeta } from '../services/context';
import { isServiceError } from '../services/errors';
import { setRoleInput, setUserRole } from '../services/roles';

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
    onboardingOptions: base
      .route({ method: 'GET', path: '/account/onboarding-options', summary: 'Countries, cities and scripts for onboarding' })
      .handler(({ context }) => onboardingOptions(context.principal)),
    onboard: signedIn
      .route({ method: 'POST', path: '/account/onboard', summary: "Create the account's own person (onboarding)" })
      .input(onboardInput)
      .handler(({ context, input }) => onboard(context.principal, input, context.meta)),
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
};

export type Router = typeof router;
