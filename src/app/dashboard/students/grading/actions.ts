'use server';

// "Record the grading" on /dashboard/students/grading (role replay 2026-11-25, P2-8, ADR 0072): a
// thin Server Action over passport.recordGrading, called in-process with this request's session, so
// the form and /api/v1 run the same checks (each ticked student is the account's to record for,
// all or nothing). A failure comes back to the form (without JavaScript as a kept result).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { GRADING_FORM } from '../form-ids';

const PAGE = '/dashboard/students/grading';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: string) => (UUID.test(value) ? value : null);

export async function recordGradingAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personIds = form
    .getAll('personId')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 100);
  const values = {
    awardedRank: textValue(form, 'awardedRank', 240),
    date: textValue(form, 'date', 20),
    examinerPersonId: textValue(form, 'examinerPersonId', 40),
    organizationId: textValue(form, 'organizationId', 40),
    alsoRank: textValue(form, 'alsoRank', 2) === 'on' ? 'on' : '',
    personIds: personIds.join(','),
  };
  let recorded: number;
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    const result = await client.passport.recordGrading({
      awardedRank: values.awardedRank,
      date: values.date || null,
      examinerPersonId: uuidOrNull(values.examinerPersonId),
      organizationId: uuidOrNull(values.organizationId),
      personIds,
      alsoRank: values.alsoRank === 'on',
    });
    recorded = result.recorded;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, values);
    return formResult({ form: GRADING_FORM, page: PAGE, anchor: outcomeTarget(GRADING_FORM, state, false) }, state);
  }
  redirect(`/dashboard/students?graded=${recorded}`);
}
