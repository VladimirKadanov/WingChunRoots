// "finish-sign-up" (milestone M02 fix round 1): sent when someone signs up with an address whose
// account was never confirmed. The password of that account is wiped first, so whoever created it
// cannot use it; this link lets the owner of the address choose a password, which also confirms
// the address (src/server/auth/accounts.ts). It is a password-reset token under the hood.

import { AccountLinkEmail } from './account-link';
import { type EmailTemplate, type NameData, parseActionUrl, parseHours, parseObject, parseOptionalNames } from './types';

export interface FinishSignUpData {
  /** APP_URL/reset-password?token=...&finish=1 */
  url: string;
  expiresInHours: number;
  recipientNames?: NameData[];
}

const NAME = 'finish-sign-up';
const preview = () => 'Choose a password to finish creating your WingChunRoots account.';

export const finishSignUp: EmailTemplate<FinishSignUpData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      url: parseActionUrl(NAME, 'url', object.url, '/reset-password'),
      expiresInHours: parseHours(NAME, 'expiresInHours', object.expiresInHours),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: () => 'Finish creating your WingChunRoots account',
  preview,
  render({ url, expiresInHours, recipientNames = [] }) {
    return (
      <AccountLinkEmail
        preview={preview()}
        recipientNames={recipientNames}
        intro="Someone, hopefully you, signed up for WingChunRoots with this e-mail address, which already had an account that was never confirmed. So that only the owner of this address can use it, choose your password with the button below. This also confirms the address."
        action="Choose your password"
        url={url}
        expiresInHours={expiresInHours}
        notExpected="If you did not sign up, ignore this e-mail: nobody can sign in to the account, and it is removed after 7 days."
      />
    );
  },
  secretFields: ['url'],
  // Fictional (D20).
  sample: {
    url: 'http://localhost:3000/reset-password?token=demo-token&finish=1',
    expiresInHours: 1,
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
