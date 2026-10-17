// "mail-check": a short message that confirms e-mail from WingChunRoots reaches a mailbox. Used by
// `pnpm mail:check`, the integration tests and the E2E test of the mail path (milestone M01b).

import { Text } from 'react-email';

import { EmailLayout, PersonName, textStyle } from './components';
import { type EmailTemplate, type NameData, parseObject, parseOptionalNames } from './types';

export interface MailCheckData {
  /** The recipient's names, if known (1 to 4); the first is the Latin-script display name. */
  recipientNames?: NameData[];
}

const NAME = 'mail-check';
const preview = () => 'E-mail from WingChunRoots reaches your inbox.';

export const mailCheck: EmailTemplate<MailCheckData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    return parseOptionalNames(NAME, 'recipientNames', object.recipientNames);
  },
  subject: () => 'WingChunRoots mail check',
  preview,
  render({ recipientNames = [] }) {
    return (
      <EmailLayout preview={preview()}>
        <Text style={textStyle}>
          {recipientNames.length > 0 ? (
            <>
              Hello <PersonName names={recipientNames} />,
            </>
          ) : (
            'Hello,'
          )}
        </Text>
        <Text style={textStyle}>
          This message confirms that e-mail from WingChunRoots reaches your inbox. You do not need to reply or do
          anything else.
        </Text>
      </EmailLayout>
    );
  },
  // Fictional (D20): "Demo Student" and its Traditional Chinese rendering.
  sample: {
    recipientNames: [
      { value: 'Demo Student', lang: 'en' },
      { value: '示範學生', lang: 'zh-Hant' },
    ],
  },
};
