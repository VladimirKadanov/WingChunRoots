// "reset-password" (milestone M02): the link to choose a new password. Sent only to an existing
// account; the request form answers the same way for unknown addresses.

import { AccountLinkEmail } from './account-link';
import { type EmailTemplate, type NameData, parseActionUrl, parseHours, parseObject, parseOptionalNames } from './types';

export interface ResetPasswordData {
  /** APP_URL/reset-password?token=... */
  url: string;
  expiresInHours: number;
  /** The recipient's names, when the account has a profile. */
  recipientNames?: NameData[];
}

const NAME = 'reset-password';
const preview = () => 'Choose a new password for your WingChunRoots account.';

export const resetPassword: EmailTemplate<ResetPasswordData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      url: parseActionUrl(NAME, 'url', object.url, '/reset-password'),
      expiresInHours: parseHours(NAME, 'expiresInHours', object.expiresInHours),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: () => 'Reset your WingChunRoots password',
  preview,
  render({ url, expiresInHours, recipientNames = [] }) {
    return (
      <AccountLinkEmail
        preview={preview()}
        recipientNames={recipientNames}
        intro="We received a request to reset the password of your WingChunRoots account. Choose a new password with the button below. Every device that is signed in to your account will be signed out."
        action="Choose a new password"
        url={url}
        expiresInHours={expiresInHours}
        notExpected="If you did not ask for this, ignore this e-mail; your password stays the same."
      />
    );
  },
  // Fictional (D20).
  sample: {
    url: 'http://localhost:3000/reset-password?token=demo-token',
    expiresInHours: 1,
    recipientNames: [
      { value: 'Demo Student', lang: 'en' },
      { value: '示範學生', lang: 'zh-Hant' },
    ],
  },
};
