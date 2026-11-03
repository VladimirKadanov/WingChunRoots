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
/** M10b: "Set in arbitration" (/admin/review/arbitrate/<relationship id>). */
export const ARBITRATE_FORM = 'review-arbitrate';
/** M14: "Remove photo" of a reported profile (photos.remove with a reason). */
export const PHOTO_REMOVE_FORM = 'review-photo-remove';
/** M16: "Remove photo" of a photo in the gallery of a reported profile (gallery.remove with a reason). */
export const GALLERY_REMOVE_FORM = 'review-gallery-remove';
/** M16: "Remove photo" of a school's logo or room photo, from its listing case (schoolPhotos.remove with a reason). */
export const SCHOOL_PHOTO_REMOVE_FORM = 'review-school-photo-remove';
