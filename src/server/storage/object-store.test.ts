// The ObjectStore contract (milestone M10a, In scope 2) against both drivers: the filesystem
// driver always, in a private temporary folder; the S3 driver when S3_ENDPOINT is configured
// (SeaweedFS in Docker Compose, and in CI, where .github/workflows/ci.yml starts it). The S3 run
// also checks that the bucket is private: an unsigned GET of an object is refused.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createObjectStore, isLocalStorageHost, newStorageKey, storageConfig } from './index';
import { filesystemStore } from './fs';
import { objectStoreContract, s3ContractTarget } from './object-store.contract';

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

describe('where the S3 contract runs (M10a review, requirements-4)', () => {
  const dotenv = ['S3_ENDPOINT=http://127.0.0.1:8333', 'S3_ACCESS_KEY_ID=demo-key', 'S3_SECRET_ACCESS_KEY=demo-secret-value', 'S3_BUCKET_EVIDENCE=wcr-evidence', ''].join('\n');

  it('reads the S3 settings from .env when the environment has none, as `next start` and the E2E tests do', () => {
    expect(s3ContractTarget({}, dotenv)).toEqual({
      config: { driver: 's3', endpoint: 'http://127.0.0.1:8333', region: 'us-east-1', bucket: 'wcr-evidence', accessKeyId: 'demo-key', secretAccessKey: 'demo-secret-value' },
    });
  });

  it('lets the environment win over .env (CI sets its own)', () => {
    const target = s3ContractTarget({ S3_ENDPOINT: 'http://seaweedfs:8333', S3_BUCKET_EVIDENCE: 'ci-evidence' }, dotenv);
    expect(target).toMatchObject({ config: { endpoint: 'http://seaweedfs:8333', bucket: 'ci-evidence', accessKeyId: 'demo-key' } });
  });

  it('says why the S3 run does not happen: no endpoint anywhere, or the filesystem driver chosen', () => {
    expect(s3ContractTarget({}, null)).toEqual({ skip: 'S3_ENDPOINT is set neither in the environment nor in .env' });
    expect(s3ContractTarget({}, 'APP_URL=http://localhost:3000\n')).toEqual({ skip: 'S3_ENDPOINT is set neither in the environment nor in .env' });
    expect(s3ContractTarget({ EVIDENCE_STORAGE: 'filesystem' }, dotenv)).toEqual({ skip: 'EVIDENCE_STORAGE=filesystem chooses the filesystem driver' });
  });

  it('fails loudly on incomplete settings instead of skipping, and never quotes a secret', () => {
    expect(() => s3ContractTarget({}, 'S3_ENDPOINT=http://127.0.0.1:8333\n')).toThrow(/S3_ACCESS_KEY_ID/);
    let message = '';
    try {
      s3ContractTarget({ S3_ENDPOINT: 'https://s3.example.com' }, dotenv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/local SeaweedFS/);
    expect(message).not.toContain('demo-secret-value');
  });
});

// The S3 driver where an endpoint is configured, in the environment or in .env (Docker Compose
// locally with scripts/init-env.sh, the SeaweedFS step in CI). Elsewhere (a cloud session has no
// Docker) the run is reported as skipped with its reason, never as a pass.
const dotenvPath = path.resolve('.env');
const target = s3ContractTarget(process.env, existsSync(dotenvPath) ? readFileSync(dotenvPath, 'utf8') : null);
if ('config' in target) {
  const s3 = target.config;
  objectStoreContract('s3 (SeaweedFS)', () => createObjectStore(s3), {
    anonymousGet: async (key) => (await fetch(`${s3.endpoint}/${s3.bucket}/${key}`)).status,
  });
} else {
  describe('ObjectStore contract: s3 (SeaweedFS)', () => {
    it.skip(`not run here: ${target.skip}; the filesystem contract above ran`, () => undefined);
  });
}
