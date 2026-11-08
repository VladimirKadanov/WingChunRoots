'use server';

// The Server Actions of /dashboard/passport (milestone M19, In scope 6 and 7): thin wrappers over
// passport.setVisibility and passport.updateEntry (a proposed correction; src/server/rpc/parity.ts),
// called in-process with this request's session, so the page and /api/v1 run the same checks. A
// failure is never rethrown as it is: the form shows the procedure's answer. Without JavaScript a
// failure comes back to the form as a kept result (src/server/forms/flash.ts). Certificates are
// uploaded and removed from the browser through /api/rpc (passport.uploadCertificate,
// passport.removeCertificate), as a gallery photo is.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PASSPORT_CORRECTION_FORM, PASSPORT_VISIBILITY_FORM } from './form-ids';

const PAGE = '/dashboard/passport';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['rank', 'exam', 'skill', 'certificate', 'attendance'] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (value: string): Kind => ((KINDS as readonly string[]).includes(value) ? (value as Kind) : 'rank');

/** "Make private" / "Make public" (passport.setVisibility). */
export async function setVisibilityAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const kind = kindOf(textValue(form, 'kind', 20));
  const visibility = textValue(form, 'visibility', 10) === 'public' ? 'public' : 'private';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.setVisibility({ kind, id: UUID.test(id) ? id : '', visibility });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { id, kind });
    return formResult({ form: PASSPORT_VISIBILITY_FORM, page: PAGE, anchor: outcomeTarget(PASSPORT_VISIBILITY_FORM, state, true) }, state);
  }
  redirect(`${PAGE}?${visibility === 'public' ? 'published' : 'hidden'}=1#entry-${UUID.test(id) ? id : ''}`);
}

/** "Send the correction" (passport.updateEntry with `correction` only): it waits for whoever recorded it. */
export async function proposeCorrectionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const kind = textValue(form, 'kind', 20);
  const correction = textValue(form, 'correction', 2000);
  const writable = kind === 'exam' || kind === 'skill' ? kind : 'rank';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.updateEntry({ kind: writable, id: UUID.test(id) ? id : '', correction });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { id, kind, correction });
    return formResult({ form: PASSPORT_CORRECTION_FORM, page: PAGE, anchor: outcomeTarget(PASSPORT_CORRECTION_FORM, state, true) }, state);
  }
  redirect(`${PAGE}?corrected=1#entry-${UUID.test(id) ? id : ''}`);
}
