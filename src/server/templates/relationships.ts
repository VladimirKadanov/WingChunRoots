// The words of teacher requests (milestone M09; plan §6.7): the neutral reasons a teacher can give
// when declining a request, shown to the teacher in the form and to the student in the notification
// and the e-mail. English only, and only here (CLAUDE.md §2). Neutral by design: they ask for a
// correction and never judge the student (plan §5.6).

export const REJECTION_REASONS = {
  dates: 'The training dates need correcting.',
  lineage: 'The lineage needs correcting.',
  details: 'Some details need correcting. Check the request and send it again.',
  cannot_confirm: 'I can’t confirm this training from the request as it was sent.',
} as const;

export type RejectionReason = keyof typeof REJECTION_REASONS;
export const REJECTION_REASON_CODES = Object.keys(REJECTION_REASONS) as RejectionReason[];

export function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === 'string' && Object.hasOwn(REJECTION_REASONS, value);
}

/** The text of a stored reason; an unknown one (never written) reads as the general correction. */
export function rejectionReasonText(code: string | null | undefined): string {
  return isRejectionReason(code) ? REJECTION_REASONS[code] : REJECTION_REASONS.details;
}
