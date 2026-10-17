// "verify-email" (milestone M02): the link that confirms the e-mail address of a new account.
// Better Auth creates the token; src/server/auth/emails.ts builds the link to /verify-email, whose
// page confirms only after a button press (link scanners in mail systems only GET the page).

import { AccountLinkEmail } from './account-link';
import { type EmailTemplate, type NameData, parseActionUrl, parseHours, parseObject, parseOptionalNames } from './types';

export interface VerifyEmailData {
  /** APP_URL/verify-email?token=... */
  url: string;
  expiresInHours: number;
  /** The recipient's names, when the account already has a profile. */
  recipientNames?: NameData[];
}

const NAME = 'verify-email';
const preview = () => 'Confirm your e-mail address to finish creating your WingChunRoots account.';

export const verifyEmail: EmailTemplate<VerifyEmailData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      url: parseActionUrl(NAME, 'url', object.url, '/verify-email'),
      expiresInHours: parseHours(NAME, 'expiresInHours', object.expiresInHours),
      recipientNames: parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: () => 'Confirm your e-mail address for WingChunRoots',
  preview,
  render({ url, expiresInHours, recipientNames = [] }) {
    return (
      <AccountLinkEmail
        preview={preview()}
        recipientNames={recipientNames}
        intro="Someone, hopefully you, created a WingChunRoots account with this e-mail address. Confirm the address to sign in."
        action="Confirm e-mail address"
        url={url}
        expiresInHours={expiresInHours}
        notExpected="If you did not create an account, ignore this e-mail; the account stays unconfirmed and nobody can sign in to it."
      />
    );
  },
  // Fictional (D20).
  sample: {
    url: 'http://localhost:3000/verify-email?token=demo-token',
    expiresInHours: 24,
    recipientNames: [
      { value: 'Demo Student', lang: 'en' },
      { value: '示範學生', lang: 'zh-Hant' },
    ],
  },
};
