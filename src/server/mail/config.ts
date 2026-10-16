// Mail settings from the environment (names only in .env.example; plan §7.7).
//
//   MAIL_TRANSPORT  `smtp` (Mailpit: Docker Compose and CI) or `file` (cloud sessions). Default
//                   `file`: without explicit settings no e-mail leaves the machine.
//   SMTP_URL        smtp://host:port of the SMTP server (default smtp://127.0.0.1:<MAILPIT_SMTP_PORT
//                   or 1025>, the Mailpit of docker-compose.yml).
//   MAIL_FILE_DIR   directory of the file transport (default .mail, from the current directory,
//                   which is the repository root for every pnpm script). Git-ignored.
//   MAIL_FROM       sender address (default WingChunRoots <no-reply@wingchunroots.test>; .test is
//                   reserved and never routable).

import path from 'node:path';

import type { MailTransportKind } from './types';

export interface MailConfig {
  transport: MailTransportKind;
  smtpUrl: string;
  fileDir: string;
  from: string;
}

type Env = Record<string, string | undefined>;

export const DEFAULT_SMTP_PORT = '1025';
export const DEFAULT_MAIL_FILE_DIR = '.mail';
export const DEFAULT_MAIL_FROM = 'WingChunRoots <no-reply@wingchunroots.test>';

export function mailConfig(env: Env = process.env): MailConfig {
  const transport = (env.MAIL_TRANSPORT || 'file').trim();
  if (transport !== 'smtp' && transport !== 'file') {
    throw new Error(`MAIL_TRANSPORT must be smtp or file, not ${JSON.stringify(transport)}`);
  }
  const smtpUrl = env.SMTP_URL || `smtp://127.0.0.1:${env.MAILPIT_SMTP_PORT || DEFAULT_SMTP_PORT}`;
  if (transport === 'smtp' && !/^smtps?:\/\//.test(smtpUrl)) {
    throw new Error('SMTP_URL must start with smtp:// or smtps://');
  }
  return {
    transport,
    smtpUrl,
    fileDir: path.resolve(env.MAIL_FILE_DIR || DEFAULT_MAIL_FILE_DIR),
    from: env.MAIL_FROM || DEFAULT_MAIL_FROM,
  };
}
