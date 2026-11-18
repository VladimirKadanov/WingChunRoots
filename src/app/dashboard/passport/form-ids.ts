// The fixed form ids of /dashboard/passport (milestone M19), for a post without JavaScript: the
// outcome address opens the page at that form's message (src/server/forms/flash.ts).

/** "Make private" / "Make public" of an entry. */
export const PASSPORT_VISIBILITY_FORM = 'passport-visibility';
/** "Propose a correction" of an entry a teacher recorded. */
export const PASSPORT_CORRECTION_FORM = 'passport-correction';
/** "Ask the organizer to confirm" an event the student attended (ADR 0046). */
export const PASSPORT_CLAIM_FORM = 'passport-claim';
/** "Take back the request" of a claim that waits for the organizer (ADR 0046). */
export const PASSPORT_CLAIM_WITHDRAW_FORM = 'passport-claim-withdraw';
