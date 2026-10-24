'use server';

// The settings page's Server Action (milestone M08, In scope 2): a thin wrapper over the
// account.setType procedure (src/server/rpc/parity.ts). Student or Sifu sets the free plan and
// verifies nothing (DEFAULT D04).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import type { AccountType } from '@/server/entitlements/plans';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export async function setAccountTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'account-type', page: '/dashboard/settings' }, await setAccountType(form));
}

async function setAccountType(form: FormData): Promise<FormState> {
  // The procedure checks the value; this only types what the form sent.
  const accountType = textValue(form, 'accountType', 16) as AccountType;
  try {
    const change = await serverClient(await headers(), await getRequestPrincipal()).account.setType({ accountType });
    refresh();
    const kind = change.accountType === 'sifu' ? 'Sifu' : 'Student';
    if (!change.changed) return { status: 'done', message: `Your account is already a ${kind} account.`, values: { accountType: change.accountType } };
    return {
      status: 'done',
      message:
        change.accountType === 'sifu'
          ? `Your account is now a Sifu account on ${change.plan.name}. It shows as “${change.instructor.label}”.`
          : `Your account is now a Student account on ${change.plan.name}. Your confirmed links stay as they are.`,
      values: { accountType: change.accountType },
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fdashboard%2Fsettings');
    // A refusal, or one calm message for anything unexpected: never rethrown (review round 2, recheck-2).
    return formStateFromFailure(error, accountType ? { accountType } : undefined);
  }
}
