// Reading the fields of a submitted form in a Server Action (milestone M02). FormData values are
// strings or files; these helpers return plain strings, so an action never trusts a File where it
// expects text, and keep the values the form shows again after an error.

import { EMAIL_MAX_LENGTH } from './account-limits';

/** A text field, trimmed; '' when missing or not text. */
export function textValue(form: FormData, name: string, maxLength = 1000): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/** A secret field (password, code) exactly as typed; '' when missing. Never shown again. */
export function secretValue(form: FormData, name: string, maxLength = 1000): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

/** A checkbox: ticked only when its value is 'on' (the value the forms give every checkbox). */
export function ticked(form: FormData, name: string): boolean {
  return form.get(name) === 'on';
}

/** The values to show again after an error: the named text fields and the ticked checkboxes. */
export function keepValues(form: FormData, text: readonly string[], checkboxes: readonly string[] = []): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of text) {
    const value = textValue(form, name);
    if (value) values[name] = value;
  }
  for (const name of checkboxes) if (ticked(form, name)) values[name] = 'on';
  return values;
}

/**
 * The e-mail field, trimmed and in lower case. One character more than the limit is read, so an
 * over-long address is refused by looksLikeEmail() instead of being cut into a different one.
 */
export function emailValue(form: FormData): string {
  return textValue(form, 'email', EMAIL_MAX_LENGTH + 1).toLowerCase();
}

/** A simple e-mail check for the form's own message; Better Auth validates the address again. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= EMAIL_MAX_LENGTH;
}
