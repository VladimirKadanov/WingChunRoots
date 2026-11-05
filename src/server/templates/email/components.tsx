// Building blocks of the e-mail templates (React Email). Plain inline styles: mail clients ignore
// most CSS; the colours keep a contrast of at least 4.5:1 on white (plan §5.2).

import type { ReactNode } from 'react';
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from 'react-email';

import type { NameData } from './types';

const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'PingFang TC', 'Microsoft JhengHei', sans-serif";

const styles = {
  body: { backgroundColor: '#ffffff', color: '#1f2328', fontFamily, margin: 0, padding: '24px 0' },
  container: { maxWidth: '560px', margin: '0 auto', padding: '0 16px' },
  brand: { fontSize: '14px', fontWeight: 600, letterSpacing: '0.02em', color: '#1f2328', margin: '0 0 16px' },
  footer: { fontSize: '12px', lineHeight: '18px', color: '#57606a', margin: '16px 0 0' },
  hr: { borderColor: '#d0d7de', margin: '24px 0 0' },
} as const;

export const textStyle = { fontSize: '16px', lineHeight: '24px', color: '#1f2328', margin: '0 0 16px' } as const;

/**
 * M18 (In scope 4): the unsubscribe link of an e-mail whose category can be switched off. renderEmail()
 * gives it to the template's EmailLayout for the delivery (src/server/templates/email/index.ts), so
 * every template shows it in the footer without a field of its own; the Mailer adds
 * List-Unsubscribe from the same link. A prop, not a React context: the templates are imported by
 * Server Components too, where createContext is not available.
 */
export interface UnsubscribeLink {
  /** APP_URL/unsubscribe?token=…: a page that switches the category off with one press, no sign-in. */
  url: string;
  /** The category's label (src/server/templates/catalog.ts). */
  category: string;
}

function UnsubscribeFooter({ link }: { link: UnsubscribeLink | undefined }) {
  if (!link) return null;
  return (
    <Text style={styles.footer}>
      You get this e-mail because e-mail is on for {link.category} notices. To stop these e-mails, open{' '}
      <Link href={link.url} style={{ color: '#0b57d0' }}>
        Unsubscribe from {link.category} e-mails
      </Link>{' '}
      and press the button; no sign-in is needed. You can turn them on again in Account type and plan, under Notifications.
    </Text>
  );
}

/** The frame of every e-mail: language, preview line, brand line and footer. */
export function EmailLayout({ preview, children, unsubscribe }: { preview: string; children: ReactNode; unsubscribe?: UnsubscribeLink }) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>WingChunRoots</Text>
          <Section>{children}</Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            WingChunRoots documents Wing Chun teaching lineages. You received this e-mail because of an action on
            WingChunRoots.
          </Text>
          <UnsubscribeFooter link={unsubscribe} />
        </Container>
      </Body>
    </Html>
  );
}

/**
 * A person's name with its `lang` attribute and translate="no", so screen readers pronounce it
 * in its own language and translation tools leave it alone (plan §5.3). The first name is the
 * Latin-script display name; the others follow in brackets.
 */
export function PersonName({ names }: { names: NameData[] }) {
  const [primary, ...others] = names;
  if (!primary) return null;
  return (
    <>
      <span lang={primary.lang} translate="no">
        {primary.value}
      </span>
      {others.length > 0 ? (
        <>
          {' ('}
          {others.map((name, index) => (
            <span key={`${name.lang}-${index}`}>
              {index > 0 ? ', ' : null}
              <span lang={name.lang} translate="no">
                {name.value}
              </span>
            </span>
          ))}
          {')'}
        </>
      ) : null}
    </>
  );
}
