// Reading the fields of a submitted form in a Server Action (milestone M02). FormData values are
// strings or files; these helpers return plain strings, so an action never trusts a File where it
// expects text, and keep the values the form shows again after an error.

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

/** A simple e-mail check for the form's own message; Better Auth validates the address again. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
