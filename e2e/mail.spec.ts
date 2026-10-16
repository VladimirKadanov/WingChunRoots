import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { closeDb, getDb } from '../src/server/db';
import { loadDotEnv } from '../src/server/db/env';
import { stopProducer } from '../src/server/jobs/boss';
import { queueEmail } from '../src/server/jobs/outbox';
import { openMailbox } from './helpers/mailbox';

// Milestone M01b: E2E tests can read the e-mail the application sends. A service-style call queues
// an e-mail through the outbox; the worker that playwright.config.ts starts (`pnpm worker`)
// delivers it to Mailpit or to the file transport, and the mailbox helper reads it back.

test.beforeAll(() => {
  // The same settings as the web server and the worker (environment first, then .env).
  loadDotEnv(path.resolve('.env'));
});

test.afterAll(async () => {
  await stopProducer();
  await closeDb();
});

test('@M01b an e-mail queued through the outbox reaches the mailbox through the worker', async ({}, testInfo) => {
  const to = `e2e-${testInfo.project.name}-${randomUUID().slice(0, 8)}@wingchunroots.test`;
  const { deliveryId } = await getDb().transaction((tx) =>
    queueEmail(tx, {
      template: 'mail-check',
      to,
      data: { recipientNames: [{ value: 'Demo Student', lang: 'en' }, { value: '示範學生', lang: 'zh-Hant' }] },
      idempotencyKey: `e2e:mail-check:${to}`,
    }),
  );

  const message = await openMailbox().waitFor(to, { subject: 'WingChunRoots mail check', timeoutMs: 30_000 });
  expect(message.headers['x-wingchunroots-delivery']).toBe(deliveryId);
  expect(message.text).toContain('Hello Demo Student (示範學生),');
  expect(message.html).toContain('<span lang="zh-Hant" translate="no">示範學生</span>');
});
