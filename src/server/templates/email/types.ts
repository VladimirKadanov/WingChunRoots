// Shared types and data checks of the e-mail templates (milestone M01b, In scope 3).
//
// Every template is English and lives in src/server/templates/email/: the only place with the
// text of e-mails (plan §6.1). Template data arrives as JSON from the job queue, so each template
// checks it at run time (`parse`) before rendering; a TemplateDataError is permanent and is
// never retried.

import type { ReactElement } from 'react';

/** A person's name in one script, shown with its `lang` attribute (plan §5.3). */
export interface NameData {
  /** The name as written, in any script. */
  value: string;
  /** BCP 47 language tag of the name, for example `en`, `zh-Hant`, `bg`. */
  lang: string;
}

export interface EmailTemplate<Data> {
  /** Stable identifier, stored in email_delivery.template. */
  readonly name: string;
  /** Checks untrusted data (JSON from the queue); throws TemplateDataError. */
  parse(data: unknown): Data;
  subject(data: Data): string;
  /** The preview line that mail clients show next to the subject. */
  preview(data: Data): string;
  render(data: Data): ReactElement;
  /** Fictional example data (D20) for the tests and for previews. */
  readonly sample: Data;
}

/** Data that a template cannot render. Permanent: retrying cannot fix it. */
export class TemplateDataError extends Error {
  constructor(template: string, problem: string) {
    super(`template ${template}: ${problem}`);
    this.name = 'TemplateDataError';
  }
}

// BCP 47 in the shape the project stores (person_name.lang): language, then optional subtags.
const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_NAME_LENGTH = 200;

/** Checks a list of names: at least one, the first in Latin script (the primary display name). */
export function parseNames(template: string, field: string, value: unknown): NameData[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new TemplateDataError(template, `${field} must be a list of 1 to 4 names`);
  }
  return value.map((item, index) => {
    const { value: text, lang } = (item ?? {}) as Partial<Record<keyof NameData, unknown>>;
    if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_NAME_LENGTH) {
      throw new TemplateDataError(template, `${field}[${index}].value must be a non-empty string`);
    }
    if (typeof lang !== 'string' || !LANG_TAG.test(lang)) {
      throw new TemplateDataError(template, `${field}[${index}].lang must be a BCP 47 language tag`);
    }
    // Latin letters, with digits, spaces and punctuation (Common) and combining marks (Inherited).
    if (index === 0 && !/^(?=.*\p{Script=Latin})[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+$/u.test(text)) {
      throw new TemplateDataError(template, `${field}[0] must be the Latin-script display name`);
    }
    return { value: text.trim(), lang };
  });
}

/** The object behind `data`, or a TemplateDataError. */
export function parseObject(template: string, data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TemplateDataError(template, 'data must be an object');
  }
  return data as Record<string, unknown>;
}

const MAX_URL_LENGTH = 2048;

/**
 * Checks the link of an account e-mail (M02): an absolute http(s) URL to `path` with a `token`
 * query parameter, built by src/server/auth/emails.ts from APP_URL.
 */
export function parseActionUrl(template: string, field: string, value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) throw new TemplateDataError(template, `${field} must be a URL`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TemplateDataError(template, `${field} must be a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TemplateDataError(template, `${field} must be an http(s) URL`);
  if (url.pathname !== path || !url.searchParams.get('token')) {
    throw new TemplateDataError(template, `${field} must point at ${path} with a token`);
  }
  return value;
}

/** A whole number of hours from 1 to 168, for "this link works for N hours". */
export function parseHours(template: string, field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 168) {
    throw new TemplateDataError(template, `${field} must be a whole number of hours from 1 to 168`);
  }
  return value;
}

/** Optional names of the recipient (see parseNames); an empty list when absent. */
export function parseOptionalNames(template: string, field: string, value: unknown): NameData[] {
  return value === undefined ? [] : parseNames(template, field, value);
}
