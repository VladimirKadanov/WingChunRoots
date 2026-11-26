'use client';

// The form of "My city is missing" (role replay 2026-11-25, P2-12): the name as the member writes
// it and the country. `initial` is the outcome of a submit without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { reportMissingPlaceAction } from './actions';
import { MISSING_PLACE_FORM } from './form-ids';

const LABELS = { name: 'City or town', countryCode: 'Country' };
const ORDER = ['name', 'countryCode'] as const;

export function MissingPlaceForm({
  countries,
  countryCode,
  next,
  initial,
}: {
  countries: readonly { code: string; name: string }[];
  /** The country of the member's profile, chosen first. */
  countryCode: string | null;
  next: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(reportMissingPlaceAction, initial ?? IDLE);
  const FORM = useFormId(MISSING_PLACE_FORM);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, ORDER);
  const value = (name: string) => state.values?.[name] ?? '';
  return (
    <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="missing-place-form">
      <input type="hidden" name="next" value={next} />
      <FormMessage form={FORM} state={state} labels={LABELS} />
      <TextField
        form={FORM}
        name="name"
        label={LABELS.name}
        autoComplete="address-level2"
        autoCapitalize="words"
        enterKeyHint="next"
        maxLength={100}
        hint="As you write it: any script is fine."
        state={state}
        autoFocus={first === 'name'}
        defaultValue={state.status === 'done' ? '' : value('name')}
      />
      <SelectField
        form={FORM}
        name="countryCode"
        label={LABELS.countryCode}
        autoComplete="country"
        state={state}
        autoFocus={first === 'countryCode'}
        defaultValue={value('countryCode') || countryCode || ''}
      >
        <option value="" disabled>
          Choose the country
        </option>
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </SelectField>
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Tell the administrators
        </SubmitButton>
      </div>
    </form>
  );
}
