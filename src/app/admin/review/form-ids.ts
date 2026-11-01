// The fixed form ids of the review queue for a post without JavaScript: the outcome address opens
// the page at that form's message (src/server/forms/flash.ts).

export const ASSIGN_FORM = 'review-assign';
/**
 * One form per way of assigning (M10a review, screens-1): `self` ("Assign to me") is ASSIGN_FORM,
 * `none` ("Unassign") and `choose` (an administrator's "Assign") have their own, so a refusal comes
 * back to the form that was sent.
 */
export type AssignMode = 'self' | 'none' | 'choose';
export const assignForm = (mode: AssignMode) => (mode === 'self' ? ASSIGN_FORM : `${ASSIGN_FORM}-${mode}`);
/** One form per decision: `${DECIDE_FORM}-verify`, `-reject`, `-needs_info`. */
export const DECIDE_FORM = 'review-decide';
export const NOTE_FORM = 'review-note';
export const ARCHIVE_FORM = 'archive-edit';
