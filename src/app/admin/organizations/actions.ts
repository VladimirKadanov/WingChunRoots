'use server';

// The Server Actions of /admin/organizations/<id> (milestone M15): thin wrappers over
// organizations.grant and organizations.revokeGrant (src/server/rpc/parity.ts). The procedures
// require an administrator with a verified second factor, whoever calls them. DEFAULT D09: the
// plan is a test or complimentary grant only; nothing is charged.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { keepValues, textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { GRANT_FORM, revokeForm } from './form-ids';

const LIST = '/admin/organizations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageOf = (id: string) => (UUID.test(id) ? `${LIST}/${id}` : LIST);

async function failed(error: unknown, formId: string, page: string, values: Record<string, string>, single: boolean): Promise<FormState> {
  unstable_rethrow(error);
  if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
  if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(`/account/security?next=${encodeURIComponent(page)}`);
  const state = formStateFromFailure(error, values);
  return formResult({ form: formId, page, anchor: outcomeTarget(formId, state, single) }, state);
}

/** "Give the Federation plan" (organizations.grant). */
export async function grantOrganizationPlanAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const page = pageOf(organizationId);
  const values = keepValues(form, ['source', 'reason', 'startsOn', 'endsOn']);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).organizations.grant({
      organizationId,
      planCode: 'federation',
      source: (textValue(form, 'source', 40) || undefined) as 'test_grant' | undefined,
      reason: textValue(form, 'reason', 1000),
      startsOn: textValue(form, 'startsOn', 16),
      endsOn: textValue(form, 'endsOn', 16),
    });
  } catch (error) {
    return failed(error, GRANT_FORM, page, values, false);
  }
  redirect(atOutcome(`${page}?done=granted`));
}

/** "Revoke" (organizations.revokeGrant): members, school links and the public page stay (DEFAULT D08). */
export async function revokeOrganizationPlanAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const grantId = textValue(form, 'grantId', 40);
  const page = pageOf(organizationId);
  const reason = textValue(form, 'reason', 1000);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).organizations.revokeGrant({ grantId, reason });
  } catch (error) {
    return failed(error, revokeForm(grantId), page, { reason }, true);
  }
  redirect(atOutcome(`${page}?done=revoked`));
}
