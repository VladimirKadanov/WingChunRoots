// A minimum answer time for the endpoints whose work depends on whether an address has an account
// (milestone M02 fix round 3, security-2). Their answers are the same for every address, but the
// time was not: a sign-up for a fresh address creates the account, its consents and the e-mail; a
// reset for an existing address stores a token and queues the e-mail; a sign-in with the right
// password of an unconfirmed account sends a new confirmation link before it is refused like a
// wrong password (security-1). Better Auth keeps such a floor for /send-verification-email
// (500 ms); dispatchAuth() (route.ts) applies these to every path in, the forms and the HTTP API.
//
// Only the answers that could tell something wait: an accepted sign-up or reset request, and a
// refused sign-in. A successful sign-in (the caller knows the password) and the refusals that do
// not depend on the address (a missing tick, a malformed address, a rate limit) answer at once.
// A floor hides a difference only while every branch finishes under it; the values leave room
// above the slowest branch measured (a fresh sign-up, about 300 ms on a cloud session).

export interface AnswerFloor {
  ms: number;
  /** The statuses whose answers wait. */
  applies: (status: number) => boolean;
}

const accepted = (status: number) => status >= 200 && status < 300;

export const ANSWER_FLOORS: Readonly<Record<string, AnswerFloor>> = {
  '/sign-up/email': { ms: 800, applies: accepted },
  '/request-password-reset': { ms: 500, applies: accepted },
  '/sign-in/email': { ms: 500, applies: (status) => status === 401 },
};

/** How long an answer of `status` from the Better Auth endpoint `path` takes at least, in ms. */
export function answerFloorMs(path: string, status: number): number {
  const floor = ANSWER_FLOORS[path];
  return floor && floor.applies(status) ? floor.ms : 0;
}

/** Waits until `floorMs` have passed since `startedAt` (performance.now() time). */
export async function waitForFloor(floorMs: number, startedAt: number, now: () => number = () => performance.now()): Promise<void> {
  const remaining = floorMs - (now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
