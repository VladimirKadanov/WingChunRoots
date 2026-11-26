'use server';

// "My city is missing" (role replay 2026-11-25, P2-12): a thin wrapper over places.reportMissing
// (src/server/rpc/parity.ts). The admins get the name and the country; the page says what happens
// next and leads back to the form the member came from (`next`).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { keepValues, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { MISSING_PLACE_FORM, missingPlacePage } from './form-ids';

export async function reportMissingPlaceAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(textValue(form, 'next'), '');
  const page = missingPlacePage(next);
  return formResult({ form: MISSING_PLACE_FORM, page }, await reportMissingPlace(form, page));
}

async function reportMissingPlace(form: FormData, page: string): Promise<FormState> {
  const values = keepValues(form, ['name', 'countryCode']);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).places.reportMissing({
      name: textValue(form, 'name', 200),
      countryCode: textValue(form, 'countryCode', 2),
    });
    return {
      status: 'done',
      message: `Thank you. The administrators now know that ${values.name ?? 'your city'} is missing; it appears in the city list once they add it. Until then, choose the nearest listed city, or leave the city empty where the form allows it.`,
      values,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    return formStateFromFailure(error, values);
  }
}
