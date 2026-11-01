// "relationship-arbitration" (milestone M10b, In scope 5; DEFAULT D19): to both people of a
// relationship a moderator or an administrator set in arbitration, and again when the moderators
// ask for more or decide. It carries the moderator's reason (plan §6.7: both parties read it) and
// the link to the case page, where each party sends evidence (/dashboard/cases/<id>).

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import {
  CASE_PAGE,
  type EmailTemplate,
  type NameData,
  parseAppPathUrl,
  parseLongText,
  parseNames,
  parseObject,
  parseOptionalNames,
  TemplateDataError,
} from './types';

export interface RelationshipArbitrationData {
  stage: 'opened' | 'needs_info' | 'kept' | 'revoked';
  /** The recipient's side of the relationship. */
  role: 'student' | 'teacher';
  /** The other person's names. */
  otherNames: NameData[];
  lineageName: string;
  /** The moderator's words: the reason, their question or their decision. */
  reason: string;
  /** APP_URL/dashboard/cases/<id> */
  url: string;
  recipientNames?: NameData[];
}

const NAME = 'relationship-arbitration';
const STAGES = ['opened', 'needs_info', 'kept', 'revoked'] as const;

const preview = ({ stage }: RelationshipArbitrationData) =>
  stage === 'opened'
    ? 'A moderator set one of your teaching relationships in arbitration and asks both of you for evidence.'
    : stage === 'needs_info'
      ? 'The moderators ask for more information about a relationship in arbitration.'
      : 'The moderators decided a relationship in arbitration.';

export const relationshipArbitration: EmailTemplate<RelationshipArbitrationData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (!(STAGES as readonly unknown[]).includes(object.stage)) throw new TemplateDataError(NAME, 'stage must be opened, needs_info, kept or revoked');
    if (object.role !== 'student' && object.role !== 'teacher') throw new TemplateDataError(NAME, 'role must be student or teacher');
    return {
      stage: object.stage as RelationshipArbitrationData['stage'],
      role: object.role,
      otherNames: parseNames(NAME, 'otherNames', object.otherNames),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      reason: parseLongText(NAME, 'reason', object.reason),
      url: parseAppPathUrl(NAME, 'url', object.url, CASE_PAGE, '/dashboard/cases/<id>'),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: ({ stage }) =>
    stage === 'opened'
      ? 'A teaching relationship is in arbitration on WingChunRoots'
      : stage === 'needs_info'
        ? 'More information needed for a relationship in arbitration on WingChunRoots'
        : 'A decision on a relationship in arbitration on WingChunRoots',
  preview,
  render(data) {
    const { stage, role, otherNames, lineageName, reason, url, recipientNames = [] } = data;
    const relation =
      role === 'student' ? (
        <>
          the record that you were a student of <PersonName names={otherNames} /> in {lineageName}
        </>
      ) : (
        <>
          the record that you were the teacher of <PersonName names={otherNames} /> in {lineageName}
        </>
      );
    return (
      <RelationshipEmail preview={preview(data)} recipientNames={recipientNames} action={stage === 'kept' || stage === 'revoked' ? 'See the case' : 'Send evidence'} url={url}>
        <Text style={textStyle}>
          {stage === 'opened' ? (
            <>A moderator opened an arbitration of {relation}. Until the moderators decide, public pages show the link as “Disputed”.</>
          ) : stage === 'needs_info' ? (
            <>The moderators handling {relation} ask both of you for more information.</>
          ) : stage === 'kept' ? (
            <>The moderators decided that {relation} stands. Public pages show it as verified again.</>
          ) : (
            <>The moderators decided to revoke {relation}. It no longer appears in the public lineage.</>
          )}
        </Text>
        <Text style={textStyle}>
          {stage === 'kept' || stage === 'revoked' ? 'Their reason:' : 'The moderator’s words:'}
          <br />
          {reason}
        </Text>
        {stage === 'opened' || stage === 'needs_info' ? (
          <Text style={textStyle}>
            Send your evidence and your answer on the case page. Each of you sees the moderators’ words and your own; neither sees the other’s
            files.
          </Text>
        ) : null}
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    stage: 'opened',
    role: 'student',
    otherNames: [{ value: 'Demo Sifu', lang: 'en' }],
    lineageName: 'Demo Lineage A',
    reason: 'Another member says the training dates are not right. Please send what shows when the training took place.',
    url: 'http://localhost:3000/dashboard/cases/0190a5c0-0000-7000-8000-00000000000a',
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
