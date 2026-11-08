// The DTOs of the training passport (milestone M19; plan §6.4; docs/adr/0022-passport.md).
// passport.get answers with the public DTO below, and only a value that went through
// toPublicPassport() leaves that procedure: z.object() drops every key the schema does not name.
//
// What is never in the public DTO: a private entry, a withdrawn or removed one, an entry the plan of
// the passport's account does not show (DEFAULT M19, question 3), an examiner, teacher, organization
// or event that is not public, a proposed correction, a reason of staff, an account, a storage key,
// or how many entries are hidden. A certificate appears only by its id and content hash (the image
// is served after its own check, GET /api/certificates/...).

import * as z from 'zod';

import { PASSPORT_ENTRY_KINDS, PASSPORT_VISIBILITIES, SKILL_PROGRESSES } from '../db/schema/common';
import { searchNameSchema } from './search';

export const passportKindSchema = z.enum(PASSPORT_ENTRY_KINDS);
export type PassportKind = z.infer<typeof passportKindSchema>;

export const PASSPORT_KIND_LABELS: Record<PassportKind, string> = {
  rank: 'Rank',
  exam: 'Examination',
  skill: 'Form or skill',
  certificate: 'Certificate',
  attendance: 'Event',
};

export const SKILL_PROGRESS_LABELS: Record<(typeof SKILL_PROGRESSES)[number], string> = {
  learning: 'Learning',
  approved: 'Approved by the teacher',
};

/** A public person named on an entry (a teacher, an examiner): shown only while public. */
export const passportPersonSchema = z.object({ slug: z.string(), name: searchNameSchema });
export type PassportPersonDto = z.infer<typeof passportPersonSchema>;

/** The image of a certificate: squares and the whole scan, by the app's own address. */
export const certificateImageSchema = z.object({
  small: z.string(),
  large: z.string(),
  full: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});
export type CertificateImageDto = z.infer<typeof certificateImageSchema>;

export const passportEntrySchema = z.object({
  kind: passportKindSchema,
  id: z.string(),
  /** "YYYY", "YYYY-MM" or "YYYY-MM-DD" by the precision it was recorded with; null when unknown. */
  date: z.string().nullable(),
  /** "2019", "May 2019", "12 May 2019" or "Date not recorded". */
  dateText: z.string(),
  /** The rank, the awarded rank, the form or skill, the certificate's title or the event's title. */
  title: z.string(),
  /** A form or skill: learning or approved, with its words (never colour alone). */
  progress: z.enum(SKILL_PROGRESSES).nullable(),
  progressLabel: z.string().nullable(),
  organization: z.object({ slug: z.string(), name: z.string() }).nullable(),
  examiner: passportPersonSchema.nullable(),
  teacher: passportPersonSchema.nullable(),
  event: z.object({ slug: z.string(), kindLabel: z.string() }).nullable(),
  image: certificateImageSchema.nullable(),
  /** When the entry was written (ISO 8601): the order of entries of the same date. */
  createdAt: z.string(),
});
export type PassportEntryDto = z.infer<typeof passportEntrySchema>;

export const passportPeriodSchema = z.object({
  start: z.string().nullable(),
  end: z.string().nullable(),
  ongoing: z.boolean(),
  /** "2015 – now", "March 2015 – May 2019", "Dates not recorded". */
  text: z.string(),
});

/** A teacher with the periods of training under them (training_period, M09; never entered again). */
export const passportTeacherSchema = z.object({
  person: passportPersonSchema,
  lineage: z.string(),
  periods: z.array(passportPeriodSchema),
});
export type PassportTeacherDto = z.infer<typeof passportTeacherSchema>;

export const passportExperienceSchema = z.object({
  /** "since 2015 · about 10 years", or "since 2015" on the basic passport. */
  text: z.string(),
  startYear: z.number().int(),
});

export const passportYearSchema = z.object({ year: z.number().int().nullable(), items: z.array(passportEntrySchema) });

export const passportSchema = z.object({
  slug: z.string(),
  /** What the plan of the passport's account shows: the basic record or the full timeline. */
  level: z.enum(['basic', 'full']),
  experience: passportExperienceSchema.nullable(),
  currentRank: passportEntrySchema.nullable(),
  teachers: z.array(passportTeacherSchema),
  /** The full timeline by year, the latest first (empty on the basic passport). */
  timeline: z.array(passportYearSchema),
});
export type PassportDto = z.infer<typeof passportSchema>;

export function toPublicPassport(value: PassportDto): PassportDto {
  return passportSchema.parse(value);
}

export const passportVisibilitySchema = z.enum(PASSPORT_VISIBILITIES);
