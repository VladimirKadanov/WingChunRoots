// The words of the review queue and of historical claims (milestone M10a; plan §5.6, §6.7):
// the labels of case kinds and statuses, and what the claimant reads about their claim. English
// only, and only here (CLAUDE.md §2). Neutral by design: a refusal asks for better evidence and
// never judges the student (plan §5.6).

import type { REVIEW_CASE_KINDS, REVIEW_CASE_STATUSES } from '../db/schema/common';

export type ReviewCaseKind = (typeof REVIEW_CASE_KINDS)[number];
export type ReviewCaseStatus = (typeof REVIEW_CASE_STATUSES)[number];

export const REVIEW_KIND_LABELS: Record<ReviewCaseKind, string> = {
  historical_claim: 'Historical teacher',
  person_claim: 'Profile claim',
  instructor_verification: 'Instructor verification',
  relationship_dispute: 'Relationship dispute',
  profile_report: 'Profile report',
  school_listing: 'School listing',
  deletion_request: 'Account deletion',
};

/** The status of a case as the reviewers read it. */
export const REVIEW_STATUS_LABELS: Record<ReviewCaseStatus, string> = {
  open: 'Open',
  in_review: 'In review',
  needs_info: 'Needs information',
  resolved: 'Decided',
  dismissed: 'Closed',
};

/** The status of a claim as the claimant reads it on My teachers. */
export const CLAIM_STATUS_LABELS: Record<ReviewCaseStatus, string> = {
  open: 'Waiting for a reviewer',
  in_review: 'A reviewer is checking the evidence',
  needs_info: 'The reviewers asked for more information',
  resolved: 'Decided',
  dismissed: 'Closed',
};

/** What the claimant reads when the reviewers did not confirm the training. */
export const CLAIM_REFUSED_TEXT = 'The reviewers could not confirm this training from the evidence sent.';
