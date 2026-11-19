'use server';

// Staff's "Remove a link" on a person's profile (owner decision 2026-11-18, docs/adr/0047-featured-profile.md):
// one link of a featured profile, with a reason kept in the audit log and sent to the owner. A thin
// Server Action over profile.removeLink; the service checks the role and the second factor again.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { keepFormResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PROFILE_LINK_REMOVE_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Remove the link" (profile.removeLink): then the profile, without it; a refusal is kept for the page. */
export async function removeProfileLinkAction(_previous: FormState, form: FormData): Promise<never> {
  const slug = textValue(form, 'slug', 200);
  const id = textValue(form, 'id', 40);
  const reason = textValue(form, 'reason', 2000);
  const page = SLUG.test(slug) ? `/people/${slug}` : '/';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).profile.removeLink({ id: UUID.test(id) ? id : '', reason });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { reason, id });
    return keepFormResult({ form: PROFILE_LINK_REMOVE_FORM, page, anchor: outcomeTarget(PROFILE_LINK_REMOVE_FORM, state, false) }, state);
  }
  redirect(`${page}?link-removed=1#links-heading`);
}
