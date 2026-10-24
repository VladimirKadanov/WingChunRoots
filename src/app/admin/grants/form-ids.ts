// The fixed form ids of /admin/grants for a page that shows the outcome of a post without
// JavaScript: the outcome address opens the page at that form's error or message (`anchor` in
// src/server/forms/flash.ts, M08 review round 1, a11y-webview-1). Otherwise the forms use
// useFormId(), since a page kept hidden by the router can be in the document twice.

export const CREATE_GRANT_FORM = 'create-grant';
export const revokeGrantForm = (grantId: string) => `revoke-grant-${grantId}`;
/** A pilot request's "Close request…" form (M08 review round 2, recheck-5), and the section's message after it closed. */
export const closeRequestForm = (requestId: string) => `close-request-${requestId}`;
export const CLOSED_REQUEST_MESSAGE = 'closed-request';
