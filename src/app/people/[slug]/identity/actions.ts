'use server';

// The Server Action of /people/<slug>/identity (ADR 0089): a thin wrapper over identity.report
// (src/server/rpc/parity.ts), called in-process with this request's session.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { IDENTITY_REPORT_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,120}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const ROUTES = ['vouching', 'channel', 'video'] as const;

/** "Send the report" (identity.report); the case page follows it from there. */
export async function reportIdentityAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const slug = textValue(form, 'slug', 120);
  const route = textValue(form, 'route', 20);
  const details = textValue(form, 'details', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = SLUG.test(slug) ? `/people/${slug}/identity` : '/';
  let caseId: string;
  try {
    ({ caseId } = await serverClient(await headers(), await getRequestPrincipal()).identity.report({
      personId: UUID.test(personId) ? personId : '',
      route: (ROUTES as readonly string[]).includes(route) ? (route as (typeof ROUTES)[number]) : null,
      details,
      idempotencyKey: KEY.test(key) ? key : '',
    }));
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { personId, slug, route, details });
    return formResult({ form: IDENTITY_REPORT_FORM, page, anchor: outcomeTarget(IDENTITY_REPORT_FORM, state, false) }, state);
  }
  redirect(`/dashboard/cases/${caseId}?sent=1`);
}
