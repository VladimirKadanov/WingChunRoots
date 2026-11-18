// The words of /admin/organizations and /admin/organizations/<id> that come from the services, in
// the control panel's language (docs/adr/0043-admin-bulgarian.md): each known label by its English
// text, as a t() call so the Bulgarian check sees it; anything else stays as the service wrote it.

import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import type { AdminT } from '@/components/admin/i18n/translate';

/** The kind and the approval (organizations.ts ORGANIZATION_KIND_LABELS, APPROVAL_LABELS). */
export function serviceLabel(t: AdminT, label: string): string {
  switch (label) {
    case 'Federation': return t('Federation');
    case 'Association': return t('Association');
    case 'Group of schools': return t('Group of schools');
    case 'Waiting for review': return t('Waiting for review');
    case 'Approved': return t('Approved');
    case 'Declined': return t('Declined');
    case 'Suspended': return t('Suspended');
    default: return label;
  }
}

/** ORGANIZATION_LOAD_ERRORS.admin, in the control panel's language. */
export function organizationLoadError(t: AdminT) {
  return {
    eyebrow: t('Administration'),
    title: t('Organizations'),
    message: t("We couldn't load the organizations. Nothing was changed."),
    back: { href: ORGANIZATION_LOAD_ERRORS.admin.back.href, label: t('Back to administration') },
  };
}

/** A plan's label (organization-grants.ts planOf): "No plan", or the plan's name, a product name kept as it is. */
export function planLabel(t: AdminT, label: string): string {
  return label === 'No plan' ? t('No plan') : label;
}

/** A grant's source and state (organization-grants.ts SOURCE_LABELS, STATE_LABELS). */
export function grantLabel(t: AdminT, label: string): string {
  switch (label) {
    case 'Test plan': return t('Test plan');
    case 'Complimentary': return t('Complimentary');
    case 'Payment': return t('Payment');
    case 'Active': return t('Active');
    case 'Starts later': return t('Starts later');
    case 'Ended': return t('Ended');
    case 'Revoked': return t('Revoked');
    default: return label;
  }
}

/** A Federation trial's status (billing.ts TRIAL_STATUS_LABELS). */
export function trialStatusLabel(t: AdminT, label: string): string {
  switch (label) {
    case 'Trial running': return t('Trial running');
    case 'Continued as a subscription': return t('Continued as a subscription');
    case 'Trial ended': return t('Trial ended');
    case 'Trial ended early': return t('Trial ended early');
    default: return label;
  }
}

/** A trial's summary, as billing.ts trialView writes it, from its status and dates. */
export function trialSummary(t: AdminT, trial: { status: string; endsAt: string; endedAt: string | null; summary: string }): string {
  switch (trial.status) {
    case 'active':
      return t('The trial runs until {date} with no card and no charge. To continue after that, choose monthly or yearly billing; if you do nothing, the trial simply ends and nothing is deleted.', { date: t.day(trial.endsAt) });
    case 'converted':
      return trial.endedAt ? t('The organization subscribed during the trial on {date}; the first payment is due when the trial period ends.', { date: t.day(trial.endedAt) }) : trial.summary;
    case 'ended':
      return t('The trial ended on {date} without a subscription. Nothing was charged, and the members, school links and history are kept.', { date: t.day(trial.endsAt) });
    case 'revoked':
      return trial.endedAt ? t('An administrator ended the trial on {date}. Nothing was charged, and the members, school links and history are kept.', { date: t.day(trial.endedAt) }) : trial.summary;
    default:
      return trial.summary;
  }
}

/**
 * A message of the services behind these pages and their forms (organization-grants.ts,
 * federation-trials.ts, the grant and trial refusals), by its English text; anything else (an
 * unknown message) through t() as it is.
 */
export function serviceMessage(t: AdminT, message: string): string {
  switch (message) {
    case 'No such organization.': return t('No such organization.');
    case 'No such plan grant.': return t('No such plan grant.');
    case 'No such trial.': return t('No such trial.');
    case 'Choose a plan.': return t('Choose a plan.');
    case 'Choose a plan grant.': return t('Choose a plan grant.');
    case 'Choose test plan or complimentary.': return t('Choose test plan or complimentary.');
    case 'Give a reason; it is kept in the audit log.': return t('Give a reason; it is kept in the audit log.');
    case 'Keep the reason under 500 characters.': return t('Keep the reason under 500 characters.');
    case 'Choose 6 or 12 months.': return t('Choose 6 or 12 months.');
    case 'Check the highlighted fields.': return t('Check the highlighted fields.');
    case 'Enter the start as a date, for example 2026-11-01.': return t('Enter the start as a date, for example 2026-11-01.');
    case 'The start cannot be before today.': return t('The start cannot be before today.');
    case 'Choose a date within the next two years.': return t('Choose a date within the next two years.');
    case 'Enter the end as a date, for example 2026-12-31.': return t('Enter the end as a date, for example 2026-12-31.');
    case 'The end must be after the start.': return t('The end must be after the start.');
    case 'A plan is given to an approved organization. Approval is decided in the review queue.': return t('A plan is given to an approved organization. Approval is decided in the review queue.');
    case 'The organization holds Federation already. Revoke that grant first to give it for other dates.': return t('The organization holds Federation already. Revoke that grant first to give it for other dates.');
    case 'This plan was already revoked.': return t('This plan was already revoked.');
    case 'This plan has already ended.': return t('This plan has already ended.');
    case 'A trial is given to an approved organization. Approval is decided in the review queue.': return t('A trial is given to an approved organization. Approval is decided in the review queue.');
    case 'A Federation trial is for federations; this organization is registered as another kind.': return t('A Federation trial is for federations; this organization is registered as another kind.');
    case 'The organization has had its trial. An organization has one trial.': return t('The organization has had its trial. An organization has one trial.');
    case 'The organization pays for Federation already.': return t('The organization pays for Federation already.');
    case 'The organization holds Federation already. A trial is for an organization without it.': return t('The organization holds Federation already. A trial is for an organization without it.');
    case 'This trial is not running.': return t('This trial is not running.');
    case 'Something went wrong on our side; nothing was changed. Try again.': return t('Something went wrong on our side; nothing was changed. Try again.');
    default: return t(message);
  }
}
