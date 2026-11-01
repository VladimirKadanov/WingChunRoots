// The ObjectStore contract (milestone M10a, In scope 2) against both drivers: the filesystem
// driver always, in a private temporary folder; the S3 driver when S3_ENDPOINT is configured
// (SeaweedFS in Docker Compose, and in CI, where .github/workflows/ci.yml starts it). The S3 run
// also checks that the bucket is private: an unsigned GET of an object is refused.

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createObjectStore, isLocalStorageHost, newStorageKey, storageConfig } from './index';
import { filesystemStore } from './fs';
import { objectStoreContract } from './object-store.contract';

const root = mkdtempSync(path.join(tmpdir(), 'wcr-evidence-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

objectStoreContract('filesystem', () => filesystemStore(root));

describe('the filesystem driver', () => {
  it('writes files only the server account can read (0600) in folders only it can open (0700)', async () => {
    const store = filesystemStore(root);
    const key = newStorageKey('modes');
    await store.put(key, new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' });
    const file = path.join(root, ...key.split('/'));
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    await store.delete(key);
  });
});

describe('storageConfig', () => {
  it('uses the filesystem without an S3 endpoint, in .storage/evidence by default', () => {
    expect(storageConfig({}, '/srv/app')).toEqual({ driver: 'filesystem', dir: path.resolve('/srv/app/.storage/evidence') });
  });

  it('refuses a private folder inside public/', () => {
    expect(() => storageConfig({ EVIDENCE_STORAGE_DIR: 'public/evidence' }, '/srv/app')).toThrow(/public/);
    expect(() => storageConfig({ EVIDENCE_STORAGE_DIR: 'public' }, '/srv/app')).toThrow(/public/);
    expect(storageConfig({ EVIDENCE_STORAGE_DIR: 'publicity' }, '/srv/app')).toMatchObject({ driver: 'filesystem' });
  });

  it('uses S3 with an endpoint, only a local one in Phase 1, with the credentials and never quoting them', () => {
    const env = { S3_ENDPOINT: 'http://127.0.0.1:8333', S3_ACCESS_KEY_ID: 'demo-key', S3_SECRET_ACCESS_KEY: 'demo-secret-value' };
    expect(storageConfig(env)).toMatchObject({ driver: 's3', endpoint: 'http://127.0.0.1:8333', bucket: 'wcr-evidence', region: 'us-east-1' });
    expect(storageConfig({ ...env, S3_ENDPOINT: 'http://seaweedfs:8333' })).toMatchObject({ driver: 's3' });
    for (const endpoint of ['https://s3.amazonaws.com', 'http://demo-key:demo-secret-value@127.0.0.1:8333', 'http://127.0.0.1:8333/bucket', 'ftp://127.0.0.1']) {
      let message = '';
      try {
        storageConfig({ ...env, S3_ENDPOINT: endpoint });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, endpoint).not.toBe('');
      expect(message).not.toContain('demo-secret-value');
    }
    expect(() => storageConfig({ S3_ENDPOINT: 'http://127.0.0.1:8333' })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(isLocalStorageHost('[::1]')).toBe(true);
    expect(isLocalStorageHost('example.com')).toBe(false);
  });
});

// The S3 driver, when an endpoint is configured (Docker Compose locally, the SeaweedFS step in CI).
const s3 = process.env.S3_ENDPOINT ? storageConfig({ ...process.env, EVIDENCE_STORAGE: 's3' }) : null;
if (s3 && s3.driver === 's3') {
  objectStoreContract('s3 (SeaweedFS)', () => createObjectStore(s3), {
    anonymousGet: async (key) => (await fetch(`${s3.endpoint}/${s3.bucket}/${key}`)).status,
  });
} else {
  describe('ObjectStore contract: s3 (SeaweedFS)', () => {
    it('runs where S3_ENDPOINT is configured (Docker Compose, CI); this environment has none', () => {
      expect(process.env.S3_ENDPOINT ?? '').toBe('');
    });
  });
}
