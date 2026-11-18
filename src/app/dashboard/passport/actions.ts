'use server';

// The Server Actions of /dashboard/passport (milestone M19, In scope 6 and 7): thin wrappers over
// passport.setVisibility and passport.updateEntry (a proposed correction; src/server/rpc/parity.ts),
// called in-process with this request's session, so the page and /api/v1 run the same checks. A
// failure is never rethrown as it is: the form shows the procedure's answer. Without JavaScript a
// failure comes back to the form as a kept result (src/server/forms/flash.ts). Certificates are
// uploaded and removed from the browser through /api/rpc (passport.uploadCertificate,
// passport.removeCertificate), as a gallery photo is. ADR 0046: asking an event's organizer to
// confirm attendance (passport.claimAttendance) and taking the request back (passport.withdrawEntry);
// the grading photos of a rank (passport.setRankPhotos).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PASSPORT_CLAIM_FORM, PASSPORT_CLAIM_WITHDRAW_FORM, PASSPORT_CORRECTION_FORM, PASSPORT_RANK_PHOTOS_FORM, PASSPORT_VISIBILITY_FORM } from './form-ids';

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

/** "Ask the organizer to confirm" (passport.claimAttendance): the request waits, shown only here. */
export async function claimAttendanceAction(_previous: FormState, form: FormData): Promise<FormState> {
  const eventId = textValue(form, 'eventId', 40);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.claimAttendance({ eventId: UUID.test(eventId) ? eventId : '' });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { eventId });
    return formResult({ form: PASSPORT_CLAIM_FORM, page: PAGE, anchor: outcomeTarget(PASSPORT_CLAIM_FORM, state, true) }, state);
  }
  redirect(`${PAGE}?claimed=1#passport-claims`);
}

/** "Take back the request" (passport.withdrawEntry of a claim that still waits). */
export async function withdrawClaimAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.withdrawEntry({ kind: 'attendance', id: UUID.test(id) ? id : '' });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { id });
    return formResult({ form: PASSPORT_CLAIM_WITHDRAW_FORM, page: PAGE, anchor: outcomeTarget(PASSPORT_CLAIM_WITHDRAW_FORM, state, true) }, state);
  }
  redirect(`${PAGE}?claimWithdrawn=1#passport-entries`);
}

/** "Save photos" of a rank (passport.setRankPhotos): the ticked gallery photos, in gallery order. */
export async function setRankPhotosAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  // Ten at most are passed on: the service refuses more than three with its own words.
  const photoIds = form
    .getAll('photoId')
    .filter((value): value is string => typeof value === 'string' && UUID.test(value))
    .slice(0, 10);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.setRankPhotos({ rankId: UUID.test(id) ? id : '', photoIds });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { id });
    return formResult({ form: PASSPORT_RANK_PHOTOS_FORM, page: PAGE, anchor: outcomeTarget(PASSPORT_RANK_PHOTOS_FORM, state, true) }, state);
  }
  redirect(`${PAGE}?photosSaved=1#entry-${UUID.test(id) ? id : ''}`);
}
