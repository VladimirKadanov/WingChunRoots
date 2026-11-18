'use server';

// The Server Action of /account/notifications (milestone M18, In scope 3; on /dashboard/settings
// until the usability review of 2026-11): the e-mail of each category of notices, a thin wrapper
// over notifications.preferences and notifications.setPreference (one call per category the form
// changed; src/server/rpc/parity.ts).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { outcomeTarget, type FormState } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { NOTIFICATIONS_FORM } from './form-ids';

/**
 * M18 (In scope 3): "Save e-mail settings". The form lists every category that can be switched off,
 * each a checkbox (`email:<category>` = on when ticked); security and account are not in it.
 */
export async function setNotificationEmailsAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await setNotificationEmails(form);
  return formResult({ form: NOTIFICATIONS_FORM, page: '/account/notifications', anchor: outcomeTarget(NOTIFICATIONS_FORM, state, false) }, state);
}

async function setNotificationEmails(form: FormData): Promise<FormState> {
  const client = serverClient(await headers(), await getRequestPrincipal());
  try {
    const { categories } = await client.notifications.preferences();
    const values: Record<string, string> = {};
    let changed = 0;
    for (const category of categories) {
      if (category.locked) continue;
      const email = form.get(`email:${category.category}`) === 'on';
      values[`email:${category.category}`] = email ? 'on' : 'off';
      if (email === category.email) continue;
      await client.notifications.setPreference({ category: category.category, email });
      changed++;
    }
    refresh();
    return { status: 'done', message: changed === 0 ? 'Nothing changed: your e-mail settings were already these.' : 'Your e-mail settings are saved. Dashboard notifications stay on.', values };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Faccount%2Fnotifications');
    return formStateFromFailure(error);
  }
}
