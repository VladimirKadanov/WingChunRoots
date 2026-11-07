'use server';

// Staff's "Remove a passport entry" on a person's profile (milestone M19, In scope 6): a reason,
// kept in the audit log and sent to the passport's owner; the entry is then shown to nobody. A
// thin Server Action over passport.remove; the service checks the role and the second factor again.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { keepFormResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PASSPORT_REMOVE_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS = ['rank', 'exam', 'skill', 'certificate', 'attendance'] as const;

/**
 * "Remove the entry" (passport.remove): then the profile, without it. The form is rendered by the
 * Server Component of the profile (no client module in every visitor's JavaScript), so a refusal is
 * always kept for the page and shown there, whoever posted (keepFormResult).
 */
export async function removePassportEntryAction(_previous: FormState, form: FormData): Promise<never> {
  const slug = textValue(form, 'slug', 200);
  const [kindText = '', id = ''] = textValue(form, 'entry', 80).split(':');
  const reason = textValue(form, 'reason', 2000);
  const page = SLUG.test(slug) ? `/people/${slug}` : '/';
  const kind = (KINDS as readonly string[]).includes(kindText) ? (kindText as (typeof KINDS)[number]) : 'rank';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.remove({ kind, id: UUID.test(id) ? id : '', reason });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { reason, entry: `${kindText}:${id}` });
    return keepFormResult({ form: PASSPORT_REMOVE_FORM, page, anchor: outcomeTarget(PASSPORT_REMOVE_FORM, state, false) }, state);
  }
  redirect(`${page}?passport-removed=1#passport-heading`);
}
