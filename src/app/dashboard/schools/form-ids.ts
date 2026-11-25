// The fixed form ids of the school pages in the dashboard (milestone M11), for a post without
// JavaScript: the outcome address opens the page at that form's message (`anchor` in
// src/server/forms/flash.ts).

/** The school form of /dashboard/schools/new and /dashboard/schools/<id>. */
export const SCHOOL_FORM = 'school';
/** The listing's one-button forms: "Send for review" and "This listing is current". */
export const SCHOOL_ACTION_FORM = 'school-listing';
/** The same forms in a list of schools, one per school (Your schools, the dashboard home). */
export const listingForm = (schoolId: string) => `school-listing-${schoolId}`;
/** The lists a listing form can come back to, by name (never an address from the form). */
export const LISTING_BACK = { schools: '/dashboard/schools', home: '/dashboard' } as const;
export type ListingBack = keyof typeof LISTING_BACK;

/** M21: the schedule and fees form of /dashboard/schools/<id>/schedule. */
export const SCHEDULE_FORM = 'school-schedule';
/** M21: the form of one trial lesson request in /dashboard/schools/<id>/inquiries (answer, decline, close). */
export const trialForm = (inquiryId: string) => `trial-${inquiryId}`;
