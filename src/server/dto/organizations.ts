// The public DTOs of organizations (milestone M15; plan §6.4, docs/adr/0018-organizations.md).
// organizations.list and organizations.get answer with these shapes, and only a value that went
// through a `toPublic…` function below may enter a 'use cache' function or leave those procedures:
// z.object() drops every key the schema does not name.
//
// What is never here: the applicant, the admins, the leader's name and title as the application
// gave them (a leader is shown only as a public person's membership, DEFAULT D03), the supporting
// document, the plan, any member who is not public, and any point of a school (a school is named
// with its city only: plan §6.4).

import * as z from 'zod';

import { photoSchema } from './public';
import { searchNameSchema } from './search';

export const organizationKindSchema = z.enum(['federation', 'association', 'school_group']);

export const organizationSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  kind: organizationKindSchema,
  kindLabel: z.string(),
  countryCode: z.string().nullable(),
});
export type OrganizationSummaryDto = z.infer<typeof organizationSummarySchema>;

export const organizationListSchema = z.object({ organizations: z.array(organizationSummarySchema) });
export type OrganizationListDto = z.infer<typeof organizationListSchema>;

export const organizationMemberSchema = z.object({
  slug: z.string(),
  /** The primary display name (Latin script, plan §5.3). */
  displayName: searchNameSchema,
  /** The original-script name, when the person has one public. */
  original: searchNameSchema.nullable(),
  role: z.enum(['leader', 'admin', 'member']),
  roleLabel: z.string(),
  photo: photoSchema.nullable().optional(),
});

export const organizationSchoolSchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** The city's name only: never a point (plan §6.4). */
  city: z.string(),
  countryCode: z.string(),
});

export const organizationPageSchema = organizationSummarySchema.extend({
  websiteUrl: z.string().nullable(),
  /** The day the reviewers approved the application (YYYY-MM-DD), null for a record of the platform. */
  approvedOn: z.string().nullable(),
  /** Current members who are public people (DEFAULT D03): leaders first. */
  members: z.array(organizationMemberSchema),
  /** Schools that accepted a link and are public (v_public_school). */
  schools: z.array(organizationSchoolSchema),
});
export type OrganizationPageDto = z.infer<typeof organizationPageSchema>;

export function toPublicOrganizationList(value: OrganizationListDto): OrganizationListDto {
  return organizationListSchema.parse(value);
}

export function toPublicOrganizationPage(value: OrganizationPageDto): OrganizationPageDto {
  return organizationPageSchema.parse(value);
}
