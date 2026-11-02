// Where evidence is stored (milestone M10a; plan §6.1, §6.4), from the environment (names only in
// .env.example; plan §7.7):
//
//   EVIDENCE_STORAGE      `filesystem` or `s3`. Default: `s3` when S3_ENDPOINT is set, otherwise
//                         `filesystem` (cloud sessions have no Docker, so no SeaweedFS).
//   EVIDENCE_STORAGE_DIR  the private folder of the filesystem driver (default .storage/evidence,
//                         from the current directory, which is the repository root for every pnpm
//                         script). Git-ignored, and never inside public/.
//   S3_ENDPOINT           the S3 service, for example http://127.0.0.1:8333 (the SeaweedFS of
//                         docker-compose.yml). Phase 1 has no cloud storage (plan §3.3), so the host
//                         must be local: a loopback address, `localhost` or the Compose service
//                         name `seaweedfs`.
//   S3_REGION             default us-east-1 (SeaweedFS ignores it; the signature needs one).
//   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   the local SeaweedFS identity (scripts/init-env.sh).
//   S3_BUCKET_EVIDENCE    the private evidence bucket (default wcr-evidence).
//
// M14 (docs/adr/0016-profile-photos.md): profile photos live in a store of their own, the photo
// store, never in the evidence bucket or folder (evidence stays private, plan §6.4):
//
//   MEDIA_STORAGE         `filesystem` or `s3`. Default: EVIDENCE_STORAGE when it is set, otherwise
//                         `s3` when S3_ENDPOINT is set, otherwise `filesystem`.
//   MEDIA_STORAGE_DIR     the folder of the filesystem driver (default .storage/photos). Never inside
//                         public/ (photos are served only through GET /api/photos/..., which checks
//                         that the person is visible) and never inside or around the evidence folder.
//   S3_BUCKET_MEDIA       the media bucket (default wcr-media), never the evidence bucket.
//
// The messages never quote a value: the credentials are secrets and the endpoint may carry them.
//
// DEFAULT D13: evidence lives in its own private bucket (S3_BUCKET_EVIDENCE) or private folder,
// apart from the public media bucket (S3_BUCKET_MEDIA, from M11) and never counted against the
// media quotas of a plan; nothing here ever signs a GET for a browser.

import path from 'node:path';

import { filesystemStore } from './fs';
import { type S3Config, s3Store } from './s3';
import type { ObjectStore } from './types';

export type { GetOptions, ObjectStore, PutOptions, StoredObject } from './types';
export { isStorageKey, newStorageKey, StorageError } from './types';

type Env = Record<string, string | undefined>;

export const DEFAULT_EVIDENCE_DIR = path.join('.storage', 'evidence');
export const DEFAULT_EVIDENCE_BUCKET = 'wcr-evidence';
export const DEFAULT_MEDIA_DIR = path.join('.storage', 'photos');
export const DEFAULT_MEDIA_BUCKET = 'wcr-media';
export const DEFAULT_S3_REGION = 'us-east-1';

export type StorageConfig = { driver: 'filesystem'; dir: string } | ({ driver: 's3' } & S3Config);

/** The hosts S3_ENDPOINT may name in Phase 1: the local SeaweedFS (plan §3.3). */
export function isLocalStorageHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === 'seaweedfs' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** Whether `dir` lies inside the app's public/ folder, which Next.js serves to everyone. */
function insidePublic(dir: string, cwd: string): boolean {
  const relative = path.relative(path.resolve(cwd, 'public'), dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function storageConfig(env: Env = process.env, cwd: string = process.cwd()): StorageConfig {
  const endpoint = (env.S3_ENDPOINT ?? '').trim();
  const driver = (env.EVIDENCE_STORAGE || (endpoint ? 's3' : 'filesystem')).trim();
  if (driver === 'filesystem') {
    const dir = path.resolve(cwd, env.EVIDENCE_STORAGE_DIR || DEFAULT_EVIDENCE_DIR);
    if (insidePublic(dir, cwd)) throw new Error('EVIDENCE_STORAGE_DIR must not be inside public/: evidence is private (plan §6.4)');
    return { driver, dir };
  }
  if (driver !== 's3') throw new Error('EVIDENCE_STORAGE must be filesystem or s3');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('S3_ENDPOINT is not a valid http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('S3_ENDPOINT must start with http:// or https://');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('S3_ENDPOINT must be an origin only (scheme, host and port), with the credentials in S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  if (!isLocalStorageHost(url.hostname)) {
    throw new Error('S3_ENDPOINT must point at the local SeaweedFS in Phase 1 (plan §3.3): a loopback address, localhost or seaweedfs');
  }
  const accessKeyId = env.S3_ACCESS_KEY_ID ?? '';
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY ?? '';
  if (!accessKeyId || !secretAccessKey) throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with the s3 evidence store');
  return {
    driver: 's3',
    endpoint: url.origin,
    region: env.S3_REGION || DEFAULT_S3_REGION,
    bucket: env.S3_BUCKET_EVIDENCE || DEFAULT_EVIDENCE_BUCKET,
    accessKeyId,
    secretAccessKey,
  };
}

/** Whether one of the two folders lies inside the other (or they are the same). */
function nested(a: string, b: string): boolean {
  const inside = (dir: string, parent: string) => {
    const relative = path.relative(parent, dir);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  return inside(a, b) || inside(b, a);
}

/**
 * M14: where profile photos are stored (see the top of this file). Never the evidence folder or
 * bucket: a photo is public data of a public person, evidence is private.
 */
export function photoStorageConfig(env: Env = process.env, cwd: string = process.cwd()): StorageConfig {
  const endpoint = (env.S3_ENDPOINT ?? '').trim();
  const driver = (env.MEDIA_STORAGE || env.EVIDENCE_STORAGE || (endpoint ? 's3' : 'filesystem')).trim();
  if (driver === 'filesystem') {
    const dir = path.resolve(cwd, env.MEDIA_STORAGE_DIR || DEFAULT_MEDIA_DIR);
    if (insidePublic(dir, cwd)) throw new Error('MEDIA_STORAGE_DIR must not be inside public/: photos are served only after the visibility check');
    const evidenceDir = path.resolve(cwd, env.EVIDENCE_STORAGE_DIR || DEFAULT_EVIDENCE_DIR);
    if (nested(dir, evidenceDir)) throw new Error('MEDIA_STORAGE_DIR must be apart from EVIDENCE_STORAGE_DIR: evidence stays private (plan §6.4)');
    return { driver, dir };
  }
  if (driver !== 's3') throw new Error('MEDIA_STORAGE must be filesystem or s3');
  // The same endpoint and identity as evidence, checked the same way; only the bucket differs.
  const evidence = storageConfig({ ...env, EVIDENCE_STORAGE: 's3' }, cwd);
  if (evidence.driver !== 's3') throw new Error('MEDIA_STORAGE must be filesystem or s3');
  const bucket = env.S3_BUCKET_MEDIA || DEFAULT_MEDIA_BUCKET;
  if (bucket === evidence.bucket) throw new Error('S3_BUCKET_MEDIA must differ from S3_BUCKET_EVIDENCE: evidence stays private (plan §6.4)');
  return { ...evidence, bucket };
}

export function createObjectStore(config: StorageConfig): ObjectStore {
  return config.driver === 'filesystem' ? filesystemStore(config.dir) : s3Store(config);
}

let evidenceStore: ObjectStore | undefined;

/** The store of evidence files for this process, from the environment (read once). */
export function getEvidenceStore(): ObjectStore {
  evidenceStore ??= createObjectStore(storageConfig());
  return evidenceStore;
}

let photoStore: ObjectStore | undefined;

/** M14: the store of profile photos for this process, from the environment (read once). */
export function getPhotoStore(): ObjectStore {
  photoStore ??= createObjectStore(photoStorageConfig());
  return photoStore;
}
