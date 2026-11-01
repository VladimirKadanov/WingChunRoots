// "instructor-decided" (milestone M10b, In scope 3): to a Sifu when an archivist or an
// administrator verifies them as an instructor, refuses the evidence or asks for more. The
// reviewers' own words are on /dashboard/instructor, never in the e-mail.

import { Text } from 'react-email';

import { textStyle } from './components';
import { RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseAppUrl, parseObject, parseOptionalNames, TemplateDataError } from './types';

export interface InstructorDecidedData {
  decision: 'verified' | 'rejected' | 'needs_info';
  /** APP_URL/dashboard/instructor */
  url: string;
  recipientNames?: NameData[];
}

const NAME = 'instructor-decided';
const DECISIONS = ['verified', 'rejected', 'needs_info'] as const;

const preview = ({ decision }: InstructorDecidedData) =>
  decision === 'verified'
    ? 'You are now a verified instructor on WingChunRoots.'
    : decision === 'rejected'
      ? 'The reviewers could not verify you as an instructor from the evidence sent.'
      : 'The reviewers ask for more information about your instructor verification.';

export const instructorDecided: EmailTemplate<InstructorDecidedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (!(DECISIONS as readonly unknown[]).includes(object.decision)) throw new TemplateDataError(NAME, 'decision must be verified, rejected or needs_info');
    return {
      decision: object.decision as InstructorDecidedData['decision'],
      url: parseAppUrl(NAME, 'url', object.url, '/dashboard/instructor'),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: ({ decision }) =>
    decision === 'verified'
      ? 'You are a verified instructor on WingChunRoots'
      : decision === 'rejected'
        ? 'Your instructor verification was not approved on WingChunRoots'
        : 'More information needed for your instructor verification on WingChunRoots',
  preview,
  render(data) {
    const { decision, url, recipientNames = [] } = data;
    return (
      <RelationshipEmail preview={preview(data)} recipientNames={recipientNames} action="See your instructor status" url={url}>
        <Text style={textStyle}>
          {decision === 'verified'
            ? 'The reviewers verified you as an instructor from your evidence. Your profile now says “Instructor”, and the links you approve no longer say “Approved by an unverified instructor”.'
            : decision === 'rejected'
              ? 'The reviewers could not verify you as an instructor from the evidence sent. Their reason is on your instructor page; you can send new evidence.'
              : 'The reviewers of your instructor verification ask for more information. Their question is on your instructor page, where you can add evidence.'}
        </Text>
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    decision: 'verified',
    url: 'http://localhost:3000/dashboard/instructor',
    recipientNames: [{ value: 'Demo Sifu', lang: 'en' }],
  },
};
