// What the TOTP setup shows (milestone M02, /account/security): the QR code of the otpauth:// URI
// that Better Auth's /two-factor/enable returns, the same secret as text for typing it in, and the
// backup codes. Computed on the server, inside the Server Action; nothing here is stored or logged.

import { encode } from 'uqr';

import type { QrModules } from '../../lib/qr';

export interface TotpSetupView {
  /** otpauth://totp/... for a tap on a phone that has an authenticator app. */
  uri: string;
  qr: QrModules;
  /** The base32 secret in groups of four, as authenticator apps accept it typed in. */
  secret: string;
  backupCodes: string[];
}

export function qrModules(value: string): QrModules {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  let path = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { path, size };
}

export function totpSetupView(totpURI: string, backupCodes: readonly string[]): TotpSetupView {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  return {
    uri: totpURI,
    qr: qrModules(totpURI),
    secret: secret.replace(/=+$/, '').match(/.{1,4}/g)?.join(' ') ?? '',
    backupCodes: [...backupCodes],
  };
}
