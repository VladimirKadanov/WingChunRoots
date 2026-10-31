// The fixed form ids of the teacher-request pages for a page that shows the outcome of a post
// without JavaScript: the outcome address opens the page at that form's message (`anchor` in
// src/server/forms/flash.ts). Otherwise the forms use useFormId(), since a page kept hidden by the
// router can be in the document twice.

/** The request form of /dashboard/teachers/new (a new request, or a declined one sent again). */
export const REQUEST_FORM = 'teacher-request';
/** The names under which a row's kept result is read back (readFormResult), and one row's forms. */
export const WITHDRAW_FORM = 'withdraw-request';
export const END_FORM = 'end-training';
export const withdrawForm = (relationshipId: string) => `withdraw-${relationshipId}`;
export const endForm = (relationshipId: string) => `end-${relationshipId}`;
