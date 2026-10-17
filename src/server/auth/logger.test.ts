// Better Auth's log lines without e-mail or IP addresses (plan §6.4, CLAUDE.md §6).

import { describe, expect, it } from 'vitest';

import { redactLogText } from './logger';

describe('redactLogText', () => {
  it.each([
    ['from 198.18.0.7', 'from <ip>'],
    ['from 2001:db8::1', 'from <ip>'],
    ['from fe80::1%eth0', 'from <ip>%eth0'],
    ['from ::1', 'from <ip>'],
    ['from [2001:0db8:0000:0000:0000:0000:0000:0001]:3000', 'from [<ip>]:3000'],
    ['from 2001:db8:85a3:0:0:8a2e:370:7334, then', 'from <ip>, then'],
  ])('removes the IP address in %j', (input, expected) => {
    expect(redactLogText(input)).toBe(expected);
  });

  it('removes e-mail addresses and keeps the rest of the message', () => {
    const line = redactLogText('Sign-up attempt for existing email: demo-someone@example.test');
    expect(line).not.toContain('@');
    expect(line).toContain('Sign-up attempt for existing email:');
  });

  it('leaves ordinary text with a colon alone', () => {
    expect(redactLogText('Rate limit: /sign-in/email')).toBe('Rate limit: /sign-in/email');
    expect(redactLogText('Error: INVALID_CODE')).toBe('Error: INVALID_CODE');
  });
});
