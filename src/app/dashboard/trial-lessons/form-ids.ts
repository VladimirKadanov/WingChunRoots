// The fixed form ids of /dashboard/trial-lessons (review 2026-11), for a post without JavaScript: the
// outcome address opens the page at that form's message (`anchor` in src/server/forms/flash.ts).

/** The "Withdraw request" form of one trial lesson request. */
export const withdrawForm = (inquiryId: string) => `trial-withdraw-${inquiryId}`;
