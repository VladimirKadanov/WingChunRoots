'use server';

// The Server Action of /people/<slug>/claim (ADR 0040): a thin wrapper over claims.request
// (src/server/rpc/parity.ts), called in-process with this request's session. The form is rendered
// by the page's Server Component (no client module), so a refusal is always kept for the page and
// shown there, whoever posted (keepFormResult). Success opens the claim's case page, by its id only.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { keepFormResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CLAIM_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "Send the claim" (claims.request): then the claim's case page. */
export async function requestClaimAction(_previous: FormState, form: FormData): Promise<never> {
  const personId = textValue(form, 'personId', 40);
  const slug = textValue(form, 'slug', 120);
  const note = textValue(form, 'note', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = SLUG.test(slug) ? `/people/${slug}/claim` : '/';
  let caseId: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).claims.request({
      personId: UUID.test(personId) ? personId : '',
      note,
      idempotencyKey: KEY.test(key) ? key : '',
    });
    caseId = result.caseId;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { note });
    return keepFormResult({ form: CLAIM_FORM, page, anchor: outcomeTarget(CLAIM_FORM, state, false) }, state);
  }
  redirect(atOutcome(`/dashboard/cases/${caseId}?claimed=1`));
}
