// Limits of the account forms, shared by Better Auth (src/server/auth/config.ts), the Server
// Actions and the forms' hints (milestone M02).

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const TOTP_DIGITS = 6;
/** The longest e-mail address (RFC 5321 path limit). */
export const EMAIL_MAX_LENGTH = 254;
