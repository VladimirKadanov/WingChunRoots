// "identity-code" (ADR 0088, impersonation reports): the one-time code sent to an address at a
// school's own domain, which one side of an impersonation report types back on its case page to show
// that it reads the school's mail. The code is the only secret: the outbox stores it sealed
// (secretFields). No name of anyone: the message goes to an address nobody has confirmed yet.

import { Text } from 'react-email';

import { EmailLayout, textStyle } from './components';
import { type EmailTemplate, parseObject, TemplateDataError } from './types';

export interface IdentityCodeData {
  /** Six digits. */
  code: string;
  /** The domain the address belongs to, as the side typed it (the school's own). */
  domain: string;
  /** How many days the code can be typed back. */
  days: number;
}

const NAME = 'identity-code';
const preview = () => 'A code to confirm who runs this school’s mail.';

export const identityCode: EmailTemplate<IdentityCodeData> = {
  name: NAME,
  parse(data) {
    const object = parseObject(NAME, data);
    if (typeof object.code !== 'string' || !/^[0-9]{6}$/.test(object.code)) throw new TemplateDataError(NAME, 'code must be six digits');
    if (typeof object.domain !== 'string' || !/^[a-z0-9.-]{3,253}$/.test(object.domain)) throw new TemplateDataError(NAME, 'domain must be a domain name');
    if (typeof object.days !== 'number' || !Number.isInteger(object.days) || object.days < 1 || object.days > 30) throw new TemplateDataError(NAME, 'days must be 1 to 30');
    return { code: object.code, domain: object.domain, days: object.days };
  },
  subject: () => 'Your WingChunRoots confirmation code',
  preview,
  render({ code, domain, days }) {
    return (
      <EmailLayout preview={preview()}>
        <Text style={textStyle}>Hello,</Text>
        <Text style={textStyle}>
          Someone asked WingChunRoots to send a code to this address at {domain}, to show the WingChunRoots team that they read
          this school’s mail. If that was you, type this code on your case page within {days} days:
        </Text>
        <Text style={{ ...textStyle, fontSize: '28px', letterSpacing: '6px', fontWeight: 700 }}>{code}</Text>
        <Text style={textStyle}>If you did not ask for this, ignore this e-mail. Nobody can use the code without it.</Text>
      </EmailLayout>
    );
  },
  secretFields: ['code'],
  // Fictional (D20).
  sample: { code: '123456', domain: 'demo-school.example', days: 14 },
};
