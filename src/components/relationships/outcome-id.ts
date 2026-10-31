// The id of the outcome note of the teacher-request pages (OutcomeNote, ./parts.tsx). A plain
// module, so the Server Actions read it too: each success redirect ends with `#${OUTCOME_ID}` (M09
// review, screens-1), which opens the page at the note, never at a section below it.

export const OUTCOME_ID = 'outcome';

/** The address of `page` (a path with its query) opened at the outcome note. */
export const atOutcome = (page: string) => `${page}#${OUTCOME_ID}`;
