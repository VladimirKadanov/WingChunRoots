// The profile editor's form (milestone M07, In scope 1): its values, how they travel as form
// fields (so the form posts without JavaScript too) and the same rules as profile.update, written
// as a Zod schema for the browser (TanStack Form checks it before anything is sent). The service
// checks everything again (src/server/services/profile.ts); this file only spares a round trip.
// Pure: the client editor and the Server Action share it.

import * as z from 'zod';

import { cleanName, isLatinName, NAME_MAX_LENGTH, NAME_WRITINGS, nameFitsWriting } from '@/server/services/names';

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

/** Whether a name written this way may be the display name: Latin letters, not Jyutping or pinyin. */
export function canBePrimary(writing: string, kind: NameRow['kind']): boolean {
  const w = parseWriting(writing);
  return w.script === 'Latn' && w.romanization !== 'jyutping' && w.romanization !== 'pinyin' && kind === 'name';
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

function fitMessage(writing: Writing): string {
  if (writing.romanization === 'jyutping') return 'Write Jyutping in Latin letters with tone numbers, for example “sou1 zuk1 cing4”.';
  if (writing.romanization === 'pinyin') return 'Write pinyin in Latin letters, for example “Sū Zhúqíng”.';
  if (writing.script === 'Latn') return 'Use Latin letters here (for example “So Chuk-ching”), or choose the script this name is written in.';
  const known = NAME_WRITINGS.find((w) => w.lang === writing.lang && w.script === writing.script);
  return known ? `This name is not written in ${known.label}. Type it in that script, or choose how it is written under “Written in”.` : 'Choose how this name is written.';
}

/**
 * The editor's rules as a Zod schema (plan §5.3): one display name in Latin letters, each name in
 * the script it says, no name twice, a biography within its length and a year from 1900 to this
 * year. Issues carry the service's field names (`names.0.value`, `names`, `bio`, ...).
 */
export function profileFormSchema(latestStartYear: number) {
  return z
    .object({
      names: z.array(z.object({ value: z.string(), writing: z.string(), kind: z.enum(['name', 'alias']), spare: z.boolean().optional() })),
      primary: z.number().int(),
      bio: z.string(),
      bioLang: z.string(),
      countryCode: z.string(),
      placeId: z.string(),
      trainingStartYear: z.string(),
      showPublicly: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (v.names.length > PROFILE_MAX_NAMES) issue('names', `Add at most ${PROFILE_MAX_NAMES} names.`);
      const seen = new Set<string>();
      v.names.forEach((row, i) => {
        const value = cleanName(row.value);
        const writing = parseWriting(row.writing);
        if (!value) issue(nameField(i, 'value'), 'Enter the name, or remove this row.');
        else if (value.length > NAME_MAX_LENGTH) issue(nameField(i, 'value'), `Use at most ${NAME_MAX_LENGTH} characters.`);
        else if (!nameFitsWriting(value, writing.script, writing.lang, writing.romanization)) issue(nameField(i, 'value'), fitMessage(writing));
        else {
          const id = `${row.writing}\u0000${value.toLowerCase()}`;
          if (seen.has(id)) issue(nameField(i, 'value'), 'This name is already in the list.');
          seen.add(id);
        }
      });
      const primary = v.names[v.primary];
      if (!primary) issue('names', MISSING_PRIMARY);
      else if (!canBePrimary(primary.writing, primary.kind) || !isLatinName(cleanName(primary.value) || 'x')) {
        issue('names', MISSING_PRIMARY);
        issue(nameField(v.primary, 'isPrimary'), 'Your display name must be written in Latin letters.');
      }
      if (v.bio.trim().length > PROFILE_BIO_MAX_LENGTH) issue('bio', `Use at most ${PROFILE_BIO_MAX_LENGTH} characters.`);
      if (v.trainingStartYear) {
        const year = Number(v.trainingStartYear);
        if (!/^\d{4}$/.test(v.trainingStartYear)) issue('trainingStartYear', 'Enter the year as four digits, for example 2009.');
        else if (year < 1900) issue('trainingStartYear', `${year} is before 1900. Enter a year from 1900 to ${latestStartYear}.`);
        else if (year > latestStartYear) issue('trainingStartYear', `${year} is after this year. Enter a year from 1900 to ${latestStartYear}.`);
      }
    });
}

/** The field errors of `values` under the schema, by field name; {} when there are none. */
export function profileFormErrors(values: ProfileFormValues, latestStartYear: number): Record<string, string> {
  const parsed = profileFormSchema(latestStartYear).safeParse(values);
  if (parsed.success) return {};
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'names')] ??= issue.message;
  return fields;
}

/** A field name of the service's errors as the form names it: `bio.body` is `bio`, `names.0.script` is `names.0.writing`. */
export function formFieldOf(serviceField: string): string {
  if (serviceField === 'bio.body') return 'bio';
  if (serviceField === 'bio.lang') return 'bioLang';
  return serviceField.replace(/^names\.(\d+)\.script$/, 'names.$1.writing');
}
