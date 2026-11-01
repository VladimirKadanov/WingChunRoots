// "invitation" (milestone M10b, In scope 1): to a living teacher who has no account yet, when a
// student lists them and asks WingChunRoots to send the invitation. The link to /invite/<token>
// opens the claim: the teacher signs in or creates an account, a reviewer checks the claim, and the
// teacher then answers the student's request themselves (M09).
//
// The recipient has no account: the e-mail says who gave the address, what is and is not public,
// how long the link works, what ignoring it means, and links the terms and the privacy notice as
// they stand (the M02 drafts, DEFAULT D23). No other legal text: docs/plan/questions/M10b.md.
//
// The token is the only secret in the data: the outbox stores `url` sealed (secretFields), and the
// service keeps only its SHA-256 hash (src/server/services/invitations.ts).

import { Link, Text } from 'react-email';

import { PersonName, textStyle } from './components';
import { parseShortText, RelationshipEmail } from './relationship-link';
import { type EmailTemplate, type NameData, parseAppPathUrl, parseNames, parseObject, TemplateDataError } from './types';

export interface InvitationData {
  /** The student's names: they gave the address. */
  inviterNames: NameData[];
  /** The names the student wrote for the teacher's profile. */
  teacherNames: NameData[];
  lineageName: string;
  /** APP_URL/invite/<token>: 32 random bytes, base64url. */
  url: string;
  /** How many days the link works (14). */
  days: number;
}

const NAME = 'invitation';
const INVITE_PAGE = /^\/invite\/[A-Za-z0-9_-]{43}$/;
const linkStyle = { color: '#0b57d0', wordBreak: 'break-all' } as const;

const preview = () => 'A student listed you as their teacher on WingChunRoots and invites you to claim your profile.';

export const invitation: EmailTemplate<InvitationData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (typeof object.days !== 'number' || !Number.isInteger(object.days) || object.days < 1 || object.days > 30) {
      throw new TemplateDataError(NAME, 'days must be a whole number from 1 to 30');
    }
    return {
      inviterNames: parseNames(NAME, 'inviterNames', object.inviterNames),
      teacherNames: parseNames(NAME, 'teacherNames', object.teacherNames),
      lineageName: parseShortText(NAME, 'lineageName', object.lineageName),
      url: parseAppPathUrl(NAME, 'url', object.url, INVITE_PAGE, '/invite/<token>'),
      days: object.days,
    };
  },
  subject: () => 'Invite to claim your teacher profile on WingChunRoots',
  preview,
  render({ inviterNames, teacherNames, lineageName, url, days }) {
    const origin = new URL(url).origin;
    return (
      <RelationshipEmail preview={preview()} recipientNames={[]} action="Claim your profile" url={url}>
        <Text style={textStyle}>
          <PersonName names={inviterNames} /> listed you as their teacher in {lineageName} on WingChunRoots, a record of Wing Chun teaching
          lineages, and asked us to send you this invitation. They gave us your e-mail address.
        </Text>
        <Text style={textStyle}>
          They started a profile for you under the name <PersonName names={teacherNames} />. Nothing about it is public: until you claim the
          profile and approve their request yourself, only they, you and the site’s reviewers can see it.
        </Text>
        <Text style={textStyle}>
          To claim it, open the link, then sign in or create an account. A reviewer checks the claim; after that you decide on the student’s
          request yourself, and you can decline it.
        </Text>
        <Text style={textStyle}>
          The link works for {days === 1 ? '1 day' : `${days} days`} and only once. If you do not know this student or do not want a profile,
          ignore this e-mail: nothing is published, and your address is deleted 30 days after the invitation ends.
        </Text>
        <Text style={textStyle}>
          Terms of use:{' '}
          <Link href={`${origin}/legal/terms`} style={linkStyle}>
            {`${origin}/legal/terms`}
          </Link>
          <br />
          Privacy notice:{' '}
          <Link href={`${origin}/legal/privacy`} style={linkStyle}>
            {`${origin}/legal/privacy`}
          </Link>
        </Text>
      </RelationshipEmail>
    );
  },
  secretFields: ['url'],
  // Fictional (D20).
  sample: {
    inviterNames: [{ value: 'Demo Student', lang: 'en' }],
    teacherNames: [
      { value: 'Demo Invited Sifu', lang: 'en' },
      { value: '示範師傅', lang: 'zh-Hant' },
    ],
    lineageName: 'Demo Lineage A',
    url: 'http://localhost:3000/invite/demo-invitation-token-000000000000000000000',
    days: 14,
  },
};
