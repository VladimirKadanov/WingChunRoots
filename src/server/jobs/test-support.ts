// Helpers for the integration tests of the jobs and the mail path (src/server/jobs/*.int.test.ts).

import type { PgBoss } from 'pg-boss';

import { createRoleDatabase, type Database } from '../db';
import { rolePassword } from '../db/env';
import type { TestDatabase } from '../db/testing';
import { createMailer } from '../mail/mailer';
import type { MailMessage, MailTransport } from '../mail/types';
import { createBoss } from './boss';
import type { QueueName, QueueOptions } from './queues';
import { type RunningWorker, startWorker } from './worker';

/** A transport that records every attempt and fails when `fail(message, attempt)` says so. */
export interface RecordingTransport extends MailTransport {
  /** Every attempt, in order, with its outcome. */
  attempts: Array<{ to: string; ok: boolean }>;
  delivered: MailMessage[];
}

export function recordingTransport(fail: (message: MailMessage, attempt: number) => boolean = () => false): RecordingTransport {
  const attempts: RecordingTransport['attempts'] = [];
  const delivered: MailMessage[] = [];
  return {
    kind: 'file',
    attempts,
    delivered,
    async deliver(message) {
      const attempt = attempts.filter((a) => a.to === message.to).length + 1;
      if (fail(message, attempt)) {
        attempts.push({ to: message.to, ok: false });
        // Like an SMTP rejection, with the address in the text (the Mailer must remove it).
        throw Object.assign(new Error(`550 mailbox unavailable: ${message.to}`), { code: 'EENVELOPE', responseCode: 550 });
      }
      attempts.push({ to: message.to, ok: true });
      delivered.push(message);
      return { messageId: message.messageId };
    },
    async close() {},
  };
}

export interface TestWorker {
  /** The app_rw database the worker uses. */
  db: Database;
  boss: PgBoss;
  worker: RunningWorker;
  stop(): Promise<void>;
}

/** Fast retries for the tests: 3 attempts, about 1 s apart (backoff capped at 1 s). */
export const FAST_RETRIES: Partial<Record<QueueName, Partial<QueueOptions>>> = {
  'email.send': { retryLimit: 2, retryDelay: 1, retryBackoff: true, retryDelayMax: 1 },
};

/** Starts the worker in-process against `testDb`, connected as app_rw. */
export async function startTestWorker(
  testDb: TestDatabase,
  transport: MailTransport,
  queueOptions: Partial<Record<QueueName, Partial<QueueOptions>>> = FAST_RETRIES,
): Promise<TestWorker> {
  const db = createRoleDatabase('app_rw', testDb.url, rolePassword('app_rw'));
  const boss = createBoss({ connectionString: testDb.roleUrl('app_rw'), kind: 'worker' });
  const lines: string[] = [];
  const worker = await startWorker({
    boss,
    db,
    mailer: createMailer({ db, transport, from: 'WingChunRoots <no-reply@wingchunroots.test>' }),
    queueOptions,
    pollingIntervalSeconds: 0.5,
    schedules: false,
    log: (line) => lines.push(line),
  });
  return {
    db,
    boss,
    worker,
    async stop() {
      await worker.stop();
      await db.$client.end();
    },
  };
}

/** Polls `check` until it returns a value other than undefined, or fails after `timeoutMs`. */
export async function eventually<T>(check: () => Promise<T | undefined>, timeoutMs = 20_000, what = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** A unique fictional address for one test (D20). */
export function testAddress(label: string): string {
  return `${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}@wingchunroots.test`;
}
