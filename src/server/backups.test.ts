// The newest local archive for /admin/system (milestone M12): only well-formed dump names of the
// app's database count, the newest by the time in its name.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backupDir, backupSummary, backupTime, DEFAULT_BACKUP_DIR } from './backups';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wcr-backups-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('backupTime', () => {
  it('reads the UTC time in a dump name of the given database', () => {
    expect(backupTime('wingchunroots-20261101T081530Z.dump', 'wingchunroots')).toBe('2026-11-01T08:15:30.000Z');
  });

  it('refuses another database, another extension and impossible times', () => {
    expect(backupTime('other-20261101T081530Z.dump', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots_test-20261101T081530Z.dump', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots-20261101T081530Z.dump.sha256', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots-20261101T081530Z.dump.partial', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots-20261301T081530Z.dump', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots-20260230T081530Z.dump', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots-20261101T246030Z.dump', 'wingchunroots')).toBeNull();
    expect(backupTime('wingchunroots-2026-11-01.dump', 'wingchunroots')).toBeNull();
    expect(backupTime('x-20261101T081530Z.dump', 'bad name')).toBeNull();
  });
});

describe('backupSummary', () => {
  it('has nothing for an absent or empty folder', async () => {
    expect(await backupSummary(path.join(dir, 'absent'), 'wingchunroots')).toEqual({ latest: null, count: 0 });
    expect(await backupSummary(dir, 'wingchunroots')).toEqual({ latest: null, count: 0 });
  });

  it('names the newest dump of the database, its size and whether its checksum is there', async () => {
    await writeFile(path.join(dir, 'wingchunroots-20261030T020000Z.dump'), 'a');
    await writeFile(path.join(dir, 'wingchunroots-20261030T020000Z.dump.sha256'), 'x');
    await writeFile(path.join(dir, 'wingchunroots-20261101T020000Z.dump'), 'abcd');
    await writeFile(path.join(dir, 'wingchunroots-20261102T020000Z.dump.partial'), 'abcdef');
    await writeFile(path.join(dir, 'wingchunroots_test-20261103T020000Z.dump'), 'abcdefgh');
    expect(await backupSummary(dir, 'wingchunroots')).toEqual({
      latest: { file: 'wingchunroots-20261101T020000Z.dump', createdAt: '2026-11-01T02:00:00.000Z', sizeBytes: 4, hasChecksum: false },
      count: 2,
    });
    await writeFile(path.join(dir, 'wingchunroots-20261101T020000Z.dump.sha256'), 'x');
    expect((await backupSummary(dir, 'wingchunroots')).latest?.hasChecksum).toBe(true);
    expect((await backupSummary(dir, 'wingchunroots_test')).latest?.file).toBe('wingchunroots_test-20261103T020000Z.dump');
  });
});

describe('backupDir', () => {
  it('is BACKUP_DIR, else backups/ in the working directory', () => {
    expect(backupDir({}, '/srv/app')).toBe(path.resolve('/srv/app', DEFAULT_BACKUP_DIR));
    expect(backupDir({ BACKUP_DIR: '/backups' }, '/srv/app')).toBe(path.resolve('/backups'));
    expect(backupDir({ BACKUP_DIR: 'test-results/backups' }, '/srv/app')).toBe(path.resolve('/srv/app', 'test-results/backups'));
  });
});
