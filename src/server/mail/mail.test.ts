// Unit tests of the mail module's checks and settings (milestone M01b).

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fileMailbox } from '../../../e2e/helpers/mailbox';
import { mailConfig } from './config';
import { checkAddress, checkIdempotencyKey, checkSameEmail, describeError, MailInputError, redactAddresses } from './mailer';
import { createFileTransport, type StoredMail } from './transports';

describe('checkAddress', () => {
  it('accepts one plain address and trims it', () => {
    expect(checkAddress(' demo@wingchunroots.test ')).toBe('demo@wingchunroots.test');
    // Surrounding white space, line breaks included, is trimmed away, never sent.
    expect(checkAddress('demo@wingchunroots.test\r\n')).toBe('demo@wingchunroots.test');
    expect(checkAddress('demo.student+tag@sub.wingchunroots.test')).toBe('demo.student+tag@sub.wingchunroots.test');
  });

  it('refuses lists, display names, header injection and malformed input', () => {
    for (const bad of [
      '',
      'demo',
      'demo@localhost',
      'a@wingchunroots.test, b@wingchunroots.test',
      'a@wingchunroots.test;b@wingchunroots.test',
      'Demo <demo@wingchunroots.test>',
      'demo@wingchunroots.test\nBcc: x@wingchunroots.test',
      'demo\r\n@wingchunroots.test',
      `${'a'.repeat(250)}@wingchunroots.test`,
    ]) {
      expect(() => checkAddress(bad), JSON.stringify(bad)).toThrow(/one plain e-mail address/);
    }
  });
});

describe('checkIdempotencyKey', () => {
  it('accepts printable ASCII without spaces, up to 200 characters', () => {
    expect(checkIdempotencyKey('auth.magic-link:01a1-xyz')).toBe('auth.magic-link:01a1-xyz');
    expect(checkIdempotencyKey('k'.repeat(200))).toHaveLength(200);
    expect(() => checkIdempotencyKey('')).toThrow();
    expect(() => checkIdempotencyKey('with space')).toThrow();
    expect(() => checkIdempotencyKey('ключ')).toThrow();
    expect(() => checkIdempotencyKey('k'.repeat(201))).toThrow();
  });

  it('refuses "@": the key outlives the address, so it must never hold one', () => {
    expect(() => checkIdempotencyKey('mail-check:demo@wingchunroots.test')).toThrow(/must not hold personal data/);
    expect(() => checkIdempotencyKey('@')).toThrow(MailInputError);
  });
});

describe('checkSameEmail', () => {
  const row = { toEmail: 'demo@wingchunroots.test', template: 'mail-check' };
  it('accepts the same recipient (any case) and template', () => {
    expect(() => checkSameEmail(row, { to: 'Demo@WingChunRoots.test', template: 'mail-check' })).not.toThrow();
  });
  it('refuses another recipient or another template', () => {
    expect(() => checkSameEmail(row, { to: 'other@wingchunroots.test', template: 'mail-check' })).toThrow(MailInputError);
    expect(() => checkSameEmail(row, { to: 'demo@wingchunroots.test', template: 'auth.magic-link' })).toThrow(/another e-mail/);
  });
  it('compares only the template once retention has erased the address', () => {
    expect(() => checkSameEmail({ toEmail: null, template: 'mail-check' }, { to: 'other@wingchunroots.test', template: 'mail-check' })).not.toThrow();
    expect(() => checkSameEmail({ toEmail: null, template: 'mail-check' }, { to: 'other@wingchunroots.test', template: 'x' })).toThrow(MailInputError);
  });
});

describe('describeError', () => {
  it('keeps the code, the SMTP status and the message, without addresses', () => {
    const error = Object.assign(new Error('550 5.1.1 <demo@wingchunroots.test>: Recipient address rejected'), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    const text = describeError(error);
    expect(text).toBe('EENVELOPE: SMTP 550: 550 5.1.1 <<address>>: Recipient address rejected');
    expect(text).not.toContain('demo@');
    expect(describeError('plain')).toBe('plain');
    expect(describeError(new Error('x'.repeat(600)))).toHaveLength(500);
  });

  it('redactAddresses removes every address', () => {
    expect(redactAddresses('to a@b.test and "c.d@e.test"')).toBe('to <address> and "<address>"');
  });
});

describe('mailConfig', () => {
  it('defaults to the file transport in .mail and the reserved .test sender', () => {
    const config = mailConfig({});
    expect(config.transport).toBe('file');
    expect(config.fileDir).toBe(path.resolve('.mail'));
    expect(config.from).toBe('WingChunRoots <no-reply@wingchunroots.test>');
    expect(config.smtpUrl).toBe('smtp://127.0.0.1:1025');
  });

  it('reads MAIL_TRANSPORT, SMTP_URL, MAIL_FILE_DIR and MAIL_FROM, and refuses anything else', () => {
    expect(mailConfig({ MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://mailpit:1025' })).toMatchObject({ transport: 'smtp', smtpUrl: 'smtp://mailpit:1025' });
    expect(mailConfig({ MAIL_FILE_DIR: '/tmp/x', MAIL_FROM: 'Demo <demo@wingchunroots.test>' })).toMatchObject({
      fileDir: '/tmp/x',
      from: 'Demo <demo@wingchunroots.test>',
    });
    // Without SMTP_URL, the Mailpit port of docker-compose.yml.
    expect(mailConfig({ MAIL_TRANSPORT: 'smtp', MAILPIT_SMTP_PORT: '2025' }).smtpUrl).toBe('smtp://127.0.0.1:2025');
    expect(() => mailConfig({ MAIL_TRANSPORT: 'ses' })).toThrow(/smtp or file/);
    expect(() => mailConfig({ MAIL_TRANSPORT: 'smtp', SMTP_URL: 'http://x' })).toThrow(/smtp:\/\//);
  });

  it('accepts only the local Mailpit as the SMTP server in Phase 1 (plan §3.3)', () => {
    for (const url of ['smtp://localhost:1025', 'smtp://127.0.0.1:1025', 'smtp://127.0.0.2:2025', 'smtp://[::1]:1025', 'smtp://mailpit:1025', 'smtp://MAILPIT:1025']) {
      expect(mailConfig({ MAIL_TRANSPORT: 'smtp', SMTP_URL: url }).smtpUrl).toBe(url);
    }
    for (const url of ['smtp://smtp.example.com:587', 'smtps://demo:secret-demo@mail.example.org:465', 'smtp://127.0.0.1.example.com:25', 'smtp://10.0.0.5:1025', 'smtp://0.0.0.0:1025']) {
      expect(() => mailConfig({ MAIL_TRANSPORT: 'smtp', SMTP_URL: url })).toThrow(/local Mailpit/);
    }
    expect(() => mailConfig({ MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtps://demo:secret-demo@mail.example.org:465' })).not.toThrow(/secret-demo/);
    // The file transport never uses SMTP_URL, so it is not checked then.
    expect(mailConfig({ MAIL_TRANSPORT: 'file', SMTP_URL: 'smtp://smtp.example.com:587' }).transport).toBe('file');
  });
});

describe('the file transport and the file mailbox', () => {
  it('writes the raw message and its parts, which the mailbox helper reads back', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wcr-mail-unit-'));
    try {
      const transport = createFileTransport(dir);
      await transport.deliver({
        from: 'WingChunRoots <no-reply@wingchunroots.test>',
        to: 'demo@wingchunroots.test',
        subject: 'Demo subject',
        text: 'Demo text',
        html: '<p>Demo text</p>',
        messageId: '<demo-1@wingchunroots.test>',
        headers: { 'X-WingChunRoots-Delivery': 'demo-1' },
      });
      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(2);
      expect(files.every((f) => /\.(eml|json)$/.test(f))).toBe(true);
      const raw = await readFile(path.join(dir, files.find((f) => f.endsWith('.eml'))!), 'utf8');
      expect(raw).toContain('Message-ID: <demo-1@wingchunroots.test>');
      expect(raw).toMatch(/^X-WingChunRoots-Delivery: demo-1$/im);
      const stored = JSON.parse(await readFile(path.join(dir, files.find((f) => f.endsWith('.json'))!), 'utf8')) as StoredMail;
      expect(stored.to).toEqual(['demo@wingchunroots.test']);

      const mailbox = fileMailbox(dir);
      const message = await mailbox.waitFor('DEMO@wingchunroots.test', { subject: /Demo/, timeoutMs: 1_000 });
      expect(message).toMatchObject({ messageId: 'demo-1@wingchunroots.test', subject: 'Demo subject', text: 'Demo text' });
      expect(message.headers['x-wingchunroots-delivery']).toBe('demo-1');
      expect(await mailbox.list('other@wingchunroots.test')).toEqual([]);
      expect(await fileMailbox(path.join(dir, 'missing')).list('demo@wingchunroots.test')).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
