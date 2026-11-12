'use server';

// The Server Action of /people/<slug>/dispute (milestone M25, In scope 2): a thin wrapper over
// disputes.report (src/server/rpc/parity.ts), called in-process with this request's session. The
// evidence is uploaded by the page's evidence field to POST /api/evidence/upload first and removed
// with the M10a action (evidence.discard).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { DISPUTE_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,120}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const GROUNDS = ['never_trained', 'wrong_teacher', 'wrong_dates', 'other'] as const;

/** "Send the report" (disputes.report). */
export async function reportLineageAction(_previous: FormState, form: FormData): Promise<FormState> {
  const slug = textValue(form, 'slug', 120);
  const relationshipId = textValue(form, 'relationshipId', 40);
  const grounds = textValue(form, 'grounds', 20);
  const details = textValue(form, 'details', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  const page = SLUG.test(slug) ? `/people/${slug}/dispute` : '/';
  const values: Record<string, string> = {
    relationshipId,
    grounds,
    details,
    evidence: JSON.stringify(
      evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
    ),
  };
  try {
    await serverClient(await headers(), await getRequestPrincipal()).disputes.report({
      relationshipId: UUID.test(relationshipId) ? relationshipId : '',
      grounds: (GROUNDS as readonly string[]).includes(grounds) ? (grounds as (typeof GROUNDS)[number]) : ('' as 'other'),
      details,
      evidenceIds,
      idempotencyKey: KEY.test(key) ? key : '',
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, values);
    return formResult({ form: DISPUTE_FORM, page, anchor: outcomeTarget(DISPUTE_FORM, state, false) }, state);
  }
  redirect(atOutcome(`${page}?sent=1`));
}
