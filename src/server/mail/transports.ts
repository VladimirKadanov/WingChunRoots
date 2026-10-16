// Mail transports (milestone M01b, In scope 3): SMTP for Mailpit (Docker Compose, CI) and files for
// cloud sessions, which have no Docker and so no Mailpit. Both build the message with nodemailer,
// so the file transport writes exactly what SMTP would send.

import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createTransport } from 'nodemailer';

import { type MailConfig } from './config';
import type { MailMessage, MailTransport } from './types';

// Never let a message pull in a local file or a URL (nodemailer can attach either).
const SAFE = { disableFileAccess: true, disableUrlAccess: true } as const;

function nodemailerMessage(message: MailMessage) {
  return {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    messageId: message.messageId,
    headers: message.headers,
  };
}

/** SMTP, for Mailpit locally and in CI (plan §3.1). */
export function createSmtpTransport(smtpUrl: string): MailTransport {
  const url = new URL(smtpUrl);
  const secure = url.protocol === 'smtps:';
  const transporter = createTransport({
    host: url.hostname,
    port: Number(url.port || (secure ? 465 : 25)),
    secure,
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    // Bounded, so an attempt always ends well before the job expires (src/server/jobs/queues.ts).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    ...SAFE,
  });
  return {
    kind: 'smtp',
    async deliver(message) {
      const info = await transporter.sendMail(nodemailerMessage(message));
      return { messageId: info.messageId || message.messageId };
    },
    async close() {
      transporter.close();
    },
  };
}

/** What the file transport writes next to the raw message (<name>.eml), read by e2e/helpers/mailbox.ts. */
export interface StoredMail {
  messageId: string;
  date: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/**
 * Files, for cloud sessions: <dir>/<time>-<random>.eml (the raw message) and .json (the parsed
 * parts). Each file is written under a temporary name and renamed, so a reader never sees half a
 * message. The directory holds e-mail addresses: it is git-ignored and readable by its owner only.
 */
export function createFileTransport(dir: string): MailTransport {
  const builder = createTransport({ streamTransport: true, buffer: true, newline: 'unix', ...SAFE });
  return {
    kind: 'file',
    async deliver(message) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const info = await builder.sendMail(nodemailerMessage(message));
      const raw = info.message as Buffer;
      const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
      const stored: StoredMail = {
        messageId: message.messageId,
        date: new Date().toISOString(),
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      };
      await writeAtomically(path.join(dir, `${base}.eml`), raw);
      await writeAtomically(path.join(dir, `${base}.json`), `${JSON.stringify(stored, null, 2)}\n`);
      return { messageId: message.messageId };
    },
    async close() {
      builder.close();
    },
  };
}

async function writeAtomically(file: string, content: string | Buffer): Promise<void> {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, file);
}

/** The transport that `config` selects. */
export function createTransportFromConfig(config: MailConfig): MailTransport {
  return config.transport === 'smtp' ? createSmtpTransport(config.smtpUrl) : createFileTransport(config.fileDir);
}
