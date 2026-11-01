// /admin/review/records?slug=<slug> (milestone M10a, In scope 5): the record lookup of the review
// queue, a plain GET form, leads to the record's archival edit page. Nothing is read here: the edit
// page checks the session and the record.

import { redirect } from 'next/navigation';

export const instant = false;

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordLookup({ searchParams }: { searchParams: Search }) {
  const raw = (await searchParams).slug;
  const slug = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  redirect(/^[a-z0-9-]{1,120}$/.test(slug) ? `/admin/review/records/${slug}` : '/admin/review#archive-heading');
}
