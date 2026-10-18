// The English messages of the account forms for Better Auth's error codes (milestone M02). Plain
// data, so the Server Actions and the forms share it. Calm wording: no urgency, no blame.

export const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'The e-mail address or the password is not right.',
  INVALID_EMAIL: 'Enter a valid e-mail address, for example name@example.com.',
  INVALID_PASSWORD: 'The password is not right.',
  PASSWORD_TOO_SHORT: 'Use at least 12 characters.',
  PASSWORD_TOO_LONG: 'Use at most 128 characters.',
  EMAIL_NOT_VERIFIED: 'Confirm your e-mail address first. We sent you a new link.',
  INVALID_TOKEN: 'The link has expired or was already used. Ask for a new one below.',
  TOKEN_EXPIRED: 'The link has expired. Ask for a new one below.',
  INVALID_CODE: 'That code is not right. Codes change every 30 seconds; try the current one.',
  INVALID_BACKUP_CODE: 'That backup code is not right, or it was already used.',
  INVALID_TWO_FACTOR_COOKIE: 'Your sign-in waited too long. Sign in again.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Too many attempts. Sign in again to get a new chance.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Too many wrong codes. Wait 15 minutes, then try again.',
  CODE_ALREADY_USED: 'This code has just been used. Wait for the next code in your app.',
  TOO_MANY_ATTEMPTS: 'Too many failed sign-ins for this address. Wait 15 minutes, or choose a new password.',
  TOTP_NOT_ENABLED: 'Two-factor authentication is not set up for this account.',
  CONSENT_REQUIRED: 'Confirm that you are 18 or older and accept the terms and the authenticity declaration.',
  STAFF_NEEDS_TWO_FACTOR: 'A staff account keeps two-factor authentication on.',
  BANNED_USER: 'This account is suspended. Write to the pilot team if you think this is a mistake.',
  HTTP_429: 'Too many attempts from this connection. Wait a minute, then try again.',
};

export const FALLBACK_MESSAGE = 'Something went wrong on our side. Try again in a moment.';

export function authMessage(code: string | null | undefined): string {
  return (code && AUTH_MESSAGES[code]) || FALLBACK_MESSAGE;
}
