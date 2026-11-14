// "relationship-approved" (milestone M09, In scope 4): to both people of a relationship the teacher
// has just approved. The link is verified and public now; each approval confirms only its own link.

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseAppUrl, parseNames, parseObject, parseOptionalNames, TemplateDataError } from './types';

export interface RelationshipApprovedData {
  /** Who receives it: the student, or the teacher who approved. */
  role: 'student' | 'teacher';
  /** The other person's names (the teacher for the student, the student for the teacher). */
  otherNames: NameData[];
  lineageName: string;
  /** APP_URL/dashboard/teachers (student) or APP_URL/dashboard/students/requests (teacher). */
  url: string;
  recipientNames?: NameData[];
  /**
   * Review 2026-11-14 (DEFAULT D03): false when an end of the link is private, so the link is
   * confirmed but not on the public pages yet. Left out in an e-mail queued before: true.
   */
  shown?: boolean;
}

const NAME = 'relationship-approved';
const PATHS = { student: '/dashboard/teachers', teacher: '/dashboard/students/requests' } as const;
const preview = (data: RelationshipApprovedData) =>
  data.role === 'student' ? 'Your teacher confirmed that they taught you.' : 'You confirmed a student.';

export const relationshipApproved: EmailTemplate<RelationshipApprovedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (object.role !== 'student' && object.role !== 'teacher') throw new TemplateDataError(NAME, 'role must be student or teacher');
    const role = object.role;
    return {
      role,
      otherNames: parseNames(NAME, 'otherNames', object.otherNames),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      url: parseAppUrl(NAME, 'url', object.url, PATHS[role]),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
      ...(object.shown === false ? { shown: false } : {}),
    };
  },
  subject: ({ role }) => (role === 'student' ? 'Your teacher confirmed you on WingChunRoots' : 'You confirmed a student on WingChunRoots'),
  preview,
  render(data) {
    const { role, otherNames, lineageName, url, recipientNames = [], shown = true } = data;
    return (
      <RelationshipEmail
        preview={preview(data)}
        recipientNames={recipientNames}
        action={role === 'student' ? 'See your teachers' : 'See your students'}
        url={url}
      >
        <Text style={textStyle}>
          {role === 'student' ? (
            <>
              <PersonName names={otherNames} /> confirmed that they taught you in {lineageName}.
            </>
          ) : (
            <>
              You confirmed <PersonName names={otherNames} /> as your student in {lineageName}.
            </>
          )}
        </Text>
        <Text style={textStyle}>
          {shown ? (
            <>
              The link is verified and now appears in the public lineage, with you as their {role === 'student' ? 'student' : 'teacher'}. It
              confirms only this one link: every teacher confirms their own.
            </>
          ) : (
            <>
              The link is verified, but it is not on the public pages yet: it appears in the public lineage once both profiles are
              public (each person decides that with “Show my profile publicly”). You can see it on your dashboard, under {role === 'student' ? 'Your teachers' : 'Student requests'}. It
              confirms only this one link: every teacher confirms their own.
            </>
          )}
        </Text>
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    role: 'student',
    otherNames: [{ value: 'Demo Sifu', lang: 'en' }],
    lineageName: 'Demo Lineage A',
    url: 'http://localhost:3000/dashboard/teachers',
    recipientNames: [{ value: 'Demo Student', lang: 'en' }],
  },
};
