// The state a Server Action of the account forms returns (milestone M02): a form-level message,
// a message per field, and the submitted values that the form shows again (never a password).
// After a submit without JavaScript the page gets the same object back (src/server/forms/flash.ts).

export interface FormState {
  status: 'idle' | 'error' | 'done';
  /** A message for the whole form: an error, or what happened. */
  message?: string;
  /** Field name → error message. */
  fields?: Record<string, string>;
  /** Submitted values to show again; never passwords or codes. */
  values?: Record<string, string>;
}

export const IDLE: FormState = { status: 'idle' };

/** The id of a field's input, shared by the field and the focus handling. */
export const fieldId = (form: string, name: string) => `${form}-${name}`;

/**
 * A link (an address confirmation, a password reset) that cannot be used any more: expired, used,
 * or issued before a newer password. The page then says so and offers a new link in its place.
 */
export function isRefusedLink(state: FormState | null | undefined): state is FormState & { status: 'error' } {
  return state?.status === 'error' && state.values?.link === 'refused';
}
