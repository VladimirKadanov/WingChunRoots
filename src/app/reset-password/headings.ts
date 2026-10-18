// The headings of /reset-password (milestone M02), shared by the page (a submit without
// JavaScript) and its forms (with JavaScript), so both say the same.

import type { FrameHeading } from '@/components/account/auth-frame';
import type { FormState } from '@/lib/form-state';

export const REQUEST: FrameHeading = {
  eyebrow: 'Forgot your password',
  title: 'Reset your password',
  lede: 'Enter the address of your account. We send a link to choose a new password.',
};

export const NEW_PASSWORD: FrameHeading = {
  eyebrow: 'Reset your password',
  title: 'Choose a new password',
  lede: 'Saving it signs your account out on every device. Two-factor authentication stays on.',
};

export const FINISH: FrameHeading = {
  eyebrow: 'Join the pilot',
  title: 'Finish signing up',
  lede: 'Choose the password for your account. Saving it also confirms your address.',
};

/** The heading of a refused link (isRefusedLink), with the action's message as its lede. */
export function linkRefused(state: FormState): FrameHeading {
  return {
    eyebrow: 'Reset your password',
    title: 'This link no longer works',
    lede: state.message ?? 'Reset links work once, for one hour. Ask for a new one below.',
  };
}
