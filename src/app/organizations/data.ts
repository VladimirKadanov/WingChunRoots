// The data of the organization pages (milestone M15): the public DTOs of organizations.list and
// organizations.get, read in-process through the oRPC router (the same procedures as /api/v1),
// once per request (React cache). Only those DTOs feed the pages (plan §6.4).

import { cache } from 'react';

import type { OrganizationListDto, OrganizationPageDto } from '@/server/dto/organizations';
import { ORPCError } from '@/server/rpc/server';
import { failure, lineageClient } from '../people/[slug]/data';

export type OrganizationRead = { state: 'found'; organization: OrganizationPageDto } | { state: 'none' } | { state: 'failed' };

export const loadOrganization = cache(async (slug: string): Promise<OrganizationRead> => {
  const client = await lineageClient();
  try {
    return { state: 'found', organization: await client.organizations.get({ slug }) };
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) return { state: 'none' };
    console.error(`[organization-page] the organization could not be loaded: ${failure(error)}`);
    return { state: 'failed' };
  }
});

export const loadOrganizations = cache(async (): Promise<OrganizationListDto | null> => {
  const client = await lineageClient();
  try {
    return await client.organizations.list();
  } catch (error) {
    console.error(`[organizations] the list could not be loaded: ${failure(error)}`);
    return null;
  }
});
