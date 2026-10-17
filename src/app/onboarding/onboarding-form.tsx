'use client';

import { useActionState, useState } from 'react';

import { CONSENT_ORDER } from '@/components/account/consents';
import { CheckboxField, FormMessage, SelectField, SubmitButton, TextField, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE } from '@/lib/form-state';
import { onboardAction } from './actions';
import { MissingConsents } from './missing-consents';

const FORM_NAME = 'onboarding';

const FIELD_ORDER = [
  ...CONSENT_ORDER,
  'primaryName',
  'originalLang',
  'originalName',
  'jyutping',
  'pinyin',
  'countryCode',
  'placeId',
  'trainingStartYear',
];

export interface OnboardingFormOptions {
  countries: readonly { code: string; name: string }[];
  places: readonly { id: string; name: string; countryCode: string }[];
  scripts: readonly { lang: string; label: string }[];
  latestStartYear: number;
}

export function OnboardingForm({
  options,
  missingConsents,
  next,
}: {
  options: OnboardingFormOptions;
  /** Required confirmations not given for the current documents. */
  missingConsents: readonly string[];
  next: string;
}) {
  const [state, action, pending] = useActionState(onboardAction, IDLE);
  const [originalLang, setOriginalLang] = useState(state.values?.originalLang ?? '');
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, FIELD_ORDER);
  const countryName = new Map(options.countries.map((c) => [c.code, c.name]));
  const placesByCountry = new Map<string, OnboardingFormOptions['places'][number][]>();
  for (const place of options.places) placesByCountry.set(place.countryCode, [...(placesByCountry.get(place.countryCode) ?? []), place]);

  return (
    <form id={FORM} action={action} noValidate className="grid gap-10">
      <input type="hidden" name="next" value={next} />
      <FormMessage form={FORM} state={state} />

      <MissingConsents form={FORM} state={state} missingConsents={missingConsents} first={first} legend="First, confirm" />

      <fieldset className="grid gap-6">
        <legend className="mb-4 font-display text-2xl">Your name</legend>
        <TextField
          form={FORM}
          name="primaryName"
          label="Name in Latin letters"
          autoComplete="name"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={120}
          hint='The name people know you by, written in Latin letters, for example "So Chuk-ching" or "Mira Probnova". It is shown first.'
          state={state}
          autoFocus={first === 'primaryName'}
        />
        <SelectField
          form={FORM}
          name="originalLang"
          label="Original script"
          optional
          autoComplete="off"
          hint="If your name is also written in another script, choose it here and type the name below."
          state={state}
          autoFocus={first === 'originalLang'}
          onChange={(value) => setOriginalLang(value)}
        >
          <option value="">None</option>
          {options.scripts.map((script) => (
            <option key={script.lang} value={script.lang}>
              {script.label}
            </option>
          ))}
        </SelectField>
        <TextField
          form={FORM}
          name="originalName"
          label="Name in the original script"
          optional
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          lang={originalLang || undefined}
          hint="For example 蘇竹晴 in Traditional Chinese characters or Мира Пробнова in Cyrillic."
          state={state}
          autoFocus={first === 'originalName'}
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            form={FORM}
            name="jyutping"
            label="Jyutping"
            optional
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={120}
            hint="Cantonese, with tone numbers: sou1 zuk1 cing4."
            state={state}
            autoFocus={first === 'jyutping'}
          />
          <TextField
            form={FORM}
            name="pinyin"
            label="Pinyin"
            optional
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            hint="Mandarin: Sū Zhúqíng."
            state={state}
            autoFocus={first === 'pinyin'}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-4 font-display text-2xl">Where and since when</legend>
        <SelectField
          form={FORM}
          name="countryCode"
          label="Country"
          optional
          autoComplete="country"
          state={state}
          autoFocus={first === 'countryCode'}
        >
          <option value="">Not given</option>
          {options.countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          form={FORM}
          name="placeId"
          label="City"
          optional
          autoComplete="off"
          hint="The pilot lists a small set of cities. Leave it empty if yours is not there."
          state={state}
          autoFocus={first === 'placeId'}
        >
          <option value="">Not given</option>
          {[...placesByCountry].map(([code, places]) => (
            <optgroup key={code} label={countryName.get(code) ?? code}>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <TextField
          form={FORM}
          name="trainingStartYear"
          label="Year you started Wing Chun"
          optional
          autoComplete="off"
          inputMode="numeric"
          maxLength={4}
          hint={`A year between 1900 and ${options.latestStartYear}.`}
          state={state}
          autoFocus={first === 'trainingStartYear'}
        />
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 font-display text-2xl">Who can see it</legend>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Your profile starts private: only the people involved in your links and the reviewers see it. You can make it public now or
          later.
        </p>
        <CheckboxField form={FORM} name="showPublicly" label="Show my profile publicly" state={state} />
      </fieldset>

      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save my profile
        </SubmitButton>
      </div>
    </form>
  );
}
