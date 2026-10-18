// Sealed template data (milestone M02 fix round 1): the links of account e-mails carry a token
// that confirms an address or resets a password. The outbox keeps the job payload in pgboss.job
// (and a dead-letter copy) for up to 7 days, so those fields are stored encrypted there, never in
// clear: AES-256-GCM with a key derived from MAIL_SEAL_KEY, bound to the delivery id (additional
// authenticated data), so a sealed value cannot be moved to another delivery. Only the worker
// opens it, right before rendering.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type Env = Record<string, string | undefined>;

const VERSION = 'v1';
const MIN_KEY_LENGTH = 32;

/** The sealed value cannot be opened: another key, another delivery, or changed bytes. */
export class SealError extends Error {
  constructor(message = 'the sealed template data cannot be opened') {
    super(message);
    this.name = 'SealError';
  }
}

/** MAIL_SEAL_KEY (at least 32 characters; scripts/init-env.sh, scripts/cloud-setup.sh, CI). */
export function mailSealKey(env: Env = process.env): string {
  const value = env.MAIL_SEAL_KEY;
  if (!value) throw new Error('MAIL_SEAL_KEY is not set (local: scripts/init-env.sh; cloud: scripts/cloud-setup.sh)');
  if (value.length < MIN_KEY_LENGTH) throw new Error(`MAIL_SEAL_KEY must have at least ${MIN_KEY_LENGTH} characters`);
  return value;
}

function keyBytes(key: string): Buffer {
  return createHash('sha256').update(`wcr-mail-seal:${key}`).digest();
}

/** Encrypts `fields` for the delivery `deliveryId`: `v1.<iv>.<ciphertext and tag>` in base64url. */
export function seal(fields: Record<string, unknown>, deliveryId: string, key: string = mailSealKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(deliveryId, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(fields), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/** Opens a value from seal(); throws SealError when it cannot. */
export function unseal(sealed: string, deliveryId: string, key: string = mailSealKey()): Record<string, unknown> {
  const [version, ivText, bodyText] = sealed.split('.');
  if (version !== VERSION || !ivText || !bodyText) throw new SealError('the sealed template data has an unknown format');
  try {
    const iv = Buffer.from(ivText, 'base64url');
    const body = Buffer.from(bodyText, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv);
    decipher.setAAD(Buffer.from(deliveryId, 'utf8'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
    const value: unknown = JSON.parse(plain);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SealError();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SealError) throw error;
    throw new SealError();
  }
}
