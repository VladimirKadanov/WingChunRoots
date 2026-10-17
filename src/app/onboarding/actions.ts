'use server';

// The onboarding Server Action (milestone M02, In scope 3 and 5): a thin wrapper over the
// consent.record and account.onboard procedures (src/server/rpc/parity.ts), called in-process
// with this request's session, so the form and /api/v1 run the same checks.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { CONSENT_ORDER, CONSENT_REQUIRED_MESSAGES } from '@/components/account/consents';
import { keepValues, textValue, ticked } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { formStateFromRpcError, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

const TEXT_FIELDS = ['primaryName', 'originalName', 'originalLang', 'jyutping', 'pinyin', 'countryCode', 'placeId', 'trainingStartYear', 'next'];

export async function onboardAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, TEXT_FIELDS, ['showPublicly', ...CONSENT_ORDER]);
  const next = safeNextPath(textValue(form, 'next'), '/account');
  const client = serverClient(await headers());

  // The ticks are on the form only when a required confirmation is missing for the current
  // version of the documents (an account created before a new version, or without the sign-up form).
  const required = form.getAll('requiredConsent').filter((v): v is string => typeof v === 'string');
  if (required.length > 0) {
    const fields: Record<string, string> = {};
    for (const kind of CONSENT_ORDER) {
      if (required.includes(kind) && !ticked(form, kind)) fields[kind] = CONSENT_REQUIRED_MESSAGES[kind];
    }
    if (Object.keys(fields).length > 0) return { status: 'error', message: 'Check the highlighted fields.', fields, values };
    const kinds = CONSENT_ORDER.filter((kind) => ticked(form, kind));
    try {
      await client.consent.record({ kinds });
    } catch (error) {
      if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fonboarding');
      const state = formStateFromRpcError(error, values);
      if (state) return state;
      throw error;
    }
  }

  let conflict = false;
  try {
    await client.account.onboard({
      primaryName: textValue(form, 'primaryName', 240),
      originalName: textValue(form, 'originalName', 240),
      originalLang: textValue(form, 'originalLang', 16),
      jyutping: textValue(form, 'jyutping', 240),
      pinyin: textValue(form, 'pinyin', 240),
      countryCode: textValue(form, 'countryCode', 2),
      placeId: textValue(form, 'placeId', 36),
      trainingStartYear: textValue(form, 'trainingStartYear', 4),
      showPublicly: ticked(form, 'showPublicly'),
    });
  } catch (error) {
    const code = rpcErrorCode(error);
    if (code === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fonboarding');
    if (code === 'CONFLICT') conflict = true;
    else {
      const state = formStateFromRpcError(error, values);
      if (state) return state;
      throw error;
    }
  }
  // Created now, or already there (a second submit): either way the profile exists.
  redirect(conflict ? '/account' : next);
}
