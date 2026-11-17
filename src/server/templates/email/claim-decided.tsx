// "claim-decided" (milestone M10b, In scope 2): to the teacher who accepted an invitation, when a
// reviewer approves their profile claim, refuses it or asks for more information. An approved
// claim leads to the student's request, which the teacher now answers themselves (M09); the
// reviewers' own words are on the case page (/dashboard/cases/<id>), never in the e-mail. With
// `self` (ADR 0037): a claim asked from a public profile, which answers no request; approved, it
// leads to Your profile.

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { RelationshipEmail } from './relationship-link';
import { CASE_PAGE, type EmailTemplate, type NameData, parseAppPathUrl, parseAppUrl, parseNames, parseObject, parseOptionalNames, TemplateDataError } from './types';

export interface ClaimDecidedData {
  decision: 'approved' | 'rejected' | 'needs_info';
  /** The names of the claimed profile. */
  teacherNames: NameData[];
  /**
   * APP_URL/dashboard/students/requests when approved (APP_URL/dashboard/profile with `self`),
   * otherwise APP_URL/dashboard/cases/<id>.
   */
  url: string;
  recipientNames?: NameData[];
  /** A claim asked from the profile page (ADR 0037), not an invitation. */
  self?: boolean;
}

const NAME = 'claim-decided';
const DECISIONS = ['approved', 'rejected', 'needs_info'] as const;

const preview = ({ decision, self }: ClaimDecidedData) =>
  decision === 'approved'
    ? self
      ? 'Your profile claim was approved. The profile is yours now.'
      : 'Your profile claim was approved. A student’s request waits for your answer.'
    : decision === 'rejected'
      ? 'The reviewers could not confirm your profile claim.'
      : 'The reviewers ask for more information about your profile claim.';

export const claimDecided: EmailTemplate<ClaimDecidedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (!(DECISIONS as readonly unknown[]).includes(object.decision)) throw new TemplateDataError(NAME, 'decision must be approved, rejected or needs_info');
    const decision = object.decision as ClaimDecidedData['decision'];
    if (object.self !== undefined && typeof object.self !== 'boolean') throw new TemplateDataError(NAME, 'self must be a boolean');
    const self = object.self === true;
    return {
      decision,
      teacherNames: parseNames(NAME, 'teacherNames', object.teacherNames),
      url:
        decision === 'approved'
          ? parseAppUrl(NAME, 'url', object.url, self ? '/dashboard/profile' : '/dashboard/students/requests')
          : parseAppPathUrl(NAME, 'url', object.url, CASE_PAGE, '/dashboard/cases/<id>'),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
      ...(self ? { self: true } : {}),
    };
  },
  subject: ({ decision }) =>
    decision === 'approved'
      ? 'Your profile claim was approved on WingChunRoots'
      : decision === 'rejected'
        ? 'Your profile claim was not approved on WingChunRoots'
        : 'More information needed for your profile claim on WingChunRoots',
  preview,
  render(data) {
    const { decision, teacherNames, url, recipientNames = [], self = false } = data;
    return (
      <RelationshipEmail
        preview={preview(data)}
        recipientNames={recipientNames}
        action={decision === 'approved' ? (self ? 'Open your profile' : 'Answer the request') : decision === 'rejected' ? 'Read their reason' : 'Read their question'}
        url={url}
      >
        <Text style={textStyle}>
          {decision === 'approved' ? (
            <>
              The reviewers approved your claim: the profile <PersonName names={teacherNames} /> is now yours.
            </>
          ) : decision === 'rejected' ? (
            <>
              The reviewers could not confirm that the profile <PersonName names={teacherNames} /> is yours.
            </>
          ) : (
            <>
              The reviewers of your claim to the profile <PersonName names={teacherNames} /> ask for more information.
            </>
          )}
        </Text>
        <Text style={textStyle}>
          {decision === 'approved'
            ? self
              ? 'You can edit it now, and choose whether it is shown publicly, in Your profile.'
              : 'The student who invited you waits for your answer. Approve the request if it is right, or decline it with a reason. Nothing becomes public until you approve.'
            : decision === 'rejected'
              ? self
                ? 'Their reason is on the case page. The profile stays as it was.'
                : 'Their reason is on the case page. The profile stays private.'
              : 'Their question is on the case page, where you can answer and add evidence.'}
        </Text>
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    decision: 'approved',
    teacherNames: [{ value: 'Demo Invited Sifu', lang: 'en' }],
    url: 'http://localhost:3000/dashboard/students/requests',
    recipientNames: [{ value: 'Demo Invited Sifu', lang: 'en' }],
  },
};
