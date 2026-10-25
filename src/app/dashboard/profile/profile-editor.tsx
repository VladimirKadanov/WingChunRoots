'use client';

// The profile editor (milestone M07, In scope 1; plan §5.3, §5.6): names in any script with one
// Latin-script display name, a short biography with its language, country, city, the year training
// started, and "Show my profile publicly" (never ticked in advance).
//
// TanStack Form holds the values (the rows of names can be added, removed and reordered by their
// display-name choice) and checks them with the Zod rules of src/lib/profile-form.ts before
// anything is sent; the Server Action saves through profile.update, which checks everything again.
// Every control keeps its `name`, so without JavaScript the same form posts as a plain form: the
// saved names are there with two spare rows for new ones, and the server answers with the same
// messages (src/server/forms/flash.ts).

import { useForm, useStore } from '@tanstack/react-form';
import { type ReactNode, startTransition, useActionState, useEffect, useRef, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, fieldClassName, useFocusOnError, useFormId, useHydrated } from '@/components/account/fields';
import { NameLine } from '@/components/account/person-names';
import { AlertIcon, CheckIcon, CloseIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { IDLE, fieldId, type FormState } from '@/lib/form-state';
import {
  canBePrimary,
  LATIN_WRITING,
  type NameRow,
  nameField,
  parseWriting,
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_MAX_NAMES,
  type ProfileFormValues,
  profileFormErrors,
  SPARE_ROWS,
  unflattenValues,
  writingValue,
} from '@/lib/profile-form';
import { saveProfileAction } from './actions';

const FORM_NAME = 'profile';

export interface ProfileEditorOptions {
  countries: readonly { code: string; name: string }[];
  places: readonly { id: string; name: string; countryCode: string }[];
  writings: readonly { id: string; label: string; script: string; lang: string; romanization: string | null }[];
  bioLanguages: readonly { lang: string; label: string }[];
  latestStartYear: number;
}

/** The labels of the fields in the error summary, in the order of the form. */
function summaryLabels(count: number): Record<string, string> {
  const labels: Record<string, string> = { names: 'Display name' };
  for (let i = 0; i < count; i++) {
    labels[nameField(i, 'value')] = `Name ${i + 1}`;
    labels[nameField(i, 'writing')] = `Name ${i + 1}, written in`;
    labels[nameField(i, 'isPrimary')] = `Name ${i + 1}`;
  }
  return { ...labels, bio: 'Biography', bioLang: 'Language of the biography', countryCode: 'Country', placeId: 'City', trainingStartYear: 'Year you started' };
}

function describedBy(...ids: (string | false | undefined | null)[]) {
  return ids.filter(Boolean).join(' ') || undefined;
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <AlertIcon size={16} className="mt-0.5" />
      <span>{error}</span>
    </p>
  );
}

function Label({ htmlFor, children, optional }: { htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-semibold">
      {children}
      {optional ? <span className="font-normal text-fg-muted"> (optional)</span> : null}
    </label>
  );
}

export function ProfileEditor({
  initialValues,
  options,
  publicSlug,
  initial,
}: {
  initialValues: ProfileFormValues;
  options: ProfileEditorOptions;
  /** The slug of the public profile, when it is public. */
  publicSlug: string | null;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(saveProfileAction, initial ?? IDLE);
  // The browser's own check before anything is sent (null once a submit passed it).
  const [checked, setChecked] = useState<FormState | null>(null);
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  const FORM = useFormId(FORM_NAME);

  const form = useForm({
    defaultValues: unflattenValues(initial?.values) ?? initialValues,
    validators: {
      onSubmit: ({ value }) => {
        const fields = profileFormErrors(value, options.latestStartYear);
        return Object.keys(fields).length > 0 ? fields : undefined;
      },
    },
    onSubmit: () => {
      setChecked(null);
      const data = new FormData(formRef.current!);
      startTransition(() => action(data));
    },
    onSubmitInvalid: ({ formApi }) => {
      const fields = (formApi.state.errorMap.onSubmit ?? {}) as Record<string, string>;
      setChecked({ status: 'error', message: fields.names ?? 'Check the highlighted fields.', fields });
    },
  });
  const values = useStore(form.store, (s) => s.values);

  // A save puts the saved profile back into the form (the server cleans and orders the names).
  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.status !== 'done') return;
    const saved = unflattenValues(state.values);
    if (saved) form.reset(saved);
  }, [state, form]);

  const shown = checked ?? state;
  useFocusOnError(FORM, shown);
  const errors = shown.status === 'error' ? (shown.fields ?? {}) : {};
  const error = (name: string) => errors[name];

  // Without JavaScript: the saved names and two spare rows; the server ignores spare rows left empty.
  const rows: (NameRow & { spare?: boolean })[] = hydrated
    ? values.names
    : [...values.names, ...Array.from({ length: Math.min(SPARE_ROWS, PROFILE_MAX_NAMES - values.names.length) }, () => ({ value: '', writing: LATIN_WRITING, kind: 'name' as const, spare: true }))];

  const writings = [...options.writings.map((w) => ({ value: writingValue(w), label: w.label }))];
  for (const row of values.names) {
    if (!writings.some((w) => w.value === row.writing)) {
      const w = parseWriting(row.writing);
      writings.push({ value: row.writing, label: w.script === 'Latn' ? `Latin letters (${w.lang})` : `${w.script} (${w.lang})` });
    }
  }

  const setName = (i: number, patch: Partial<NameRow>) => {
    form.setFieldValue('names', (list) => list.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    if (i === values.primary && !canBePrimary(patch.writing ?? values.names[i]!.writing, patch.kind ?? values.names[i]!.kind)) {
      form.setFieldValue('primary', -1);
    }
  };
  const addName = () => {
    form.setFieldValue('names', (list) => [...list, { value: '', writing: LATIN_WRITING, kind: 'name' }]);
    // The new row's name field takes the focus once it is rendered.
    requestAnimationFrame(() => document.getElementById(fieldId(FORM, nameField(values.names.length, 'value')))?.focus());
  };
  const removeName = (i: number) => {
    form.setFieldValue('names', (list) => list.filter((_, j) => j !== i));
    form.setFieldValue('primary', (p) => (p === i ? -1 : p > i ? p - 1 : p));
    // The focus goes to the row that took its place, or to "Add a name".
    requestAnimationFrame(() => {
      const next = document.getElementById(fieldId(FORM, nameField(Math.min(i, values.names.length - 2), 'value')));
      (next ?? document.getElementById(`${FORM}-add-name`))?.focus();
    });
  };

  const countryName = new Map(options.countries.map((c) => [c.code, c.name]));
  const pilotCountries = [...new Set(options.places.map((p) => p.countryCode))]
    .map((code) => ({ code, name: countryName.get(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const filtered = hydrated && values.countryCode !== '';
  const places = filtered ? options.places.filter((p) => p.countryCode === values.countryCode) : options.places;

  const primary = values.names[values.primary];
  const original = values.names.find((row, i) => i !== values.primary && parseWriting(row.writing).script !== 'Latn' && row.value.trim());
  const readings = values.names
    .filter((row) => ['jyutping', 'pinyin'].includes(parseWriting(row.writing).romanization ?? '') && row.value.trim())
    .map((row) => ({ value: row.value.trim(), lang: parseWriting(row.writing).lang }));

  const bioId = fieldId(FORM, 'bio');
  const yearId = fieldId(FORM, 'trainingStartYear');
  const publicId = fieldId(FORM, 'showPublicly');
  const selectState: FormState = shown;

  return (
    <form
      ref={formRef}
      id={FORM}
      action={action}
      noValidate
      aria-busy={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) void form.handleSubmit();
      }}
      className="grid gap-10"
    >
      <FormMessage form={FORM} state={shown} labels={summaryLabels(values.names.length)} />

      <fieldset className="grid gap-5" aria-describedby={describedBy(`${FORM}-names-hint`, error('names') && `${FORM}-names-error`)}>
        <legend className="mb-1 font-display text-2xl">Your names</legend>
        <p id={`${FORM}-names-hint`} className="max-w-[62ch] text-sm text-fg-muted">
          Add your name in every script people may search for. One name in Latin letters is your display name; the others, such as
          Chinese characters, Jyutping, pinyin or Cyrillic, are optional and help people find you.
        </p>
        <FieldError id={`${FORM}-names-error`} error={error('names')} />
        <ol className="grid gap-4">
          {rows.map((row, i) => {
            const writing = parseWriting(row.writing);
            const valueId = fieldId(FORM, nameField(i, 'value'));
            const kindId = fieldId(FORM, nameField(i, 'kind'));
            const primaryId = fieldId(FORM, nameField(i, 'isPrimary'));
            const valueError = error(nameField(i, 'value'));
            const writingError = error(nameField(i, 'writing'));
            const primaryError = error(nameField(i, 'isPrimary'));
            const isRomanization = writing.romanization === 'jyutping' || writing.romanization === 'pinyin';
            const eligible = canBePrimary(row.writing, row.kind);
            const isPrimary = values.primary === i;
            return (
              <li
                key={i}
                data-name-row=""
                className={cx(
                  'grid gap-4 rounded-sm border bg-surface-1 p-4 sm:p-5',
                  isPrimary ? 'border-fg' : 'border-border-subtle',
                  (valueError || writingError || primaryError) && 'border-l-4 border-l-danger',
                )}
              >
                <fieldset className="contents">
                  <legend className="sr-only">Name {i + 1}</legend>
                  {row.spare ? <input type="hidden" name={`names.${i}.spare`} value="1" /> : null}
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)]">
                    <div data-field="" className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5">
                      <Label htmlFor={valueId} optional={row.spare}>
                        {row.spare ? 'New name' : isPrimary ? 'Display name' : `Name ${i + 1}`}
                      </Label>
                      <input
                        id={valueId}
                        name={nameField(i, 'value')}
                        type="text"
                        value={row.value}
                        onChange={(e) => setName(i, { value: e.currentTarget.value })}
                        lang={writing.lang || undefined}
                        translate="no"
                        spellCheck={false}
                        autoComplete={isPrimary ? 'name' : 'off'}
                        autoCapitalize={writing.script === 'Latn' && !isRomanization ? 'words' : 'none'}
                        enterKeyHint="next"
                        maxLength={120}
                        readOnly={pending}
                        aria-invalid={valueError ? true : undefined}
                        aria-errormessage={valueError ? `${valueId}-error` : undefined}
                        aria-describedby={describedBy(valueError && `${valueId}-error`)}
                        className={cx(fieldClassName, writing.script !== 'Latn' && 'text-lg')}
                      />
                      <FieldError id={`${valueId}-error`} error={valueError} />
                    </div>
                    <SelectField
                      form={FORM}
                      name={nameField(i, 'writing')}
                      label="Written in"
                      autoComplete="off"
                      value={row.writing}
                      onValue={(v) => setName(i, { writing: v })}
                      state={selectState}
                    >
                      {writings.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                      <label htmlFor={primaryId} className={cx('flex min-h-11 items-center gap-3 text-ui', eligible || !hydrated ? 'cursor-pointer' : 'text-fg-subtle')}>
                        <input
                          id={primaryId}
                          type="radio"
                          name="primary"
                          value={i}
                          checked={isPrimary}
                          disabled={hydrated && !eligible}
                          onChange={() => form.setFieldValue('primary', i)}
                          aria-describedby={describedBy(primaryError && `${primaryId}-error`, hydrated && !eligible && `${primaryId}-why`)}
                          className="size-5 shrink-0 cursor-pointer accent-[var(--fg)] disabled:cursor-not-allowed"
                        />
                        Use as display name
                      </label>
                      {hydrated && !eligible ? (
                        <span id={`${primaryId}-why`} className="text-sm text-fg-subtle">
                          Only a name in Latin letters can be shown first.
                        </span>
                      ) : null}
                      {isRomanization ? (
                        <input type="hidden" name={nameField(i, 'kind')} value="name" />
                      ) : (
                        <span className="flex items-center gap-2">
                          <label htmlFor={kindId} className="text-sm text-fg-muted">
                            Kind
                          </label>
                          <select
                            id={kindId}
                            name={nameField(i, 'kind')}
                            value={row.kind}
                            onChange={(e) => setName(i, { kind: e.currentTarget.value === 'alias' ? 'alias' : 'name' })}
                            className="min-h-11 rounded-sm border border-border-strong bg-surface-1 px-2 text-sm text-fg hover:border-fg-muted"
                          >
                            <option value="name">Name</option>
                            <option value="alias">Also known as</option>
                          </select>
                        </span>
                      )}
                    </div>
                    {hydrated ? (
                      <button
                        type="button"
                        onClick={() => removeName(i)}
                        disabled={values.names.length <= 1}
                        className={cx(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-11 gap-1.5 disabled:opacity-50')}
                      >
                        <CloseIcon size={16} />
                        Remove<span className="sr-only"> name {i + 1}</span>
                      </button>
                    ) : null}
                  </div>
                  <FieldError id={`${primaryId}-error`} error={primaryError} />
                </fieldset>
              </li>
            );
          })}
        </ol>
        {hydrated ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              id={`${FORM}-add-name`}
              type="button"
              onClick={addName}
              disabled={values.names.length >= PROFILE_MAX_NAMES}
              className={cx(buttonVariants({ variant: 'secondary' }), 'disabled:opacity-50')}
            >
              Add a name
            </button>
            <span className="text-sm text-fg-muted">
              {values.names.length} of {PROFILE_MAX_NAMES} names
            </span>
          </div>
        ) : null}

        {hydrated ? (
          <figure className="grid gap-3 border-y border-border-subtle py-5">
            <figcaption className="eyebrow">How your name will appear</figcaption>
            {primary?.value.trim() && canBePrimary(primary.writing, primary.kind) ? (
              <NameLine
                primary={primary.value.trim().replace(/\s+/g, ' ')}
                original={original ? { value: original.value.trim(), lang: parseWriting(original.writing).lang } : null}
                readings={readings}
                className="text-feature"
              />
            ) : (
              <p className="text-sm text-fg-muted">Choose a name in Latin letters as your display name to see it here.</p>
            )}
          </figure>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-1 font-display text-2xl">About you</legend>
        <div data-field="" className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5">
          <Label htmlFor={bioId} optional>
            Short biography
          </Label>
          <textarea
            id={bioId}
            name="bio"
            value={values.bio}
            onChange={(e) => form.setFieldValue('bio', e.currentTarget.value)}
            rows={5}
            maxLength={PROFILE_BIO_MAX_LENGTH}
            readOnly={pending}
            lang={values.bioLang}
            aria-invalid={error('bio') ? true : undefined}
            aria-errormessage={error('bio') ? `${bioId}-error` : undefined}
            aria-describedby={describedBy(`${bioId}-hint`, error('bio') && `${bioId}-error`)}
            className={cx(fieldClassName, 'min-h-32 py-3 leading-relaxed')}
          />
          <p id={`${bioId}-hint`} className="flex flex-wrap justify-between gap-x-4 text-sm text-fg-muted">
            <span>A few sentences about your training, for your public profile. Write it in English for now.</span>
            <span className="tabular-nums">
              {values.bio.length} of {PROFILE_BIO_MAX_LENGTH}
            </span>
          </p>
          <FieldError id={`${bioId}-error`} error={error('bio')} />
        </div>
        <SelectField
          form={FORM}
          name="bioLang"
          label="Language of the biography"
          autoComplete="off"
          value={values.bioLang}
          onValue={(v) => form.setFieldValue('bioLang', v)}
          state={selectState}
          className="max-w-[22rem]"
        >
          {options.bioLanguages.map((l) => (
            <option key={l.lang} value={l.lang}>
              {l.label}
            </option>
          ))}
        </SelectField>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-1 font-display text-2xl">Where and since when</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <SelectField
            form={FORM}
            name="countryCode"
            label="Country"
            optional
            autoComplete="country"
            value={values.countryCode}
            onValue={(code) => {
              form.setFieldValue('countryCode', code);
              const place = options.places.find((p) => p.id === values.placeId);
              if (place && place.countryCode !== code) form.setFieldValue('placeId', '');
            }}
            state={selectState}
          >
            <option value="">Not given</option>
            {pilotCountries.length > 0 ? (
              <optgroup label="Pilot countries">
                {pilotCountries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="All countries">
              {options.countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </optgroup>
          </SelectField>
          <SelectField
            form={FORM}
            name="placeId"
            label="City"
            optional
            autoComplete="off"
            hint={filtered && places.length === 0 ? 'The pilot lists no cities in this country yet. Leave it empty.' : 'The pilot lists a small set of cities.'}
            value={values.placeId}
            onValue={(id) => {
              form.setFieldValue('placeId', id);
              const place = options.places.find((p) => p.id === id);
              if (place) form.setFieldValue('countryCode', place.countryCode);
            }}
            state={selectState}
          >
            <option value="">Not given</option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {filtered ? place.name : `${place.name}, ${countryName.get(place.countryCode) ?? place.countryCode}`}
              </option>
            ))}
          </SelectField>
        </div>
        <div data-field="" className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5">
          <Label htmlFor={yearId} optional>
            Year you started Wing Chun
          </Label>
          <input
            id={yearId}
            name="trainingStartYear"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={4}
            value={values.trainingStartYear}
            onChange={(e) => form.setFieldValue('trainingStartYear', e.currentTarget.value)}
            readOnly={pending}
            aria-invalid={error('trainingStartYear') ? true : undefined}
            aria-errormessage={error('trainingStartYear') ? `${yearId}-error` : undefined}
            aria-describedby={describedBy(`${yearId}-hint`, error('trainingStartYear') && `${yearId}-error`)}
            className={cx(fieldClassName, 'max-w-[10rem] tabular-nums')}
          />
          <p id={`${yearId}-hint`} className="text-sm text-fg-muted">
            Four digits, from 1900 to {options.latestStartYear}.
          </p>
          <FieldError id={`${yearId}-error`} error={error('trainingStartYear')} />
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 font-display text-2xl">Who can see it</legend>
        <p id={`${publicId}-hint`} className="max-w-[62ch] text-sm text-fg-muted">
          A private profile is seen only by the people involved in your links and by the reviewers. A public profile appears in search
          and on its own page. You can change this at any time; unticking it also withdraws your consent to publication.
        </p>
        <label htmlFor={publicId} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-ui">
          <span className="relative grid size-6 shrink-0 place-items-center">
            <input
              id={publicId}
              name="showPublicly"
              type="checkbox"
              value="on"
              checked={values.showPublicly}
              onChange={(e) => form.setFieldValue('showPublicly', e.currentTarget.checked)}
              aria-describedby={`${publicId}-hint`}
              className="peer size-6 cursor-pointer appearance-none rounded-[3px] border-2 border-border-strong bg-surface-1 transition-colors duration-(--duration-fast) checked:border-fg checked:bg-fg hover:border-fg-muted"
            />
            <CheckIcon size={18} className="pointer-events-none absolute hidden text-fg-inverse peer-checked:block" />
          </span>
          <span className="min-w-0 pt-px">Show my profile publicly</span>
        </label>
        {publicSlug ? (
          <p className="text-sm">
            <a href={`/people/${publicSlug}`} className="link inline-flex min-h-11 items-center">
              See your public profile
            </a>
          </p>
        ) : null}
      </fieldset>

      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save my profile
        </SubmitButton>
      </div>
    </form>
  );
}
