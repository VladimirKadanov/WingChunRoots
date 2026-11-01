// "review-decided" (milestone M10a, In scope 4): to the student of a historical teacher claim when
// the reviewers decide it or ask for more information. The reviewers' own words are shown only on
// the student's dashboard (Your teachers), never in the e-mail.

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseAppUrl, parseNames, parseObject, parseOptionalNames, TemplateDataError } from './types';

export interface ReviewDecidedData {
  decision: 'verified' | 'rejected' | 'needs_info';
  /** The historical teacher's names. */
  teacherNames: NameData[];
  lineageName: string;
  /** APP_URL/dashboard/teachers. */
  url: string;
  recipientNames?: NameData[];
}

const NAME = 'review-decided';
const DECISIONS = ['verified', 'rejected', 'needs_info'] as const;

const preview = ({ decision }: ReviewDecidedData) =>
  decision === 'verified'
    ? 'The reviewers confirmed your training with a historical teacher.'
    : decision === 'rejected'
      ? 'The reviewers could not confirm your claim from the evidence sent.'
      : 'The reviewers ask for more information about your claim.';

export const reviewDecided: EmailTemplate<ReviewDecidedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (!(DECISIONS as readonly unknown[]).includes(object.decision)) throw new TemplateDataError(NAME, 'decision must be verified, rejected or needs_info');
    return {
      decision: object.decision as ReviewDecidedData['decision'],
      teacherNames: parseNames(NAME, 'teacherNames', object.teacherNames),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      url: parseAppUrl(NAME, 'url', object.url, '/dashboard/teachers'),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: ({ decision }) =>
    decision === 'verified'
      ? 'Your historical teacher claim was confirmed on WingChunRoots'
      : decision === 'rejected'
        ? 'Your historical teacher claim was not confirmed on WingChunRoots'
        : 'More information needed for your claim on WingChunRoots',
  preview,
  render(data) {
    const { decision, teacherNames, lineageName, url, recipientNames = [] } = data;
    return (
      <RelationshipEmail preview={preview(data)} recipientNames={recipientNames} action="See your teachers" url={url}>
        <Text style={textStyle}>
          {decision === 'verified' ? (
            <>
              The reviewers confirmed from your evidence that <PersonName names={teacherNames} /> taught you in {lineageName}.
            </>
          ) : decision === 'rejected' ? (
            <>
              The reviewers could not confirm from the evidence sent that <PersonName names={teacherNames} /> taught you in {lineageName}.
            </>
          ) : (
            <>
              The reviewers of your claim that <PersonName names={teacherNames} /> taught you in {lineageName} ask for more information.
            </>
          )}
        </Text>
        <Text style={textStyle}>
          {decision === 'verified'
            ? 'The link is verified and now appears in the public lineage. It confirms only this one link.'
            : decision === 'rejected'
              ? 'Their reason is on Your teachers. You can send a new claim with more evidence.'
              : 'Their question is on Your teachers, where you can add evidence to the claim.'}
        </Text>
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    decision: 'verified',
    teacherNames: [{ value: 'Demo Historical Teacher', lang: 'en' }],
    lineageName: 'Demo Lineage A',
    url: 'http://localhost:3000/dashboard/teachers',
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
