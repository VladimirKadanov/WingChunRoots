// "relationship-rejected" (milestone M09, In scope 6): to a student whose teacher declined a
// request, with the neutral reason the teacher chose and a link to correct it and send it again.

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseAppUrl, parseNames, parseObject, parseOptionalNames } from './types';

export interface RelationshipRejectedData {
  teacherNames: NameData[];
  /** The neutral reason, as the app words it (src/server/templates/relationships.ts). */
  reason: string;
  lineageName: string;
  /** APP_URL/dashboard/teachers */
  url: string;
  recipientNames?: NameData[];
}

const NAME = 'relationship-rejected';
const preview = () => 'Your teacher asks you to check your request.';

export const relationshipRejected: EmailTemplate<RelationshipRejectedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      teacherNames: parseNames(NAME, 'teacherNames', object.teacherNames),
      reason: parseShortText(NAME, 'reason', object.reason),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      url: parseAppUrl(NAME, 'url', object.url, '/dashboard/teachers'),
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
    url: 'http://localhost:3000/dashboard/teachers',
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
