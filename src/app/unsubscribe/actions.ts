'use server';

// "Unsubscribe" on /unsubscribe (milestone M18, In scope 4): a thin wrapper over the
// notifications.unsubscribe procedure (src/server/rpc/parity.ts), without signing in. One press; the
// page then says what was switched off and how to switch it on again (post/redirect/get, with and
// without JavaScript).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { serverClient } from '@/server/rpc/server';

export async function unsubscribeAction(form: FormData): Promise<void> {
  const token = textValue(form, 'token', 200);
  let failed = false;
  try {
    await serverClient(await headers(), null).notifications.unsubscribe({ token });
  } catch (error) {
    unstable_rethrow(error);
    // A stale link or another failure: the page reads the link again and says which.
    failed = true;
  }
  redirect(`/unsubscribe?token=${encodeURIComponent(token)}${failed ? '&failed=1' : ''}`);
}
