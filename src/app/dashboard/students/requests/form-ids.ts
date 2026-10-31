// The fixed form ids of /dashboard/students/requests for a page that shows the outcome of a post
// without JavaScript: the outcome address opens the page at that row's message (`anchor` in
// src/server/forms/flash.ts). Otherwise the rows use useFormId(), since a page kept hidden by the
// router can be in the document twice.

/** The names under which a kept result is read back (readFormResult). */
export const APPROVE_FORM = 'approve-request';
export const REJECT_FORM = 'reject-request';
/** One row's forms. */
export const approveForm = (relationshipId: string) => `approve-${relationshipId}`;
export const rejectForm = (relationshipId: string) => `reject-${relationshipId}`;
