'use server';

// The onboarding Server Actions (milestone M02, In scope 3, 4 and 5): thin wrappers over the
// consent.record and account.onboard procedures (src/server/rpc/parity.ts), called in-process
// with this request's session, so the forms and /api/v1 run the same checks.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { CONSENT_ORDER, CONSENT_REQUIRED_MESSAGES } from '@/components/account/consents';
import { keepValues, textValue, ticked } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { getRequestPrincipal } from '@/server/auth/web';
import { formStateFromRpcError, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

const TEXT_FIELDS = ['primaryName', 'originalName', 'originalLang', 'jyutping', 'pinyin', 'countryCode', 'placeId', 'trainingStartYear', 'next'];

/** The required ticks named by the form that are not ticked, as field errors. */
function missingTicks(form: FormData): Record<string, string> {
  const required = form.getAll('requiredConsent').filter((v): v is string => typeof v === 'string');
  const fields: Record<string, string> = {};
  for (const kind of CONSENT_ORDER) {
    if (required.includes(kind) && !ticked(form, kind)) fields[kind] = CONSENT_REQUIRED_MESSAGES[kind];
  }
  return fields;
}

export async function onboardAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, TEXT_FIELDS, ['showPublicly', ...CONSENT_ORDER]);
  const next = safeNextPath(textValue(form, 'next'), '/account');
  const client = serverClient(await headers(), await getRequestPrincipal());

  // The ticks are on the form only when a required confirmation is missing for the current
  // version of the documents (an account created before a new version, or without the sign-up form).
  if (form.getAll('requiredConsent').length > 0) {
    const fields = missingTicks(form);
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
    // The caps only bound the work; each is above the service's own limit, so over-long input is
    // refused by account.onboard (as through /api/v1), never cut into something valid.
    await client.account.onboard({
      primaryName: textValue(form, 'primaryName', 240),
      originalName: textValue(form, 'originalName', 240),
      originalLang: textValue(form, 'originalLang', 16),
      jyutping: textValue(form, 'jyutping', 240),
      pinyin: textValue(form, 'pinyin', 240),
      countryCode: textValue(form, 'countryCode', 8),
      placeId: textValue(form, 'placeId', 64),
      trainingStartYear: textValue(form, 'trainingStartYear', 8),
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

/**
 * The consent-only form of /onboarding: an account with a profile confirms a new version of the
 * documents through consent.record, then continues to `next`. A required tick left empty is
 * refused here with its message; landingPath and /onboarding ask again while one is missing.
 */
export async function confirmConsentsAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, ['next'], CONSENT_ORDER);
  const next = safeNextPath(textValue(form, 'next'), '/account');
  const fields = missingTicks(form);
  if (Object.keys(fields).length > 0) return { status: 'error', message: 'Check the highlighted fields.', fields, values };
  const kinds = CONSENT_ORDER.filter((kind) => ticked(form, kind));
  if (kinds.length === 0) return { status: 'error', message: 'Tick the confirmations to continue.', values };
  try {
    await serverClient(await headers(), await getRequestPrincipal()).consent.record({ kinds });
  } catch (error) {
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fonboarding');
    const state = formStateFromRpcError(error, values);
    if (state) return state;
    throw error;
  }
  redirect(next === '/onboarding' ? '/account' : next);
}
