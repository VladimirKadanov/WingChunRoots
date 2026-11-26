'use server';

// The onboarding Server Actions (milestone M02, In scope 3, 4 and 5): thin wrappers over the
// consent.record, account.onboard and account.setType procedures (src/server/rpc/parity.ts),
// called in-process with this request's session, so the forms and /api/v1 run the same checks.
// Both end on `next`, /dashboard when there is none (./destination.ts).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { CONSENT_CONTINUE_MESSAGES, CONSENT_NEW_VERSION_MESSAGES, CONSENT_ORDER, type ConsentName } from '@/components/account/consents';
import { keepValues, textValue, ticked } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult, keepFormResult } from '@/server/forms/flash';
import { formStateFromFailure, formStateFromRpcError, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { afterOnboarding, afterOnboardingFor, chosenAccountType, onboardingNext, onboardingPage } from './destination';

const TEXT_FIELDS = ['primaryName', 'originalName', 'originalLang', 'jyutping', 'pinyin', 'countryCode', 'placeId', 'trainingStartYear', 'accountType', 'takesPart', 'next'];

/**
 * The required ticks named by the form that are not ticked, as field errors, in the words of the
 * form's flow: the account exists already (screens-3).
 */
function missingTicks(form: FormData, messages: Record<ConsentName, string>): Record<string, string> {
  const required = form.getAll('requiredConsent').filter((v): v is string => typeof v === 'string');
  const fields: Record<string, string> = {};
  for (const kind of CONSENT_ORDER) {
    if (required.includes(kind) && !ticked(form, kind)) fields[kind] = messages[kind];
  }
  return fields;
}

export async function onboardAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = onboardingNext(textValue(form, 'next'));
  return formResult({ form: 'onboarding', page: onboardingPage(next) }, await onboard(form, next));
}

async function onboard(form: FormData, next: string): Promise<FormState> {
  const values = keepValues(form, TEXT_FIELDS, ['showPublicly', 'trains', 'teaches', ...CONSENT_ORDER]);
  const client = serverClient(await headers(), await getRequestPrincipal());

  // The ticks are on the form only when a required confirmation is missing for the current
  // version of the documents (an account created before a new version, or without the sign-up form).
  if (form.getAll('requiredConsent').length > 0) {
    const fields = missingTicks(form, CONSENT_CONTINUE_MESSAGES);
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
  // Created now, or already there (a second submit): either way the profile exists, and the
  // account type is the one chosen on the form.
  await applyAccountType(client, form);
  // Role replay 2026-11-25 (P3-5): the shell's account entry (name and initials) is read again, so
  // the header shows the new name without a reload.
  refresh();
  redirect(conflict ? '/account' : afterOnboardingFor(form, next));
}

/**
 * "I train" or "I teach": the same account.setType as /account/plan, once the profile is
 * saved. The type the account already has changes and counts nothing. A refusal (the daily limit of
 * changes, a renewing paid plan) leaves the saved profile as it is and opens the settings page with
 * the reason, where the choice can be made again.
 */
async function applyAccountType(client: ReturnType<typeof serverClient>, form: FormData): Promise<void> {
  const accountType = chosenAccountType(form);
  if (!accountType) return;
  try {
    await client.account.setType({ accountType });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Faccount%2Fplan');
    const failure = formStateFromFailure(error);
    await keepFormResult(
      { form: 'account-type', page: '/account/plan' },
      { status: 'error', message: `Your profile is saved, but your account type was not changed. ${failure.message ?? ''}`.trim() },
    );
  }
}

/**
 * The consent-only form of /onboarding: an account with a profile confirms a new version of the
 * documents through consent.record, then continues to `next`. A required tick left empty is
 * refused here with its message; landingPath and /onboarding ask again while one is missing.
 */
export async function confirmConsentsAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = onboardingNext(textValue(form, 'next'));
  return formResult({ form: 'confirm-consents', page: onboardingPage(next) }, await confirmConsents(form, next));
}

async function confirmConsents(form: FormData, next: string): Promise<FormState> {
  const values = keepValues(form, ['next'], CONSENT_ORDER);
  const fields = missingTicks(form, CONSENT_NEW_VERSION_MESSAGES);
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
  redirect(afterOnboarding(next));
}
