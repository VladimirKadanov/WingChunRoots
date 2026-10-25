// The profile editor's form (milestone M07, In scope 1): its values and how they travel as form
// fields (so the form posts without JavaScript too). The rules the browser checks before anything
// is sent are in ./profile-form-rules.ts (Zod), which the editor fetches on first use. Pure: the
// client editor and the Server Action share it.

import { displayNameRefusal, NAME_WRITINGS } from '@/server/services/names';

export const PROFILE_MAX_NAMES = 10;
export const PROFILE_BIO_MAX_LENGTH = 1000;
/** Rows a page without JavaScript offers below the saved names, for new names (left empty, they are ignored). */
export const SPARE_ROWS = 2;

export const MISSING_PRIMARY = 'Add your name in Latin letters and choose it as your display name.';

export interface NameRow {
  value: string;
  /** How it is written: `<script>|<lang>|<romanization>` (writingValue). */
  writing: string;
  kind: 'name' | 'alias';
  /** A spare row of a page without JavaScript: ignored when left empty. */
  spare?: boolean;
}

export interface ProfileFormValues {
  names: NameRow[];
  /** Index of the display name in `names`, or -1. */
  primary: number;
  bio: string;
  bioLang: string;
  countryCode: string;
  placeId: string;
  trainingStartYear: string;
  showPublicly: boolean;
}

export interface Writing {
  script: string;
  lang: string;
  romanization: string | null;
}

export const writingValue = (w: Writing) => `${w.script}|${w.lang}|${w.romanization ?? ''}`;

export function parseWriting(value: string): Writing {
  const [script = '', lang = '', romanization = ''] = value.split('|');
  return { script, lang, romanization: romanization || null };
}

export const LATIN_WRITING = writingValue(NAME_WRITINGS[0]!);

/** Why a name written this way cannot be the display name (displayNameRefusal), or null when it can. */
export function primaryRefusal(writing: string, kind: NameRow['kind']): string | null {
  return displayNameRefusal({ kind, ...parseWriting(writing) });
}

/** Whether a name written this way may be the display name: Latin letters, not Jyutping or pinyin, not an alias. */
export function canBePrimary(writing: string, kind: NameRow['kind']): boolean {
  return primaryRefusal(writing, kind) === null;
}

/** A name row's field name, as the form posts it and as the service's field errors name it. */
export const nameField = (i: number, part: 'value' | 'writing' | 'kind' | 'isPrimary') => `names.${i}.${part}`;

/** The values of a submitted form (Server Action). */
export function profileFormFromData(form: FormData): ProfileFormValues {
  const text = (name: string, max = 4000) => {
    const v = form.get(name);
    return typeof v === 'string' ? v.slice(0, max) : '';
  };
  const names: NameRow[] = [];
  const primaryAt = Number.parseInt(text('primary', 4), 10);
  let primary = -1;
  for (let i = 0; i < PROFILE_MAX_NAMES + SPARE_ROWS; i++) {
    if (!form.has(nameField(i, 'value'))) continue;
    const row: NameRow = {
      value: text(nameField(i, 'value'), 400),
      writing: text(nameField(i, 'writing'), 80) || LATIN_WRITING,
      kind: text(nameField(i, 'kind'), 10) === 'alias' ? 'alias' : 'name',
      spare: text(`names.${i}.spare`, 2) === '1',
    };
    // A spare row left empty is ignored; so is a saved row emptied, other than the display name:
    // without JavaScript there is no Remove button, and clearing a name is how it is removed.
    if (!row.value.trim() && (row.spare || i !== primaryAt)) continue;
    if (i === primaryAt) primary = names.length;
    names.push(row);
  }
  return {
    names,
    primary,
    bio: text('bio', PROFILE_BIO_MAX_LENGTH * 2),
    bioLang: text('bioLang', 35) || 'en',
    countryCode: text('countryCode', 2),
    placeId: text('placeId', 40),
    trainingStartYear: text('trainingStartYear', 8).trim(),
    showPublicly: form.get('showPublicly') === 'on',
  };
}

/** The input of profile.update for these values. */
export function toUpdateInput(values: ProfileFormValues) {
  return {
    names: values.names.map((row, i) => {
      const w = parseWriting(row.writing);
      return {
        kind: row.kind,
        value: row.value,
        script: w.script,
        lang: w.lang,
        romanization: w.romanization as 'jyutping' | 'pinyin' | 'yale' | 'hk_gov' | 'bg_streamlined' | null,
        isPrimary: i === values.primary,
      };
    }),
    bio: values.bio.trim() ? { body: values.bio, lang: values.bioLang } : null,
    // The form sends every field: an empty one clears the saved value (null).
    countryCode: values.countryCode || null,
    placeId: values.placeId || null,
    trainingStartYear: values.trainingStartYear || null,
    showPublicly: values.showPublicly,
  };
}

/** The values as FormState.values (flat strings), so a page without JavaScript renders them again. */
export function flattenValues(values: ProfileFormValues): Record<string, string> {
  const flat: Record<string, string> = {
    primary: String(values.primary),
    bio: values.bio,
    bioLang: values.bioLang,
    countryCode: values.countryCode,
    placeId: values.placeId,
    trainingStartYear: values.trainingStartYear,
    names: String(values.names.length),
  };
  if (values.showPublicly) flat.showPublicly = 'on';
  values.names.forEach((row, i) => {
    flat[nameField(i, 'value')] = row.value;
    flat[nameField(i, 'writing')] = row.writing;
    flat[nameField(i, 'kind')] = row.kind;
  });
  return flat;
}

/** The values of FormState.values, or null when they hold no names. */
export function unflattenValues(flat: Record<string, string> | undefined): ProfileFormValues | null {
  if (!flat || !flat.names) return null;
  const count = Math.min(Number.parseInt(flat.names, 10) || 0, PROFILE_MAX_NAMES);
  return {
    names: Array.from({ length: count }, (_, i) => ({
      value: flat[nameField(i, 'value')] ?? '',
      writing: flat[nameField(i, 'writing')] ?? LATIN_WRITING,
      kind: flat[nameField(i, 'kind')] === 'alias' ? 'alias' : 'name',
    })),
    primary: Number.parseInt(flat.primary ?? '-1', 10),
    bio: flat.bio ?? '',
    bioLang: flat.bioLang ?? 'en',
    countryCode: flat.countryCode ?? '',
    placeId: flat.placeId ?? '',
    trainingStartYear: flat.trainingStartYear ?? '',
    showPublicly: flat.showPublicly === 'on',
  };
}

/** A field name of the service's errors as the form names it: `bio.body` is `bio`, `names.0.script` is `names.0.writing`. */
export function formFieldOf(serviceField: string): string {
  if (serviceField === 'bio.body') return 'bio';
  if (serviceField === 'bio.lang') return 'bioLang';
  return serviceField.replace(/^names\.(\d+)\.script$/, 'names.$1.writing');
}
