// The fixed form ids of the organization pages in the dashboard (milestone M15), for a post without
// JavaScript: the outcome address opens the page at that form's message (`anchor` in
// src/server/forms/flash.ts).

/** The application form of /dashboard/organization/apply. */
export const APPLY_FORM = 'organization-apply';
/** The details form of /dashboard/organization/<id> (the application while it waits, the details once approved). */
export const DETAILS_FORM = 'organization-details';
export const ADD_ADMIN_FORM = 'organization-add-admin';
export const ADD_MEMBER_FORM = 'organization-add-member';
export const REQUEST_SCHOOL_FORM = 'organization-request-school';
/** A row's one-button form (remove an admin, end a membership, end a school link). */
export const rowForm = (kind: 'admin' | 'member' | 'school', id: string) => `organization-${kind}-${id}`;
/** A school link's answer on /dashboard/schools (accept, refuse or end). */
export const linkForm = (id: string) => `organization-link-${id}`;
