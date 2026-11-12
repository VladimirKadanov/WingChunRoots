'use server';

// The Server Actions of the organization tools (milestone M24; docs/adr/0027-organization-tools.md):
// thin wrappers over organizationTools.importPreview, importCommit, importDiscard, withdrawClaim and
// leave (src/server/rpc/parity.ts), called in-process with this request's session, so the forms and
// /api/v1 run the same checks: the services decide who may do what. The upload is read here only
// to hand its bytes to the procedure as base64 (the API's form of a file); the procedure checks it.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { claimForm, IMPORT_FORM, importForm, leaveForm } from './tools-form-ids';

const HOME = '/dashboard/organization';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The procedure refuses a larger file with its own message; this only bounds what is read here. */
const READ_LIMIT = 512 * 1024;

const importsOf = (id: string) => (UUID.test(id) ? `${HOME}/${id}/import` : HOME);
const importPage = (id: string, importId: string) => (UUID.test(id) && UUID.test(importId) ? `${HOME}/${id}/import/${importId}` : importsOf(id));

async function client() {
  return serverClient(await headers(), await getRequestPrincipal());
}

async function failed(error: unknown, formId: string, page: string, single = true): Promise<FormState> {
  unstable_rethrow(error);
  if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
  const state = formStateFromFailure(error, {});
  return formResult({ form: formId, page, anchor: outcomeTarget(formId, state, single) }, state);
}

/** "Check the file" (organizationTools.importPreview). */
export async function previewImportAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const page = importsOf(organizationId);
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    const state: FormState = { status: 'error', message: 'Choose a CSV file.', fields: { file: 'Choose a CSV file.' } };
    return formResult({ form: IMPORT_FORM, page, anchor: outcomeTarget(IMPORT_FORM, state, true) }, state);
  }
  const bytes = file.size > READ_LIMIT ? new Uint8Array(READ_LIMIT + 1) : new Uint8Array(await file.arrayBuffer());
  let importId: string;
  try {
    const result = await (await client()).organizationTools.importPreview({ organizationId, contentBase64: Buffer.from(bytes).toString('base64') });
    importId = result.id;
  } catch (error) {
    return failed(error, IMPORT_FORM, page);
  }
  redirect(atOutcome(`${importPage(organizationId, importId)}?done=checked`));
}

/** "Import the valid rows" (organizationTools.importCommit). */
export async function commitImportAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const importId = textValue(form, 'importId', 40);
  const page = importPage(organizationId, importId);
  try {
    await (await client()).organizationTools.importCommit({ organizationId, importId });
  } catch (error) {
    return failed(error, importForm('commit', importId), page);
  }
  redirect(atOutcome(`${page}?done=imported`));
}

/** "Discard" (organizationTools.importDiscard). */
export async function discardImportAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const importId = textValue(form, 'importId', 40);
  const page = importPage(organizationId, importId);
  try {
    await (await client()).organizationTools.importDiscard({ organizationId, importId });
  } catch (error) {
    return failed(error, importForm('discard', importId), page);
  }
  redirect(atOutcome(`${page}?done=discarded`));
}

/** "Withdraw" a teacher claim (organizationTools.withdrawClaim). */
export async function withdrawClaimAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const claimId = textValue(form, 'claimId', 40);
  const page = importsOf(organizationId);
  try {
    await (await client()).organizationTools.withdrawClaim({ organizationId, claimId });
  } catch (error) {
    return failed(error, claimForm(claimId), page);
  }
  redirect(atOutcome(`${page}?done=claim-withdrawn`));
}

/** "Leave" a membership of the account's own (organizationTools.leave). */
export async function leaveOrganizationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const membershipId = textValue(form, 'membershipId', 40);
  try {
    await (await client()).organizationTools.leave({ membershipId });
  } catch (error) {
    return failed(error, leaveForm(membershipId), HOME);
  }
  redirect(atOutcome(`${HOME}?done=membership-left`));
}
