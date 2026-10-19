// Public DTOs of the lineage API (plan §6.3, §6.4; milestone M04). Every answer of lineage.* and
// people.* has one of these shapes, and only a value that went through one of the `toPublic…`
// functions below may enter a 'use cache' function: z.object() drops every key the schema does
// not name, so a private column added to a query later cannot reach the cache or a response.
//
// The graph shape is that of plan §6.3 and src/lib/lineage-layout/types.ts (LineageGraph), plus
// `slug` and `visibility` on nodes and a `lineages` list, which the list view and the explorer
// need to link people and name lineages.

import * as z from 'zod';

export const nameSchema = z.object({
  value: z.string(),
  /** ISO 15924 script code: Latn, Hant, Hans, Cyrl, … */
  script: z.string(),
  /** BCP 47 language tag, for the `lang` attribute. */
  lang: z.string(),
  /** name, alias or romanization. */
  kind: z.string(),
  /** jyutping, pinyin, … for a romanization. */
  romanization: z.string().nullable(),
});
export type PublicNameDto = z.infer<typeof nameSchema>;

export const visibilitySchema = z.enum(['public', 'involved_only']);

/** 'claimed' (the person's own account), 'platform' (kept by the archive) or 'unclaimed'. */
export const claimStateSchema = z.enum(['claimed', 'platform', 'unclaimed']);
export type ClaimState = z.infer<typeof claimStateSchema>;

export const periodSchema = z.object({
  /** ISO 8601 prefix by precision: YYYY, YYYY-MM or YYYY-MM-DD; null when unknown. */
  from: z.string().nullable(),
  to: z.string().nullable(),
  ongoing: z.boolean(),
  precision: z.enum(['year', 'month', 'day', 'unknown']),
});
export type PeriodDto = z.infer<typeof periodSchema>;

export const relationshipStatusSchema = z.enum([
  'pending_teacher',
  'awaiting_claim',
  'under_review',
  'verified',
  'rejected',
  'withdrawn',
  'in_arbitration',
  'revoked',
]);
export type RelationshipStatusDto = z.infer<typeof relationshipStatusSchema>;

export const lineageNodeSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  altNames: z.array(nameSchema),
  lifeStatus: z.string(),
  claimState: claimStateSchema,
  lineageIds: z.array(z.uuid()),
  /** Students along public relationships (v_public_edge only). */
  childCount: z.number().int(),
  /** True when some of those students are not in this answer. */
  hasMoreChildren: z.boolean(),
  /** involved_only: shown only to the signed-in participant (DEFAULT D03). */
  visibility: visibilitySchema,
});
export type LineageNodeDto = z.infer<typeof lineageNodeSchema>;

export const lineageEdgeSchema = z.object({
  id: z.uuid(),
  teacherId: z.uuid(),
  studentId: z.uuid(),
  lineageId: z.uuid(),
  /** DEFAULT D05: primary is the student's display-primary teacher (or the earliest); never hides the others. */
  kind: z.enum(['primary', 'converging', 'crossLineage']),
  status: relationshipStatusSchema,
  isDisplayPrimary: z.boolean(),
  /** involved_only: the signed-in participant's own relationship, not public (DEFAULT D03). */
  visibility: visibilitySchema,
  periods: z.array(periodSchema),
});
export type LineageEdgeDto = z.infer<typeof lineageEdgeSchema>;

export const hiddenCountSchema = z.object({ teachers: z.number().int(), students: z.number().int() });

export const lineageRefSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  /** DEFAULT D22: null when the root is unknown or not public. */
  rootPersonId: z.uuid().nullable(),
});
export type LineageRefDto = z.infer<typeof lineageRefSchema>;

export const lineageGraphSchema = z.object({
  focusId: z.uuid().nullable(),
  /** Changes whenever the nodes or edges of this answer change. */
  dataVersion: z.string(),
  nodes: z.array(lineageNodeSchema),
  edges: z.array(lineageEdgeSchema),
  /** Public teachers and students of a node that are not in this answer (v_public_edge only). */
  hiddenCounts: z.record(z.string(), hiddenCountSchema),
  lineages: z.array(lineageRefSchema),
  /** True when the node cap (about 500) cut the answer. */
  truncated: z.boolean(),
});
export type LineageGraphDto = z.infer<typeof lineageGraphSchema>;

export const lineagePathSchema = z.object({
  /** From the earliest known teacher down to the focus. */
  personIds: z.array(z.uuid()),
  /** personIds[i] taught personIds[i + 1] through edgeIds[i]. */
  edgeIds: z.array(z.uuid()),
});
export type LineagePathDto = z.infer<typeof lineagePathSchema>;

export const lineagePathsSchema = lineageGraphSchema.extend({
  paths: z.array(lineagePathSchema),
  /** Complete routes found, counted up to PATHS_COUNT_CAP. */
  totalPaths: z.number().int(),
  /** True when there are more routes than totalPaths. */
  totalPathsCapped: z.boolean(),
});
export type LineagePathsDto = z.infer<typeof lineagePathsSchema>;

export const personCountsSchema = z.object({
  teachers: z.number().int(),
  students: z.number().int(),
  /** Distinct descendants along public relationships, counted up to DESCENDANTS_CAP. */
  descendants: z.number().int(),
  descendantsCapped: z.boolean(),
});

export const personProfileSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  altNames: z.array(nameSchema),
  kind: z.string(),
  lifeStatus: z.string(),
  claimState: claimStateSchema,
  countryCode: z.string().nullable(),
  /** City level only, never a point (plan §6.4). */
  cityName: z.string().nullable(),
  bio: z.string().nullable(),
  visibility: visibilitySchema,
  /** The signed-in account's own person. */
  isOwn: z.boolean(),
  /**
   * Only the names are given (no bio, place or life status): a record that is not public, shown to
   * the viewer because of their own request, which its person has not answered yet (plan §6.4).
   */
  limited: z.boolean(),
  counts: personCountsSchema,
  lineages: z.array(lineageRefSchema),
});
export type PersonProfileDto = z.infer<typeof personProfileSchema>;

const personRefSchema = lineageNodeSchema.pick({
  id: true,
  slug: true,
  displayName: true,
  altNames: true,
  lifeStatus: true,
  claimState: true,
  visibility: true,
});

export const studentEntrySchema = z.object({
  person: personRefSchema,
  edges: z.array(lineageEdgeSchema.omit({ kind: true, teacherId: true, studentId: true })),
  /** Every period of every relationship has ended. */
  historical: z.boolean(),
  /** This student's own public students (v_public_edge only). */
  studentCount: z.number().int(),
  /** The student's other public teachers, at most 3: the display-primary one first, then the earliest. */
  otherTeachers: z.array(z.object({ person: personRefSchema, lineageId: z.uuid() })),
  /** How many other public teachers the student has. */
  otherTeachersTotal: z.number().int(),
});
export type StudentEntryDto = z.infer<typeof studentEntrySchema>;

export const studentsPageSchema = z.object({
  personId: z.uuid(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** 'name' (alphabetical) or 'seniority' (earliest dated training first, undated last). */
  order: z.enum(['name', 'seniority']),
  /** Public students with a current relationship, and those whose training has ended. */
  activeTotal: z.number().int(),
  historicalTotal: z.number().int(),
  pageCount: z.number().int(),
  active: z.array(studentEntrySchema),
  historical: z.array(studentEntrySchema),
  /** The signed-in teacher's own requests (involved_only, DEFAULT D03), on page 1 only, never counted above. */
  own: z.array(studentEntrySchema),
  lineages: z.array(lineageRefSchema),
});
export type StudentsPageDto = z.infer<typeof studentsPageSchema>;

/** Strips everything the public graph schema does not name. */
export function toPublicGraph(value: LineageGraphDto): LineageGraphDto {
  return lineageGraphSchema.parse(value);
}

export function toPublicPaths(value: LineagePathsDto): LineagePathsDto {
  return lineagePathsSchema.parse(value);
}

export function toPublicProfile(value: PersonProfileDto): PersonProfileDto {
  return personProfileSchema.parse(value);
}

export function toPublicStudents(value: StudentsPageDto): StudentsPageDto {
  return studentsPageSchema.parse(value);
}
