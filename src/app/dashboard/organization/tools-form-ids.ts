// The fixed form ids of the organization tools (milestone M24), for a post without JavaScript: the
// outcome address opens the page at that form's message (`anchor` in src/server/forms/flash.ts).

/** The upload form of /dashboard/organization/<id>/import. */
export const IMPORT_FORM = 'organization-import';
/** The one-button forms of an import: commit or discard. */
export const importForm = (kind: 'commit' | 'discard', importId: string) => `organization-import-${kind}-${importId}`;
/** Withdraw one of the organization's teacher claims. */
export const claimForm = (claimId: string) => `organization-claim-${claimId}`;
/** Leave a membership (the account's own, on /dashboard/organization). */
export const leaveForm = (membershipId: string) => `organization-leave-${membershipId}`;
