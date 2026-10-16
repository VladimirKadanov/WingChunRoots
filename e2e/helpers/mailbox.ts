// Reads the e-mail the application sent (milestone M01b, In scope 4), for E2E and integration tests.
//
//   MAIL_TRANSPORT=smtp  the Mailpit API (MAILPIT_URL, default http://127.0.0.1:<MAILPIT_UI_PORT or 8025>):
//                        Docker Compose locally, a service container in CI.
//   MAIL_TRANSPORT=file  the files of the file transport in MAIL_FILE_DIR (default .mail): cloud sessions.
//
// The same settings as the worker (src/server/mail/config.ts), so a test reads where the worker wrote.
// Tests use a unique fictional address (…@wingchunroots.test) per test and wait for it.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { mailConfig } from '../../src/server/mail/config';
import type { StoredMail } from '../../src/server/mail/transports';

export interface MailboxMessage {
  /** Message-ID without angle brackets. */
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Header names in lower case. */
  headers: Record<string, string>;
  date: Date;
}

export interface WaitOptions {
  subject?: string | RegExp;
  /** Default 15 s. */
  timeoutMs?: number;
  /** Default 250 ms. */
  pollMs?: number;
}

export interface Mailbox {
  readonly kind: 'smtp' | 'file';
  /** Every message to `to` (case-insensitive), newest first. */
  list(to: string): Promise<MailboxMessage[]>;
  /** The newest message to `to` that matches; waits for it until the timeout. */
  waitFor(to: string, options?: WaitOptions): Promise<MailboxMessage>;
}

type Env = Record<string, string | undefined>;

const bare = (messageId: string) => messageId.trim().replace(/^<|>$/g, '');
const lowerKeys = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function matches(message: MailboxMessage, subject: WaitOptions['subject']): boolean {
  if (subject === undefined) return true;
  return typeof subject === 'string' ? message.subject === subject : subject.test(message.subject);
}

function withWait(kind: Mailbox['kind'], list: Mailbox['list']): Mailbox {
  return {
    kind,
    list,
    async waitFor(to, { subject, timeoutMs = 15_000, pollMs = 250 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = (await list(to)).find((m) => matches(m, subject));
        if (found) return found;
        if (Date.now() >= deadline) {
          throw new Error(`mailbox (${kind}): no message to ${to}${subject ? ` with subject ${String(subject)}` : ''} within ${timeoutMs} ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}

/** The Mailpit API at `baseUrl`. */
export function mailpitMailbox(baseUrl: string): Mailbox {
  const api = (route: string) => new URL(`/api/v1/${route}`, baseUrl);
  async function get<T>(route: string): Promise<T> {
    const response = await fetch(api(route));
    if (!response.ok) throw new Error(`Mailpit ${route}: HTTP ${response.status}`);
    return (await response.json()) as T;
  }
  type Address = { Name: string; Address: string };
  type Summary = { ID: string };
  type Message = { MessageID: string; From: Address; To: Address[]; Subject: string; Text: string; HTML: string; Date: string };

  return withWait('smtp', async (to) => {
    const search = await get<{ messages: Summary[] }>(`search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const messages = await Promise.all(
      search.messages.map(async ({ ID }) => {
        const [m, headers] = await Promise.all([
          get<Message>(`message/${ID}`),
          get<Record<string, string[]>>(`message/${ID}/headers`),
        ]);
        return {
          messageId: bare(m.MessageID),
          from: m.From.Name ? `${m.From.Name} <${m.From.Address}>` : m.From.Address,
          to: m.To.map((a) => a.Address),
          subject: m.Subject,
          text: m.Text,
          html: m.HTML,
          headers: lowerKeys(Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.join(', ')]))),
          date: new Date(m.Date),
        } satisfies MailboxMessage;
      }),
    );
    // The search matches substrings; keep exact recipients only.
    return messages.filter((m) => m.to.some((a) => sameAddress(a, to))).sort((a, b) => b.date.getTime() - a.date.getTime());
  });
}

/** The .json files of the file transport in `dir`. */
export function fileMailbox(dir: string): Mailbox {
  return withWait('file', async (to) => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const messages = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const stored = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as StoredMail;
          return {
            messageId: bare(stored.messageId),
            from: stored.from,
            to: stored.to,
            subject: stored.subject,
            text: stored.text,
            html: stored.html,
            headers: lowerKeys(stored.headers),
            date: new Date(stored.date),
          } satisfies MailboxMessage;
        }),
    );
    return messages.filter((m) => m.to.some((a) => sameAddress(a, to))).sort((a, b) => b.date.getTime() - a.date.getTime());
  });
}

/** The mailbox the current settings point at (the worker's MAIL_TRANSPORT). */
export function openMailbox(env: Env = process.env): Mailbox {
  const config = mailConfig(env);
  if (config.transport === 'smtp') {
    return mailpitMailbox(env.MAILPIT_URL || `http://127.0.0.1:${env.MAILPIT_UI_PORT || 8025}`);
  }
  return fileMailbox(config.fileDir);
}
