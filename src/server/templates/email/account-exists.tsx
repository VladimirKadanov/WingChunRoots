// "account-exists" (milestone M02 fix round 1): sent when someone signs up with the address of a
// confirmed account. The sign-up form answers exactly as for a new address (no account
// enumeration), so this e-mail is how the owner learns what happened. No token: plain links to
// sign in and to ask for a new password.

import { Button, Link, Text } from 'react-email';

import { EmailLayout, PersonName, textStyle } from './components';
import { type EmailTemplate, type NameData, parseAppUrl, parseObject, parseOptionalNames } from './types';

export interface AccountExistsData {
  /** APP_URL/sign-in */
  signInUrl: string;
  /** APP_URL/reset-password */
  resetUrl: string;
  recipientNames?: NameData[];
}

const NAME = 'account-exists';
const preview = () => 'Someone tried to sign up with your address. You already have an account.';

const buttonStyle = {
  backgroundColor: '#1f2328',
  borderRadius: '4px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '16px',
  fontWeight: 600,
  lineHeight: '24px',
  padding: '12px 20px',
  textDecoration: 'none',
} as const;

const linkStyle = { color: '#0b57d0' } as const;

export const accountExists: EmailTemplate<AccountExistsData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      signInUrl: parseAppUrl(NAME, 'signInUrl', object.signInUrl, '/sign-in'),
      resetUrl: parseAppUrl(NAME, 'resetUrl', object.resetUrl, '/reset-password'),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: () => 'You already have a WingChunRoots account',
  preview,
  render({ signInUrl, resetUrl, recipientNames = [] }) {
    return (
      <EmailLayout preview={preview()}>
        <Text style={textStyle}>
          {recipientNames.length > 0 ? (
            <>
              Hello <PersonName names={recipientNames} />,
            </>
          ) : (
            'Hello,'
          )}
        </Text>
        <Text style={textStyle}>
          Someone, hopefully you, tried to create a WingChunRoots account with this e-mail address. You already have an
          account, so nothing was changed.
        </Text>
        <Button href={signInUrl} style={buttonStyle}>
          Sign in
        </Button>
        <Text style={{ ...textStyle, marginTop: '16px' }}>
          Forgot your password?{' '}
          <Link href={resetUrl} style={linkStyle}>
            Ask for a link to choose a new one
          </Link>
          .
        </Text>
        <Text style={textStyle}>If this was not you, ignore this e-mail: your account and your password stay the same.</Text>
      </EmailLayout>
    );
  },
  // Fictional (D20).
  sample: {
    signInUrl: 'http://localhost:3000/sign-in',
    resetUrl: 'http://localhost:3000/reset-password',
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
