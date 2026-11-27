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
  /** Journey review P2-4 (ADR 0081): the link confirms a new address of an existing account. */
  newAddress?: boolean;
}

const NAME = 'verify-email';
const preview = (newAddress = false) =>
  newAddress
    ? 'Confirm this address to make it the one you sign in to WingChunRoots with.'
    : 'Confirm your e-mail address to finish creating your WingChunRoots account.';

export const verifyEmail: EmailTemplate<VerifyEmailData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      url: parseActionUrl(NAME, 'url', object.url, '/verify-email'),
      expiresInHours: parseHours(NAME, 'expiresInHours', object.expiresInHours),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
      ...(object.newAddress === true ? { newAddress: true } : {}),
    };
  },
  subject: ({ newAddress }) => (newAddress ? 'Confirm your new e-mail address for WingChunRoots' : 'Confirm your e-mail address for WingChunRoots'),
  preview: ({ newAddress }) => preview(newAddress),
  render({ url, expiresInHours, recipientNames = [], newAddress = false }) {
    if (newAddress) {
      return (
        <AccountLinkEmail
          preview={preview(true)}
          recipientNames={recipientNames}
          intro="Someone, hopefully you, asked to sign in to a WingChunRoots account with this e-mail address from now on. Confirm the address to make the change; until then the old address stays the one you sign in with."
          action="Confirm new e-mail address"
          url={url}
          expiresInHours={expiresInHours}
          notExpected="If you did not ask for this, ignore this e-mail: nothing changes unless the link is used."
        />
      );
    }
    return (
      <AccountLinkEmail
        preview={preview()}
        recipientNames={recipientNames}
        intro="Someone, hopefully you, created a WingChunRoots account with this e-mail address. Confirm the address to sign in."
        action="Confirm e-mail address"
        url={url}
        expiresInHours={expiresInHours}
        notExpected="If you did not create an account, ignore this e-mail: nobody can sign in to an unconfirmed account, and it is removed after 7 days."
      />
    );
  },
  secretFields: ['url'],
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
