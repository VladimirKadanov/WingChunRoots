'use server';

// The Server Action of /people/<slug>/record (milestone M25, In scope 3): a thin wrapper over
// records.propose (src/server/rpc/parity.ts), called in-process with this request's session.
// Nothing on the record changes until an archivist approves the proposal.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PROPOSE_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,120}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "Send the proposal" (records.propose). */
export async function proposeRecordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values: Record<string, string> = {};
  for (const name of ['personId', 'slug', 'primaryName', 'originalName', 'originalLang', 'lifeStatus', 'bio', 'reason', 'idempotencyKey'] as const) {
    const value = textValue(form, name, name === 'bio' || name === 'reason' ? 4000 : 300);
    if (value) values[name] = value;
  }
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  values.evidence = JSON.stringify(
    evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
  );
  const page = SLUG.test(values.slug ?? '') ? `/people/${values.slug}/record` : '/';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).records.propose({
      personId: UUID.test(values.personId ?? '') ? values.personId! : '',
      primaryName: values.primaryName ?? '',
      originalName: values.originalName ?? null,
      originalLang: values.originalLang ?? null,
      lifeStatus: values.lifeStatus === 'living' || values.lifeStatus === 'deceased' ? values.lifeStatus : 'unknown',
      bio: values.bio ?? null,
      reason: values.reason ?? '',
      evidenceIds,
      idempotencyKey: KEY.test(values.idempotencyKey ?? '') ? values.idempotencyKey! : '',
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, values);
    return formResult({ form: PROPOSE_FORM, page, anchor: outcomeTarget(PROPOSE_FORM, state, false) }, state);
  }
  redirect(atOutcome(`${page}?sent=1`));
}
