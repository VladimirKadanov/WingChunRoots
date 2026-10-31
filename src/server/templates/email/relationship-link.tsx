// Shared body of the teacher-request e-mails (milestone M09): a greeting, what happened, a button to
// the page where it is acted on, and the same address as text (plain-text mail clients). Names keep
// their `lang` attribute (plan §5.3) through PersonName.

import type { ReactNode } from 'react';
import { Button, Link, Text } from 'react-email';

import { EmailLayout, PersonName, textStyle } from './components';
import { type NameData, parseObject, TemplateDataError } from './types';

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

export function RelationshipEmail({
  preview,
  recipientNames,
  children,
  action,
  url,
}: {
  preview: string;
  recipientNames: NameData[];
  children: ReactNode;
  action: string;
  url: string;
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
      {children}
      <Button href={url} style={buttonStyle}>
        {action}
      </Button>
      <Text style={{ ...textStyle, marginTop: '16px' }}>
        If the button does not work, copy this address into your browser:{' '}
        <Link href={url} style={linkStyle}>
          {url}
        </Link>
      </Text>
    </EmailLayout>
  );
}

/** A short plain text from the data (a lineage name, a training start, a reason), 1 to 300 characters. */
export function parseShortText(template: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 300) {
    throw new TemplateDataError(template, `${field} must be a short text`);
  }
  return value.trim();
}

export { parseObject };
