// The fixed form ids of the review queue for a post without JavaScript: the outcome address opens
// the page at that form's message (src/server/forms/flash.ts).

export const ASSIGN_FORM = 'review-assign';
/** One form per decision: `${DECIDE_FORM}-verify`, `-reject`, `-needs_info`. */
export const DECIDE_FORM = 'review-decide';
export const NOTE_FORM = 'review-note';
export const ARCHIVE_FORM = 'archive-edit';
