'use server';

// The Server Actions of /dashboard/family (docs/adr/0048-kung-fu-family.md): thin wrappers over
// follows.add and follows.remove (src/server/rpc/parity.ts), called in-process with this request's
// session, so the page and /api/v1 run the same checks. The forms are Server Components, so a
// refusal is kept for the page and shown there (keepFormResult).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { keepFormResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { FAMILY_FOLLOW_FORM } from './form-ids';

const PAGE = '/dashboard/family';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUNTRY = /^[A-Z]{2}$/;

/** The page to come back to: the same country filter, if any. */
function pageOf(form: FormData, extra: string | null): string {
  const country = textValue(form, 'country', 2);
  const params = new URLSearchParams();
  if (COUNTRY.test(country)) params.set('country', country);
  if (extra) params.set(extra, '1');
  const query = params.toString();
  return query ? `${PAGE}?${query}` : PAGE;
}

async function change(form: FormData, follow: boolean): Promise<void> {
  const raw = textValue(form, 'slug', 120);
  const slug = SLUG.test(raw) ? raw : '';
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    if (follow) await client.follows.add({ slug });
    else await client.follows.remove({ slug });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { slug });
    await keepFormResult({ form: FAMILY_FOLLOW_FORM, page: pageOf(form, null), anchor: outcomeTarget(FAMILY_FOLLOW_FORM, state, true) }, state);
  }
  redirect(pageOf(form, follow ? 'followed' : 'unfollowed'));
}

/** "Follow" (follows.add; bound to IDLE by its form). */
export async function followAction(_previous: FormState, form: FormData): Promise<void> {
  await change(form, true);
}

/** "Unfollow" (follows.remove; bound to IDLE by its form). */
export async function unfollowAction(_previous: FormState, form: FormData): Promise<void> {
  await change(form, false);
}
