// "relationship-rejected" (milestone M09, In scope 6): to a student whose teacher declined a
// request, with the neutral reason the teacher chose and a link to correct it and send it again.

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseNames, parseObject, parseOptionalNames, TemplateDataError } from './types';

export interface RelationshipRejectedData {
  teacherNames: NameData[];
  /** The neutral reason, as the app words it (src/server/templates/relationships.ts). */
  reason: string;
  lineageName: string;
  /** APP_URL/dashboard/teachers/new?resubmit=<relationship id>: the form, filled in with the request. */
  url: string;
  recipientNames?: NameData[];
}

const NAME = 'relationship-rejected';
const RESUBMIT_PATH = '/dashboard/teachers/new';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The resubmit link: an http(s) address of the request form with `?resubmit=<uuid>` and nothing else. */
function parseResubmitUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(typeof value === 'string' && value.length <= 2048 ? value : '');
  } catch {
    throw new TemplateDataError(NAME, 'url must be a URL');
  }
  const keys = [...url.searchParams.keys()];
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TemplateDataError(NAME, 'url must be an http(s) URL');
  if (url.pathname !== RESUBMIT_PATH || url.hash || keys.length !== 1 || keys[0] !== 'resubmit' || !UUID.test(url.searchParams.get('resubmit') ?? '')) {
    throw new TemplateDataError(NAME, `url must point at ${RESUBMIT_PATH}?resubmit=<id>`);
  }
  return value as string;
}
const preview = () => 'Your teacher asks you to check your request.';

export const relationshipRejected: EmailTemplate<RelationshipRejectedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      teacherNames: parseNames(NAME, 'teacherNames', object.teacherNames),
      reason: parseShortText(NAME, 'reason', object.reason),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      url: parseResubmitUrl(object.url),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: () => 'Your teacher request needs a correction',
  preview,
  render({ teacherNames, reason, lineageName, url, recipientNames = [] }) {
    return (
      <RelationshipEmail preview={preview()} recipientNames={recipientNames} action="Correct and send again" url={url}>
        <Text style={textStyle}>
          <PersonName names={teacherNames} /> did not confirm your request in {lineageName} as it was sent.
        </Text>
        <Text style={textStyle}>Reason: {reason}</Text>
        <Text style={textStyle}>You can correct the request and send it again, or withdraw it. Nothing about it is public.</Text>
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    teacherNames: [{ value: 'Demo Sifu', lang: 'en' }],
    reason: 'The training dates need correcting.',
    lineageName: 'Demo Lineage A',
    url: 'http://localhost:3000/dashboard/teachers/new?resubmit=0190a5c0-0000-7000-8000-000000000005',
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
