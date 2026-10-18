// The headings of /verify-email (milestone M02), shared by the page (a submit without JavaScript)
// and its forms (with JavaScript), so both say the same.

import type { FrameHeading } from '@/components/account/auth-frame';
import type { FormState } from '@/lib/form-state';

const EYEBROW = 'Join the pilot';

/** "e-mail" never breaks at its hyphen in a heading. */
const TITLE = (
  <>
    Confirm your <span className="whitespace-nowrap">e-mail</span> address
  </>
);

/** The link from the e-mail: one press confirms (a mail scanner that opens links cannot). */
export const CONFIRM: FrameHeading = {
  eyebrow: EYEBROW,
  title: TITLE,
  lede: 'Press the button to confirm that this address is yours. Then sign in with your password.',
};

export const RESEND: FrameHeading = {
  eyebrow: EYEBROW,
  title: TITLE,
  lede: 'We sent a confirmation link when you created your account. It works for 24 hours. If it did not arrive or has run out, ask for a new one.',
};

/** The heading of a refused link (isRefusedLink), with the action's message as its lede. */
export function linkRefused(state: FormState): FrameHeading {
  return {
    eyebrow: EYEBROW,
    title: 'This link no longer works',
    lede: state.message ?? 'Confirmation links work for 24 hours. Ask for a new one below.',
  };
}
