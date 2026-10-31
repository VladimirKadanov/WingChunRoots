// "relationship-requested" (milestone M09, In scope 2): to a teacher, when a student asks them to
// confirm that they taught them (a new request or one sent again after a correction). The student's
// names, the start of the training, the lineage and a link to the teacher's queue.

import { Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseAppUrl, parseNames, parseObject, parseOptionalNames } from './types';

export interface RelationshipRequestedData {
  /** The student's names: the Latin-script display name first, then their own script. */
  studentNames: NameData[];
  /** "April 2019", "2019" or "Dates not given". */
  trainingStart: string;
  lineageName: string;
  /** True for a request sent again after the teacher declined it. */
  resubmitted: boolean;
  /** APP_URL/dashboard/students/requests */
  queueUrl: string;
  recipientNames?: NameData[];
}

const NAME = 'relationship-requested';
const preview = () => 'A student asks you to confirm that you taught them.';

export const relationshipRequested: EmailTemplate<RelationshipRequestedData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return {
      studentNames: parseNames(NAME, 'studentNames', object.studentNames),
      trainingStart: parseShortText(NAME, 'trainingStart', object.trainingStart),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      resubmitted: object.resubmitted === true,
      queueUrl: parseAppUrl(NAME, 'queueUrl', object.queueUrl, '/dashboard/students/requests'),
      ...parseOptionalNames(NAME, 'recipientNames', object.recipientNames),
    };
  },
  subject: ({ resubmitted }) => (resubmitted ? 'A corrected teacher request on WingChunRoots' : 'A new teacher request on WingChunRoots'),
  preview,
  render({ studentNames, trainingStart, lineageName, resubmitted, queueUrl, recipientNames = [] }) {
    return (
      <RelationshipEmail preview={preview()} recipientNames={recipientNames} action="Open your student requests" url={queueUrl}>
        <Text style={textStyle}>
          <PersonName names={studentNames} />{' '}
          {resubmitted ? 'corrected their request and asks again' : 'asks you'} to confirm that you taught them.
        </Text>
        <Text style={textStyle}>
          Training started: {trainingStart}
          <br />
          Lineage: {lineageName}
        </Text>
        <Text style={textStyle}>
          Approve the request if it is right, or decline it with a reason; the student can correct it and send it again. Nothing becomes
          public until you approve.
        </Text>
      </RelationshipEmail>
    );
  },
  // Fictional (D20).
  sample: {
    studentNames: [
      { value: 'Demo Student', lang: 'en' },
      { value: '示範學生', lang: 'zh-Hant' },
    ],
    trainingStart: 'April 2019',
    lineageName: 'Demo Lineage A',
    resubmitted: false,
    queueUrl: 'http://localhost:3000/dashboard/students/requests',
    recipientNames: [{ value: 'Demo Sifu', lang: 'en' }],
  },
};
