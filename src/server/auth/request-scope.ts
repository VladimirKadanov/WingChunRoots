// What one request to Better Auth carries between the hooks and the callbacks (milestone M02 fix
// round 2). Every request goes through runAuthRequest() (route.ts for /api/auth, endpoint.ts for
// the Server Actions), which gives it a scope of its own in an AsyncLocalStorage:
//
// - Open reservations. The before hook reserves an attempt before Better Auth checks a password or
//   a code (throttle.ts) and the after hook settles it. When the after hook never runs (an
//   unexpected error inside the endpoint, a plugin's before hook that refuses the request), the
//   reservation is given back here when the request ends, so a failure that checked nothing
//   counts for nothing.
// - The throttle key of the request's password attempt, worked out once by the before hook, so
//   the after hook settles the very key it reserved (a password change in between changes the
//   known-browser key; known-devices.ts).
// - The account whose password a sign-up matched (the before hook) for onExistingUserSignUp
//   (accounts.ts), which Better Auth calls only after the request passed its own checks.
// - The address whose password the request reset (onPasswordReset) for the after hook.
//
// Outside runAuthRequest() (a direct `auth.api.*` call) there is no scope: nothing is held, and
// the hooks fall back to what they can work out on their own.
//
// The storage is one per process, on globalThis like the Better Auth instance (config.ts). The
// bundler copies this module into several server chunks (the /api/auth route, the Server Actions of
// each page), and a module-level AsyncLocalStorage would then be one per copy: the instance's hooks,
// created from whichever chunk asked first, would never see the scope that runAuthRequest() of
// another chunk set, and every path but the first would lose its reservations, the double-tap mark
// and the reset address (fix round 3; e2e/m02-auth.spec.ts tests both paths).

import { AsyncLocalStorage } from 'node:async_hooks';

import { logAuth } from './logger';

interface Held {
  key: string;
  giveBack: () => Promise<void>;
}

export interface RequestScope {
  /** Reservations of the before hook that the after hook has not settled yet, by name. */
  open: Map<string, Held>;
  /** The account a sign-up's password matched: unconfirmed, the same password (hooks.ts). */
  samePasswordUserId?: string;
  /** The address whose password this request reset. */
  resetEmail?: string;
}

const globalScope = globalThis as unknown as { __wcrAuthScope?: AsyncLocalStorage<RequestScope> };
const storage = (globalScope.__wcrAuthScope ??= new AsyncLocalStorage<RequestScope>());

/** The scope of the request being handled, if it came through runAuthRequest(). */
export function requestScope(): RequestScope | undefined {
  return storage.getStore();
}

/** Runs one Better Auth request in a scope of its own; gives back what is left open at its end. */
export async function runAuthRequest<T>(run: () => Promise<T>): Promise<T> {
  const scope: RequestScope = { open: new Map() };
  try {
    return await storage.run(scope, run);
  } finally {
    for (const [name, held] of scope.open) {
      await held.giveBack().catch((error: unknown) => logAuth('error', `could not give back the ${name} reservation`, error));
    }
    scope.open.clear();
  }
}

/** Keeps a reservation open until settle() takes it; `giveBack` runs when the request ends first. */
export function hold(name: string, key: string, giveBack: () => Promise<void>): void {
  storage.getStore()?.open.set(name, { key, giveBack });
}

/**
 * Takes the reservation `name` for the after hook to settle: its key, null when the request holds
 * none, or undefined outside a scope (the caller works the key out itself).
 */
export function settle(name: string): string | null | undefined {
  const scope = storage.getStore();
  if (!scope) return undefined;
  const held = scope.open.get(name);
  scope.open.delete(name);
  return held?.key ?? null;
}
