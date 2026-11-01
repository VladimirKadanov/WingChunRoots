'use server';

// The Server Action of /people/<slug>/report (milestone M10b, In scope 4): a thin wrapper over
// reports.create (src/server/rpc/parity.ts), called in-process with this request's session.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { REPORT_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,120}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const REASONS = ['copyright', 'spam', 'inappropriate', 'misleading'] as const;

/** "Send the report" (reports.create). */
export async function reportProfileAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const slug = textValue(form, 'slug', 120);
  const reason = textValue(form, 'reason', 20);
  const details = textValue(form, 'details', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = SLUG.test(slug) ? `/people/${slug}/report` : '/';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).reports.create({
      personId: UUID.test(personId) ? personId : '',
      reason: (REASONS as readonly string[]).includes(reason) ? (reason as (typeof REASONS)[number]) : ('' as 'spam'),
      details: details || null,
      idempotencyKey: KEY.test(key) ? key : '',
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { personId, slug, reason, details });
    return formResult({ form: REPORT_FORM, page, anchor: outcomeTarget(REPORT_FORM, state, false) }, state);
  }
  redirect(atOutcome(`${page}?sent=1`));
}
