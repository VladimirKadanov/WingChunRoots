// The photo store's configuration (milestone M14; docs/adr/0016-profile-photos.md): profile photos
// never share the evidence folder or bucket, and never sit inside public/.

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_EVIDENCE_DIR, DEFAULT_MEDIA_BUCKET, DEFAULT_MEDIA_DIR, photoStorageConfig, storageConfig } from './index';

const cwd = path.resolve('/srv/wcr');
const s3 = { S3_ENDPOINT: 'http://127.0.0.1:8333', S3_ACCESS_KEY_ID: 'demo-key', S3_SECRET_ACCESS_KEY: 'demo-secret' };

describe('photoStorageConfig', () => {
  it('uses its own folder by default, apart from the evidence folder', () => {
    const photos = photoStorageConfig({}, cwd);
    const evidence = storageConfig({}, cwd);
    expect(photos).toEqual({ driver: 'filesystem', dir: path.join(cwd, DEFAULT_MEDIA_DIR) });
    expect(evidence).toEqual({ driver: 'filesystem', dir: path.join(cwd, DEFAULT_EVIDENCE_DIR) });
  });

  it('follows EVIDENCE_STORAGE unless MEDIA_STORAGE says otherwise', () => {
    expect(photoStorageConfig({ ...s3, EVIDENCE_STORAGE: 'filesystem' }, cwd).driver).toBe('filesystem');
    expect(photoStorageConfig({ ...s3 }, cwd).driver).toBe('s3');
    expect(photoStorageConfig({ ...s3, EVIDENCE_STORAGE: 'filesystem', MEDIA_STORAGE: 's3' }, cwd).driver).toBe('s3');
  });

  it('refuses a folder inside, around or equal to the evidence folder, or inside public/', () => {
    expect(() => photoStorageConfig({ MEDIA_STORAGE_DIR: '.storage/evidence' }, cwd)).toThrow(/apart from EVIDENCE_STORAGE_DIR/);
    expect(() => photoStorageConfig({ MEDIA_STORAGE_DIR: '.storage/evidence/photos' }, cwd)).toThrow(/apart from EVIDENCE_STORAGE_DIR/);
    expect(() => photoStorageConfig({ MEDIA_STORAGE_DIR: '.storage' }, cwd)).toThrow(/apart from EVIDENCE_STORAGE_DIR/);
    expect(() => photoStorageConfig({ MEDIA_STORAGE_DIR: 'public/photos' }, cwd)).toThrow(/not be inside public/);
  });

  it('uses the media bucket on S3, never the evidence bucket', () => {
    const config = photoStorageConfig({ ...s3 }, cwd);
    expect(config).toMatchObject({ driver: 's3', bucket: DEFAULT_MEDIA_BUCKET, endpoint: 'http://127.0.0.1:8333' });
    expect(() => photoStorageConfig({ ...s3, S3_BUCKET_MEDIA: 'wcr-evidence' }, cwd)).toThrow(/must differ from S3_BUCKET_EVIDENCE/);
    expect(() => photoStorageConfig({ ...s3, S3_BUCKET_EVIDENCE: 'shared', S3_BUCKET_MEDIA: 'shared' }, cwd)).toThrow(/must differ/);
  });
});
