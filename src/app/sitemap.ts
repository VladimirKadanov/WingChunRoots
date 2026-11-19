// sitemap.xml (milestone M11, In scope 8): the home page, the school finder and every public
// school, from the public DTO of schools.sitemap (addresses and dates only: never a coordinate);
// since ADR 0051 also the list of organizations and every approved organization's page, from the
// public DTO of organizations.list.
// People's profiles are not indexed until hosting (plan §3.3, M04), so they are not listed.
// Read per request (the list changes with each approval and each revoked plan), through the same
// procedure as /api/v1.

import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';

import { appUrl } from '@/server/auth/env';
import { serverClient } from '@/server/rpc/server';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = appUrl();
  const client = serverClient(await headers(), null);
  const [schools, organizations] = await Promise.all([client.schools.sitemap(), client.organizations.list()]);
  return [
    { url: `${origin}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/schools`, changeFrequency: 'daily', priority: 0.8 },
    ...schools.map((school) => ({ url: `${origin}/schools/${school.slug}`, lastModified: school.updatedAt, changeFrequency: 'weekly' as const, priority: 0.6 })),
    { url: `${origin}/organizations`, changeFrequency: 'weekly', priority: 0.7 },
    ...organizations.organizations.map((org) => ({ url: `${origin}/organizations/${org.slug}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
