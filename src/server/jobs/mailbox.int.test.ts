// Milestone M01b, Done when 2 (mailbox.int.test.ts): an e-mail sent through the worker is read back
// by e2e/helpers/mailbox.ts. The transport is the one the environment selects, then .env (like the
// worker and scripts/verify.sh): Mailpit over SMTP when MAIL_TRANSPORT=smtp (CI, Docker Compose after
// scripts/init-env.sh), otherwise the file transport in a temporary directory (cloud sessions).

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openMailbox } from '../../../e2e/helpers/mailbox';
import { repoRoot } from '../db/admin';
import { loadDotEnv } from '../db/dotenv';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { createTransportFromConfig, mailConfig } from '../mail';
import { queueEmail } from './outbox';
import { startTestWorker, testAddress, type TestWorker } from './test-support';

// Before the transport is chosen: with MAIL_TRANSPORT=smtp only in .env (the local setup), a direct
// `pnpm test:int` must test Mailpit, not the file transport.
loadDotEnv(path.join(repoRoot(), '.env'));
const transport = mailConfig().transport;

let testDb: TestDatabase;
let w: TestWorker;
let fileDir: string | undefined;
let env: Record<string, string | undefined>;

beforeAll(async () => {
  env = { ...process.env };
  if (transport === 'file') {
    fileDir = await mkdtemp(path.join(tmpdir(), 'wcr-mail-'));
    env.MAIL_FILE_DIR = fileDir;
  }
  testDb = await createTestDatabase();
  w = await startTestWorker(testDb, createTransportFromConfig(mailConfig(env)));
});

afterAll(async () => {
  await w?.stop();
  await testDb?.drop();
  if (fileDir) await rm(fileDir, { recursive: true, force: true });
});

describe(`the mailbox helper (${transport === 'smtp' ? 'Mailpit' : 'file transport'})`, () => {
  it('reads an e-mail that the worker sent', async () => {
    const to = testAddress('mailbox');
    const { deliveryId } = await w.db.transaction((tx) =>
      queueEmail(
        tx,
        {
          template: 'mail-check',
          to,
          data: { recipientNames: [{ value: 'Demo Student', lang: 'en' }, { value: '示範學生', lang: 'zh-Hant' }] },
          idempotencyKey: `test:mailbox:${randomUUID()}`,
        },
        w.boss,
      ),
    );

    const mailbox = openMailbox(env);
    expect(mailbox.kind).toBe(transport);
    const message = await mailbox.waitFor(to, { subject: 'WingChunRoots mail check', timeoutMs: 20_000 });
    expect(message.to).toEqual([to]);
    expect(message.from).toContain('no-reply@wingchunroots.test');
    expect(message.messageId).toBe(`${deliveryId}@wingchunroots.test`);
    expect(message.headers['x-wingchunroots-delivery']).toBe(deliveryId);
    expect(message.headers['auto-submitted']).toBe('auto-generated');
    expect(message.text).toContain('Hello Demo Student (示範學生),');
    expect(message.html).toContain('<span lang="zh-Hant" translate="no">示範學生</span>');

    // Only that recipient's mail: another address sees nothing.
    expect(await mailbox.list(testAddress('nobody'))).toEqual([]);
    await expect(mailbox.waitFor(testAddress('nobody'), { timeoutMs: 300 })).rejects.toThrow(/no message to/);
  });
});
