'use server';

// The Server Actions of /dashboard/teachers/invite (milestone M10b, In scope 1): thin wrappers over
// relationships.invite and invitations.send (src/server/rpc/parity.ts), called in-process with
// this request's session, so the form and /api/v1 run the same checks. Files are uploaded by the
// evidence field to POST /api/evidence/upload and removed with the M10a action (evidence.discard).
// Success goes to Your teachers by the relationship's id only (never a name or an address in a URL).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue, ticked } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { INVITE_FORM, SEND_INVITATION_FORM } from './form-ids';

const PAGE = '/dashboard/teachers/invite';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "2019" or "2019-04" from a year field and an optional month select; null when no year. */
function partialDate(year: string, month: string): string | null {
  if (!year) return null;
  return /^\d{1,2}$/.test(month) ? `${year}-${month.padStart(2, '0')}` : year;
}

/** The procedure's field errors under the form's own field names (the period's year fields). */
function formFields(state: FormState): FormState {
  if (state.status !== 'error' || !state.fields) return state;
  const fields: Record<string, string> = {};
  for (const [name, message] of Object.entries(state.fields)) {
    const mapped = name.replace(/^periods\.0\.from$/, 'fromYear').replace(/^periods\.0\.to$/, 'toYear').replace(/^periods(\..*)?$/, 'fromYear');
    fields[mapped] ??= message;
  }
  return { ...state, fields };
}

/** "Invite your teacher" (relationships.invite). */
export async function inviteTeacherAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values: Record<string, string> = {};
  for (const name of ['teacherName', 'originalName', 'originalLang', 'lineageId', 'fromYear', 'fromMonth', 'toYear', 'toMonth', 'email', 'idempotencyKey'] as const) {
    const value = textValue(form, name, name === 'email' ? 400 : 300);
    if (value) values[name] = value;
  }
  const ongoing = ticked(form, 'ongoing');
  if (ongoing) values.ongoing = 'on';
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  // The uploaded files come back to the field after a refusal: their ids, names and kinds.
  values.evidence = JSON.stringify(
    evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
  );
  let invited: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).relationships.invite({
      teacherName: values.teacherName ?? '',
      originalName: values.originalName ?? null,
      originalLang: values.originalLang ?? null,
      lineageId: UUID.test(values.lineageId ?? '') ? values.lineageId! : null,
      periods: [
        {
          from: partialDate(values.fromYear ?? '', values.fromMonth ?? ''),
          to: ongoing ? null : partialDate(values.toYear ?? '', values.toMonth ?? ''),
          ongoing,
        },
      ],
      email: values.email ?? null,
      evidenceIds,
      displayPrimary: false,
      // The form always sends one; a missing key is refused by the procedure like any bad input.
      idempotencyKey: KEY.test(values.idempotencyKey ?? '') ? values.idempotencyKey! : '',
    });
    invited = result.relationship.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formFields(formStateFromFailure(error, values));
    return formResult({ form: INVITE_FORM, page: PAGE, anchor: outcomeTarget(INVITE_FORM, state, false) }, state);
  }
  redirect(atOutcome(`/dashboard/teachers?invited=${invited}`));
}

/** "Send the invitation" of a request that waits for its teacher to join (invitations.send). */
export async function sendInvitationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const relationshipId = textValue(form, 'relationshipId', 40);
  const email = textValue(form, 'email', 400);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = UUID.test(relationshipId) ? `${PAGE}?relationship=${relationshipId}` : PAGE;
  try {
    await serverClient(await headers(), await getRequestPrincipal()).invitations.send({ relationshipId, email, idempotencyKey: KEY.test(key) ? key : '' });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    // The address is shown again in the field, never put in an address of the page.
    const state = formStateFromFailure(error, { relationshipId, email });
    return formResult({ form: SEND_INVITATION_FORM, page, anchor: outcomeTarget(SEND_INVITATION_FORM, state, true) }, state);
  }
  redirect(atOutcome(`/dashboard/teachers?invitation=${relationshipId}`));
}
