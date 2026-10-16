// Mail (plan §6.1; milestone M01b): the Mailer interface, its transports and their settings.

export { mailConfig, type MailConfig, DEFAULT_MAIL_FROM, DEFAULT_MAIL_FILE_DIR, DEFAULT_SMTP_URL } from './config';
export {
  checkAddress,
  checkIdempotencyKey,
  createMailer,
  describeError,
  MailBusyError,
  MailDeliveryError,
  MailInputError,
  redactAddresses,
} from './mailer';
export { createFileTransport, createSmtpTransport, createTransportFromConfig, type StoredMail } from './transports';
export type { Mailer, MailMessage, MailTransport, MailTransportKind, SendInput, SendResult } from './types';
