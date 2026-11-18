// The archive editor's words that more than one page or the actions use (docs/adr/0043-admin-bulgarian.md):
// the load error, the scripts of a name and the service's refusals, each through the control panel's t().

import type { AdminT } from '@/components/admin/i18n/translate';
import { UNEXPECTED_FAILURE_MESSAGE } from '@/server/rpc/form';
import type { FormState } from '@/lib/form-state';

/** The archive editor's error state (src/components/account/load-errors/archive.ts), in the control panel's language. */
export function archiveLoadError(t: AdminT) {
  return {
    eyebrow: t('Archive editor'),
    title: t('Archive editor'),
    message: t("We couldn't load the archive. Nothing was changed."),
    back: { href: '/admin', label: t('Back to administration') },
  };
}

/** The label of a script a name may be written in (src/server/services/names.ts, ORIGINAL_SCRIPTS). */
export function scriptLabel(t: AdminT, label: string): string {
  switch (label) {
    case 'Chinese, Traditional characters':
      return t('Chinese, Traditional characters');
    case 'Chinese, Simplified characters':
      return t('Chinese, Simplified characters');
    case 'Japanese':
      return t('Japanese');
    case 'Korean':
      return t('Korean');
    case 'Bulgarian, Cyrillic':
      return t('Bulgarian, Cyrillic');
    case 'Russian, Cyrillic':
      return t('Russian, Cyrillic');
    case 'Ukrainian, Cyrillic':
      return t('Ukrainian, Cyrillic');
    case 'Serbian, Cyrillic':
      return t('Serbian, Cyrillic');
    case 'Greek':
      return t('Greek');
    case 'Thai':
      return t('Thai');
    case 'Hebrew':
      return t('Hebrew');
    case 'Arabic':
      return t('Arabic');
    default:
      return label;
  }
}

/**
 * A message of the archive editor's procedures (src/server/services/archive-editor.ts) in the
 * control panel's language: the fixed ones are dictionary entries, the few with a number or a
 * script are matched here and filled in.
 */
export function serviceText(t: AdminT, text: string): string {
  if (t.lang === 'en') return text;
  let m = /^Use at most (\d+) characters\.$/.exec(text);
  if (m) return t('Use at most {max} characters.', { max: m[1]! });
  m = /^Write a year from (\d+) to (\d+), or leave it empty\.$/.exec(text);
  if (m) return t('Write a year from {from} to {to}, or leave it empty.', { from: m[1]!, to: m[2]! });
  m = /^This name is not written in (.+)\.$/.exec(text);
  if (m) return t('This name is not written in {script}.', { script: scriptLabel(t, m[1]!) });
  if (text === UNEXPECTED_FAILURE_MESSAGE) return t('Something went wrong on our side; nothing was changed. Try again.');
  return t(text);
}

/** A refused form's message and field errors in the control panel's language (values stay as typed). */
export function translateFormState(t: AdminT, state: FormState): FormState {
  return {
    ...state,
    ...(state.message ? { message: serviceText(t, state.message) } : {}),
    ...(state.fields ? { fields: Object.fromEntries(Object.entries(state.fields).map(([name, text]) => [name, serviceText(t, text)])) } : {}),
  };
}
