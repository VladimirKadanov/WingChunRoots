'use server';

// "My lineage is not listed" (journey review 2026-11-26, P2-2; docs/adr/0080-add-a-teacher.md): a
// thin wrapper over lineage.reportMissing (src/server/rpc/parity.ts). The archivists get the name;
// the page says what happens next and leads back to the form the member came from (`next`).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { keepValues, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { MISSING_LINEAGE_FORM, missingLineagePage } from './form-ids';

export async function reportMissingLineageAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(textValue(form, 'next'), '');
  const page = missingLineagePage(next);
  return formResult({ form: MISSING_LINEAGE_FORM, page }, await reportMissingLineage(form, page));
}

async function reportMissingLineage(form: FormData, page: string): Promise<FormState> {
  const values = keepValues(form, ['name']);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).lineage.reportMissing({ name: textValue(form, 'name', 240) });
    return {
      status: 'done',
      message: `Thank you. The archivists now know that ${values.name ?? 'your lineage'} is missing; they add it when the record can hold it. Until then, send your request with “Not sure”: it goes into your teacher’s own lineage, and the archivists can move it later.`,
      values,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    return formStateFromFailure(error, values);
  }
}
