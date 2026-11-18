// The words of the plain choice a verify of a claim about a teacher with an unknown life status asks
// for (review 2026-11-14, docs/adr/0031-consent-and-living-gates.md). They live here, in a module
// only the server page imports, and reach the form as props: the review routes sit at their
// JavaScript budget (scripts/check-bundle-budget.mjs), and text in a client component is JavaScript.

import type { AdminT } from '@/components/admin/i18n/translate';

export interface LifeStatusChoiceText {
  legend: string;
  intro: string;
  options: readonly { value: 'established' | 'not_established'; label: string; text: string }[];
  reasonRequiredHint: string;
  reasonOptionalHint: string;
}

export const lifeStatusChoice = (t: AdminT): LifeStatusChoiceText => ({
  legend: t('The teacher’s life status is not known'),
  intro: t('A person whose status is not known is treated as living and is never shown publicly. Choose one to verify.'),
  options: [
    {
      value: 'established',
      label: t('The evidence shows this person is deceased'),
      text: t('The record is marked deceased with your reason and is shown publicly once both people of the link have chosen to be public.'),
    },
    {
      value: 'not_established',
      label: t('I cannot establish this'),
      text: t('The claim can still be verified. The record stays hidden, treated as a living person, until someone with the evidence marks it deceased.'),
    },
  ],
  reasonRequiredHint: t(
    'Required. Say what the evidence shows and where to find it (a file on this case, a source). Kept with the case and in the audit log; the claimant is not shown it.',
  ),
  reasonOptionalHint: t('Optional here. Kept with the case for the reviewers; the claimant is told the claim was confirmed.'),
});
