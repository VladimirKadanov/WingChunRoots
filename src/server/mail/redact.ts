// Removes e-mail addresses from text that is stored or logged (plan §6.4). A module of its own, so
// that the job runtime can use it without loading the Mailer and the templates.

/** Replaces every e-mail address in `text` with `<address>`. */
export function redactAddresses(text: string): string {
  return text.replace(/[^\s<>()"',;:@]+@[^\s<>()"',;:@]+/g, '<address>');
}
