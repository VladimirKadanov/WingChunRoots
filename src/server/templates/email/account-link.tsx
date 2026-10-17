// Shared body of the two account e-mails of M02 (verify-email, reset-password): a greeting, the
// reason, a button with the link, the same link as text (plain-text mail clients and copy and
// paste), how long it works, and what to do when the e-mail was not expected.

import { Button, Link, Text } from 'react-email';

import { EmailLayout, PersonName, textStyle } from './components';
import type { NameData } from './types';

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

const linkStyle = { color: '#0b57d0', wordBreak: 'break-all' } as const;

export function AccountLinkEmail({
  preview,
  recipientNames,
  intro,
  action,
  url,
  expiresInHours,
  notExpected,
}: {
  preview: string;
  recipientNames: NameData[];
  intro: string;
  action: string;
  url: string;
  expiresInHours: number;
  notExpected: string;
}) {
  return (
    <EmailLayout preview={preview}>
      <Text style={textStyle}>
        {recipientNames.length > 0 ? (
          <>
            Hello <PersonName names={recipientNames} />,
          </>
        ) : (
          'Hello,'
        )}
      </Text>
      <Text style={textStyle}>{intro}</Text>
      <Button href={url} style={buttonStyle}>
        {action}
      </Button>
      <Text style={{ ...textStyle, marginTop: '16px' }}>
        If the button does not work, copy this address into your browser:{' '}
        <Link href={url} style={linkStyle}>
          {url}
        </Link>
      </Text>
      <Text style={textStyle}>
        The link works for {expiresInHours === 1 ? '1 hour' : `${expiresInHours} hours`} and only once. {notExpected}
      </Text>
    </EmailLayout>
  );
}
