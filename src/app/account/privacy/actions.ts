'use server';

// The Server Actions of /account/privacy (milestone M07, In scope 5 and 7): thin wrappers over the
// consent.withdraw and account.requestDeletion procedures (src/server/rpc/parity.ts). Both work
// without JavaScript (src/server/forms/flash.ts).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue, ticked } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

const PAGE = '/account/privacy';

export async function withdrawConsentAction(_previous: FormState, form: FormData): Promise<FormState> {
  const kind = textValue(form, 'kind', 32);
  return formResult({ form: `withdraw-${kind === 'publication' ? 'publication' : 'privacy_ack'}`, page: PAGE }, await withdraw(kind));
}

async function withdraw(kind: string): Promise<FormState> {
  try {
    // The procedure checks the value; this only types what the form sent.
    const result = await serverClient(await headers(), await getRequestPrincipal()).consent.withdraw({ kinds: [kind as 'publication'] });
    refresh();
    if (kind === 'publication') {
      return {
        status: 'done',
        message: result.profileHidden
          ? 'Your consent to publication is withdrawn and your profile is private again.'
          : 'Your consent to publication is withdrawn. Your profile was already private.',
      };
    }
    return { status: 'done', message: result.withdrawn.length > 0 ? 'Your acknowledgement of the privacy notice is withdrawn.' : 'It was already withdrawn.' };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Faccount%2Fprivacy');
    return formStateFromFailure(error);
  }
}

export async function requestDeletionAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'deletion', page: PAGE, anchor: 'delete-account' }, await requestDeletion(ticked(form, 'confirm')));
}

async function requestDeletion(confirm: boolean): Promise<FormState> {
  if (!confirm) {
    return { status: 'error', message: 'Tick the box to confirm.', fields: { confirm: 'Tick this box to confirm that you want your account deleted.' } };
  }
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).account.requestDeletion({ confirm: true });
    refresh();
    return {
      status: 'done',
      message: result.created
        ? 'Your request is sent. An administrator carries it out and you will be signed out when your account is deleted.'
        : 'You have already asked for your account to be deleted. The request is open.',
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Faccount%2Fprivacy');
    return formStateFromFailure(error);
  }
}
