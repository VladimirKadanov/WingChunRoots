// "notice" (milestone M18, In scope 2 and 5; docs/adr/0021-notices.md): the e-mail of a notice that
// has no dedicated e-mail of its own (the catalog's `email: 'notice'`, src/server/templates/catalog.ts).
// It carries the notice's own text, rendered from src/server/templates/notifications.ts when the
// notice is sent (src/server/services/notify.ts), so the dashboard and the e-mail say the same thing:
// a title, the body with names in their own script (`lang`, translate="no"), and a button to the
// page where it is acted on. The unsubscribe footer comes from the layout when the category can be
// switched off.

import { Button, Link, Text } from 'react-email';

import { EmailLayout, PersonName, textStyle } from './components';
import { type EmailTemplate, type NameData, parseNames, parseObject, parseOptionalNames, TemplateDataError } from './types';

export type NoticeSegment = { text: string } | { name: NameData };

export interface NoticeData {
  title: string;
  body: NoticeSegment[];
  /** The page where the notice is acted on: an absolute http(s) URL of the app. */
  action?: { label: string; url: string };
  recipientNames?: NameData[];
}

const NAME = 'notice';
const MAX_URL_LENGTH = 2048;

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

function text(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new TemplateDataError(NAME, `${field} must be a text of 1 to ${max} characters`);
  return value;
}

function segments(value: unknown): NoticeSegment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new TemplateDataError(NAME, 'body must be a list of 1 to 20 segments');
  return value.map((segment, index) => {
    const object = parseObject(NAME, segment);
    if ('name' in object) return { name: parseNames(NAME, `body[${index}].name`, [object.name])[0]! };
    return { text: text(`body[${index}].text`, object.text, 2000) };
  });
}

function action(value: unknown): { action?: { label: string; url: string } } {
  if (value === undefined) return {};
  const object = parseObject(NAME, value);
  const url = object.url;
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) throw new TemplateDataError(NAME, 'action.url must be a URL');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TemplateDataError(NAME, 'action.url must be a URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new TemplateDataError(NAME, 'action.url must be an http(s) URL');
  return { action: { label: text('action.label', object.label, 80), url } };
}

const preview = (data: NoticeData) => data.title;

export const notice: EmailTemplate<NoticeData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      title: text('title', object.title, 200),
      body: segments(object.body),
      ...action(object.action),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: ({ title }) => `${title} · WingChunRoots`,
  preview,
  render(data) {
    const { title, body, action: link, recipientNames = [] } = data;
    return (
      <EmailLayout preview={preview(data)}>
        <Text style={textStyle}>
          {recipientNames.length > 0 ? (
            <>
              Hello <PersonName names={recipientNames} />,
            </>
          ) : (
            'Hello,'
          )}
        </Text>
        <Text style={{ ...textStyle, fontWeight: 600 }}>{title}</Text>
        <Text style={textStyle}>
          {body.map((segment, index) => ('name' in segment ? <PersonName key={index} names={[segment.name]} /> : <span key={index}>{segment.text}</span>))}
        </Text>
        {link ? (
          <>
            <Button href={link.url} style={buttonStyle}>
              {link.label}
            </Button>
            <Text style={{ ...textStyle, marginTop: '16px' }}>
              If the button does not work, copy this address into your browser:{' '}
              <Link href={link.url} style={{ color: '#0b57d0', wordBreak: 'break-all' }}>
                {link.url}
              </Link>
            </Text>
          </>
        ) : null}
      </EmailLayout>
    );
  },
  // Fictional (D20).
  sample: {
    title: 'Training marked as ended',
    body: [{ name: { value: 'Demo Sifu', lang: 'en' } }, { text: ' marked your training in Demo Lineage A as ended. The link stays on the record as historical.' }],
    action: { label: 'See your teachers', url: 'http://localhost:3000/dashboard/teachers' },
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
