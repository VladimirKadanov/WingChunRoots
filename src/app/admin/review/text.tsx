// The control panel's language on the review pages (docs/adr/0043-admin-bulgarian.md): the words the
// services send (case kinds, statuses, the facts of a case, the decisions' words, refusals) go
// through t() by their English text, which is their dictionary key (bg/review.ts), and English
// reads exactly as the service wrote it. Server only: the forms get their words as props.

import type { ReactNode } from 'react';

import type { AdminT } from '@/components/admin/i18n/translate';
import type { FormState } from '@/lib/form-state';
import { waitedText } from '@/lib/waited';

/** A staff role, as the case card names a reviewer's ("admin", "moderator", "archivist"). */
export function roleName(t: AdminT, role: string): string {
  switch (role) {
    case 'admin':
      return t('admin');
    case 'moderator':
      return t('moderator');
    case 'archivist':
      return t('archivist');
    default:
      return role;
  }
}

/** A record's life status as the case card says it ("life status unknown"). */
export function lifeStatusWord(t: AdminT, status: string): string {
  switch (status) {
    case 'unknown':
      return t('unknown');
    case 'living':
      return t('living');
    case 'deceased':
      return t('deceased');
    default:
      return status;
  }
}

/** A fact's value from the service: its parts joined with " · " are translated one by one. */
export function factValue(t: AdminT, value: string): string {
  return value
    .split(' · ')
    .map((part) => t(part))
    .join(' · ');
}

/** "Name (role)" or "Name (role) — you", the reviewers an administrator can give a case to. */
export function reviewerLabel(t: AdminT, label: string): string {
  const m = /^(.*) \((admin|moderator|archivist)\)( — you)?$/.exec(label);
  if (!m) return label;
  const name = m[1] === 'Reviewer' ? t('Reviewer') : m[1]!;
  const role = roleName(t, m[2]!);
  return m[3] ? t('{name} ({role}) — you', { name, role }) : t('{name} ({role})', { name, role });
}

/** How long a case has waited ("4 days", "20 h", "under 1 h": waitedText), in the language. */
export function waited(t: AdminT, since: string, now: number): string {
  const text = waitedText(since, now);
  const days = /^(\d+) days?$/.exec(text);
  if (days) return t.n(Number(days[1]), '{n} day', '{n} days');
  const hours = /^(\d+) h$/.exec(text);
  if (hours) return t('{n} h', { n: t.num(Number(hours[1])) });
  return t('under 1 h');
}

/** A service's message, with the few that carry a value of their own. */
export function serviceMessage(t: AdminT, message: string): string {
  const script = /^This name is not written in (.+)\.$/.exec(message);
  if (script) return t('This name is not written in {script}.', { script: t(script[1]!) });
  return t(message);
}

/** A form's refusal (its message and each field's), in the language: what a Server Action returns. */
export function translateState(t: AdminT, state: FormState): FormState {
  if (t.lang === 'en' || state.status !== 'error') return state;
  return {
    ...state,
    ...(state.message ? { message: serviceMessage(t, state.message) } : {}),
    ...(state.fields ? { fields: Object.fromEntries(Object.entries(state.fields).map(([name, text]) => [name, serviceMessage(t, text)])) } : {}),
  };
}

/** `text` with its {n} as a <strong> number: "<strong>12</strong> waiting". */
export function withStrong(text: string, n: number | string): ReactNode {
  const at = text.indexOf('{n}');
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong>{n}</strong>
      {text.slice(at + 3)}
    </>
  );
}
