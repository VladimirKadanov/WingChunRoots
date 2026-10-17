// The state a Server Action of the account forms returns (milestone M02): a form-level message,
// a message per field, and the submitted values that the form shows again (never a password).
// The same object renders the page after a submit without JavaScript (progressive enhancement).

export interface FormState {
  status: 'idle' | 'error' | 'done';
  /** A message for the whole form: an error, or what happened. */
  message?: string;
  /** Field name → error message. */
  fields?: Record<string, string>;
  /** Submitted values to show again; never passwords or codes. */
  values?: Record<string, string>;
  /** Extra data for the form after success (for example the TOTP setup). */
  data?: Record<string, unknown>;
}

export const IDLE: FormState = { status: 'idle' };

/** The id of a field's input, shared by the field and the focus handling. */
export const fieldId = (form: string, name: string) => `${form}-${name}`;
