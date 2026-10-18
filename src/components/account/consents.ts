// The wording of the sign-up confirmations (milestone M02, In scope 4). Plain data shared by the
// sign-up page, the onboarding page (when a confirmation is missing for the current documents)
// and the Server Actions' field errors. None of them is ever ticked in advance.
// DEFAULT D10: the pilot is for adults only; the age is confirmed with a tick, never a birth date
// (DEFAULT D16).

export type ConsentName = 'age_18_plus' | 'terms' | 'authenticity_declaration' | 'privacy_ack';

/** The order of the ticks on the form. */
export const CONSENT_ORDER: readonly ConsentName[] = ['age_18_plus', 'terms', 'authenticity_declaration', 'privacy_ack'];

export const CONSENT_LABELS: Record<ConsentName, string> = {
  age_18_plus: 'I am 18 or older.',
  terms: 'I accept the terms of use.',
  authenticity_declaration:
    'I will record only what I believe to be true, and I will not claim a teacher, a student or a rank that is not mine.',
  privacy_ack: 'I have read the privacy notice.',
};

/** The message under a required tick that was left empty. */
export const CONSENT_REQUIRED_MESSAGES: Record<ConsentName, string> = {
  age_18_plus: 'The pilot is open to adults only. Tick this box if you are 18 or older.',
  terms: 'Accept the terms of use to create an account.',
  authenticity_declaration: 'Agree to record only what you believe to be true to create an account.',
  privacy_ack: 'Tick this box to confirm that you have read the privacy notice.',
};

/**
 * The same for an account that already exists (fix round 3, screens-3): /onboarding asks for a tick
 * that is missing, and the tick does not create an account there.
 */
export const CONSENT_CONTINUE_MESSAGES: Record<ConsentName, string> = {
  age_18_plus: CONSENT_REQUIRED_MESSAGES.age_18_plus,
  terms: 'Accept the terms of use to continue.',
  authenticity_declaration: 'Agree to record only what you believe to be true to continue.',
  privacy_ack: CONSENT_REQUIRED_MESSAGES.privacy_ack,
};

/** The same for the confirmation of a new version of the documents (an account with a profile). */
export const CONSENT_NEW_VERSION_MESSAGES: Record<ConsentName, string> = {
  ...CONSENT_CONTINUE_MESSAGES,
  terms: 'Accept the updated terms of use to continue.',
  privacy_ack: 'Tick this box to confirm that you have read the updated privacy notice.',
};
