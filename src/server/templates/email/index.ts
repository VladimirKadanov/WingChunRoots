// The e-mail templates (milestone M01b, In scope 3): the registry and the renderer that turns a
// template and its data into a subject, an HTML body and a plain-text body. English only; the
// only place with the text of e-mails (plan §6.1). Rendering runs in the worker.

import { render } from '@react-email/render';

import { accountExists } from './account-exists';
import { claimDecided } from './claim-decided';
import { finishSignUp } from './finish-sign-up';
import { instructorDecided } from './instructor-decided';
import { invitation } from './invitation';
import { mailCheck } from './mail-check';
import { relationshipApproved } from './relationship-approved';
import { relationshipArbitration } from './relationship-arbitration';
import { relationshipRejected } from './relationship-rejected';
import { relationshipRequested } from './relationship-requested';
import { resetPassword } from './reset-password';
import { reviewDecided } from './review-decided';
import { type EmailTemplate, TemplateDataError } from './types';
import { verifyEmail } from './verify-email';

export { TemplateDataError } from './types';
export type { EmailTemplate, NameData } from './types';
export type { AccountExistsData } from './account-exists';
export type { ClaimDecidedData } from './claim-decided';
export type { FinishSignUpData } from './finish-sign-up';
export type { InstructorDecidedData } from './instructor-decided';
export type { InvitationData } from './invitation';
export type { MailCheckData } from './mail-check';
export type { RelationshipApprovedData } from './relationship-approved';
export type { RelationshipArbitrationData } from './relationship-arbitration';
export type { RelationshipRejectedData } from './relationship-rejected';
export type { RelationshipRequestedData } from './relationship-requested';
export type { ResetPasswordData } from './reset-password';
export type { ReviewDecidedData } from './review-decided';
export type { VerifyEmailData } from './verify-email';

/** Every e-mail template, by name (= template.name). A new template is added here and in its own file. */
export const EMAIL_TEMPLATES = {
  'mail-check': mailCheck,
  'verify-email': verifyEmail,
  'reset-password': resetPassword,
  'finish-sign-up': finishSignUp,
  'account-exists': accountExists,
  // M09: teacher requests and their answers.
  'relationship-requested': relationshipRequested,
  'relationship-approved': relationshipApproved,
  'relationship-rejected': relationshipRejected,
  // M10a: the review committee's decision on a historical teacher claim.
  'review-decided': reviewDecided,
  // M10b: invitations and profile claims, instructor verification, arbitration.
  invitation,
  'claim-decided': claimDecided,
  'instructor-decided': instructorDecided,
  'relationship-arbitration': relationshipArbitration,
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
export type EmailTemplateData<N extends EmailTemplateName> =
  (typeof EMAIL_TEMPLATES)[N] extends EmailTemplate<infer D> ? D : never;

export function isEmailTemplateName(name: string): name is EmailTemplateName {
  return Object.hasOwn(EMAIL_TEMPLATES, name);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders `template` with untrusted `data` (JSON from the queue). Throws TemplateDataError for an
 * unknown template or data the template refuses.
 */
export async function renderEmail(template: string, data: unknown): Promise<RenderedEmail> {
  if (!isEmailTemplateName(template)) throw new TemplateDataError(template, 'unknown template');
  const definition = EMAIL_TEMPLATES[template] as EmailTemplate<unknown>;
  const parsed = definition.parse(data);
  const element = definition.render(parsed);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: definition.subject(parsed), html, text };
}
