'use server';

// The Server Actions of /dashboard/teachers/historical (milestone M10a, In scope 1 and 2): thin
// wrappers over relationships.requestHistorical and evidence.discard (src/server/rpc/parity.ts),
// called in-process with this request's session, so the form and /api/v1 run the same checks. The
// files themselves are uploaded by the page's evidence field to POST /api/evidence/upload (a binary
// route handler; no Server Action carries a file). Success goes to Your teachers, by the claim's
// relationship id only (never a name in an address).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { HISTORICAL_FORM } from './form-ids';

const PAGE = '/dashboard/teachers/historical';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "2019" or "2019-04" from a year field and an optional month select; null when no year. */
function partialDate(year: string, month: string): string | null {
  if (!year) return null;
  return /^\d{1,2}$/.test(month) ? `${year}-${month.padStart(2, '0')}` : year;
}

/** The procedure's field errors under the form's own field names (a period's year fields). */
function formFields(state: FormState): FormState {
  if (state.status !== 'error' || !state.fields) return state;
  const fields: Record<string, string> = {};
  for (const [name, message] of Object.entries(state.fields)) {
    const mapped = name.replace(/^periods\.0\.from$/, 'fromYear').replace(/^periods\.0\.to$/, 'toYear').replace(/^periods(\..*)?$/, 'fromYear');
    fields[mapped] ??= message;
  }
  return { ...state, fields };
}

/** "Send the claim" (relationships.requestHistorical). */
export async function requestHistoricalAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values: Record<string, string> = {};
  for (const name of [
    'teacherId',
    'teacherSlug',
    'teacherName',
    'originalName',
    'originalLang',
    'lifeStatus',
    'lineageId',
    'fromYear',
    'fromMonth',
    'toYear',
    'toMonth',
    'note',
    'idempotencyKey',
  ] as const) {
    const value = textValue(form, name, name === 'note' ? 4000 : 300);
    if (value) values[name] = value;
  }
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  // The uploaded files come back to the field after a refusal: their ids, names and kinds.
  values.evidence = JSON.stringify(
    evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
  );
  const teacherId = UUID.test(values.teacherId ?? '') ? values.teacherId! : null;
  const page = values.teacherSlug && /^[a-z0-9-]{1,120}$/.test(values.teacherSlug) ? `${PAGE}?teacher=${values.teacherSlug}` : PAGE;
  let sent: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).relationships.requestHistorical({
      teacherId,
      teacherName: teacherId ? null : (values.teacherName ?? ''),
      originalName: teacherId ? null : (values.originalName ?? null),
      originalLang: teacherId ? null : (values.originalLang ?? null),
      lifeStatus: values.lifeStatus === 'deceased' ? 'deceased' : 'unknown',
      lineageId: UUID.test(values.lineageId ?? '') ? values.lineageId! : null,
      periods: [
        {
          from: partialDate(values.fromYear ?? '', values.fromMonth ?? ''),
          to: partialDate(values.toYear ?? '', values.toMonth ?? ''),
          ongoing: false,
        },
      ],
      note: values.note ?? null,
      evidenceIds,
      displayPrimary: false,
      // The form always sends one; a missing key is refused by the procedure like any bad input.
      idempotencyKey: KEY.test(values.idempotencyKey ?? '') ? values.idempotencyKey! : '',
    });
    sent = result.relationship.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formFields(formStateFromFailure(error, values));
    return formResult({ form: HISTORICAL_FORM, page, anchor: outcomeTarget(HISTORICAL_FORM, state, false) }, state);
  }
  redirect(atOutcome(`/dashboard/teachers?claimed=${sent}`));
}

/** "Remove" of an uploaded file that is in no claim yet (evidence.discard), from the evidence field. */
export async function discardEvidenceAction(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await serverClient(await headers(), await getRequestPrincipal()).evidence.discard({ id: UUID.test(id) ? id : '' });
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    const state = formStateFromFailure(error);
    return { ok: false, message: state.message };
  }
}
