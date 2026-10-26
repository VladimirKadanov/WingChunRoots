// The profile editor's rules (milestone M07, In scope 1): the same rules as profile.update,
// written as a Zod schema for the browser (TanStack Form checks it before anything is sent). The
// service checks everything again (src/server/services/profile.ts); this file only spares a round
// trip.
//
// Not part of the page's JavaScript: the editor fetches this module when the person first focuses
// the form or saves it (profile-editor.tsx), because Zod is about 40 kB of gzip JavaScript in the
// Turbopack build, Zod Mini included, and /dashboard/profile has 170 kB (plan §5.8 (c)).

import * as z from 'zod/mini';

import { cleanName, isLatinName, NAME_MAX_LENGTH, NAME_WRITINGS, nameFitsWriting } from '@/server/services/names';
import {
  canBePrimary,
  MISSING_PRIMARY,
  nameField,
  parseWriting,
  primaryRefusal,
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_MAX_NAMES,
  type ProfileFormValues,
  type Writing,
} from './profile-form';

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
      names: z.array(z.object({ value: z.string(), writing: z.string(), kind: z.enum(['name', 'alias']), spare: z.optional(z.boolean()) })),
      primary: z.int(),
      bio: z.string(),
      bioLang: z.string(),
      countryCode: z.string(),
      placeId: z.string(),
      trainingStartYear: z.string(),
      showPublicly: z.boolean(),
    })
    .check(
      z.superRefine((v, ctx) => {
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
          // The same reason as the note under the radio (and the service's error).
          issue(nameField(v.primary, 'isPrimary'), primaryRefusal(primary.writing, primary.kind) ?? 'Your display name must be written in Latin letters.');
        }
        if (v.bio.trim().length > PROFILE_BIO_MAX_LENGTH) issue('bio', `Use at most ${PROFILE_BIO_MAX_LENGTH} characters.`);
        if (v.trainingStartYear) {
          const year = Number(v.trainingStartYear);
          if (!/^\d{4}$/.test(v.trainingStartYear)) issue('trainingStartYear', 'Enter the year as four digits, for example 2009.');
          else if (year < 1900) issue('trainingStartYear', `${year} is before 1900. Enter a year from 1900 to ${latestStartYear}.`);
          else if (year > latestStartYear) issue('trainingStartYear', `${year} is after this year. Enter a year from 1900 to ${latestStartYear}.`);
        }
      }),
    );
}

/** The field errors of `values` under the schema, by field name; {} when there are none. */
export function profileFormErrors(values: ProfileFormValues, latestStartYear: number): Record<string, string> {
  const parsed = profileFormSchema(latestStartYear).safeParse(values);
  if (parsed.success) return {};
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'names')] ??= issue.message;
  return fields;
}
