'use server';

// The profile editor's Server Action (milestone M07, In scope 1): a thin wrapper over the
// profile.update procedure (src/server/rpc/parity.ts). It reads the posted fields
// (src/lib/profile-form.ts), calls the procedure, drops the account's own public cache entry with
// updateTag (plan §6.4: the procedure has already expired it with revalidateTag), and answers the
// form, with or without JavaScript (src/server/forms/flash.ts). ADR 0047: the links of a featured
// profile (profile.setLinks), from a Server Component form whose outcome the page shows.

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import type { FormState } from '@/lib/form-state';
import { flattenValues, formFieldOf, profileFormFromData, toUpdateInput } from '@/lib/profile-form';
import { getRequestPrincipal } from '@/server/auth/web';
import { invalidatePublic, personTag } from '@/server/cache';
import { formResult, keepFormResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PROFILE_LINKS_FORM } from './form-ids';

const LINK_ROWS = 5;

export async function saveProfileAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'profile', page: '/dashboard/profile' }, await saveProfile(form));
}

async function saveProfile(form: FormData): Promise<FormState> {
  const values = profileFormFromData(form);
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).profile.update(toUpdateInput(values));
    invalidatePublic([personTag(result.profile.personId)], 'server-action');
    refresh();
    const saved = {
      names: result.profile.names.map((n) => ({
        value: n.value,
        writing: `${n.script}|${n.lang}|${n.romanization ?? ''}`,
        kind: n.kind === 'alias' ? ('alias' as const) : ('name' as const),
      })),
      primary: result.profile.names.findIndex((n) => n.isPrimary),
      bio: result.profile.bio?.body ?? '',
      bioLang: result.profile.bio?.lang ?? 'en',
      countryCode: result.profile.countryCode ?? '',
      placeId: result.profile.placeId ?? '',
      trainingStartYear: result.profile.trainingStartYear === null ? '' : String(result.profile.trainingStartYear),
      showPublicly: result.profile.wantsPublic,
      listOnSchoolPage: result.profile.listOnSchoolPage,
    };
    const visibility = result.visibilityChanged
      ? result.profile.visibility === 'public'
        ? ' Your profile is now public.'
        : ' Your profile is now private.'
      : '';
    return { status: 'done', message: `Your profile is saved.${visibility}`, values: flattenValues(saved) };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fdashboard%2Fprofile');
    if (rpcErrorCode(error) === 'NOT_FOUND') redirect('/onboarding');
    const state = formStateFromFailure(error, flattenValues(values));
    if (state.fields) state.fields = Object.fromEntries(Object.entries(state.fields).map(([k, v]) => [formFieldOf(k), v]));
    return state;
  }
}

/** "Save links" (profile.setLinks): the rows in order, empty ones left out. */
export async function saveProfileLinksAction(_previous: FormState, form: FormData): Promise<void> {
  const values: Record<string, string> = {};
  const rows: { label: string; url: string; row: number }[] = [];
  for (let i = 0; i < LINK_ROWS; i++) {
    const label = String(form.get(`links.${i}.label`) ?? '').slice(0, 240);
    const url = String(form.get(`links.${i}.url`) ?? '').slice(0, 1000);
    values[`links.${i}.label`] = label;
    values[`links.${i}.url`] = url;
    if (label.trim() || url.trim()) rows.push({ label, url, row: i });
  }
  const place = { form: PROFILE_LINKS_FORM, page: '/dashboard/profile', anchor: `${PROFILE_LINKS_FORM}-message` };
  let state: FormState;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).profile.setLinks({ links: rows.map(({ label, url }) => ({ label, url })) });
    refresh();
    state = { status: 'done', message: result.links.length === 0 ? 'Your profile has no links now.' : 'Your links are saved.' };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fdashboard%2Fprofile');
    if (rpcErrorCode(error) === 'NOT_FOUND') redirect('/onboarding');
    state = formStateFromFailure(error, values);
    // The service names the rows it was sent; the form names the rows on the page.
    if (state.fields) {
      state.fields = Object.fromEntries(
        Object.entries(state.fields).map(([key, message]) => {
          const match = /^links\.(\d+)\.(label|url)$/.exec(key);
          const row = match ? rows[Number(match[1])]?.row : undefined;
          return [row === undefined ? key : `links.${row}.${match![2]}`, message];
        }),
      );
    }
  }
  await keepFormResult(place, state);
}
