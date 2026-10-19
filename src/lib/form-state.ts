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

/** The ids focus moves to after a submit (src/components/account/fields.tsx). */
export const summaryId = (form: string) => `${form}-summary`;
export const messageId = (form: string) => `${form}-message`;
export const doneId = (form: string) => `${form}-done`;

/**
 * The element that shows `state` in a form whose id is `form` (src/components/account/fields.tsx):
 * the error summary of a form of several fields, the one invalid field of a form of one field
 * (`single`), or the form's message. A post without JavaScript comes back to it (the `anchor` of
 * src/server/forms/flash.ts), so `form` must be a fixed id there, not one from useFormId().
 */
export function outcomeTarget(form: string, state: FormState, single: boolean): string {
  const invalid = state.status === 'error' ? Object.keys(state.fields ?? {}) : [];
  if (invalid[0]) return single ? fieldId(form, invalid[0]) : summaryId(form);
  return messageId(form);
}

/**
 * A link (an address confirmation, a password reset) that cannot be used any more: expired, used,
 * or issued before a newer password. The page then says so and offers a new link in its place.
 */
export function isRefusedLink(state: FormState | null | undefined): state is FormState & { status: 'error' } {
  return state?.status === 'error' && state.values?.link === 'refused';
}
