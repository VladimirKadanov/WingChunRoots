'use client';

// The profile editor (milestone M07, In scope 1; plan §5.3, §5.6): names in any script with one
// Latin-script display name, a short biography with its language, country, city, the year training
// started, and "Show my profile publicly" (never ticked in advance).
//
// The fields hold what the person typed or chose: the names, "Written in", Kind, the display-name
// radios, the biography, the year and "Show my profile publicly" are uncontrolled, so React never
// writes their value after it created them, whatever the moment of an edit (before the page's
// JavaScript ran, while it hydrates, or between a commit and its effects: the iPhone runs of
// PR #13 saved the old display name). TanStack Form follows the fields (syncFromDom: on hydration,
// on every input and change event of the form, before Add, Remove and a save) for what the page
// draws from them (the preview, "N of 10", labels), and checks them with the Zod rules of
// src/lib/profile-form-rules.ts before anything is sent; the Server Action saves through
// profile.update, which checks everything again. The language of the biography, the country and
// the city stay controlled selects (SelectField takes over a choice made before hydration itself).
// The rules are fetched when the person first focuses the form or saves it, not with the page
// (Zod is about 40 kB of gzip JavaScript; plan §5.8 (c)); if they cannot be fetched, the form is
// sent unchecked and the server's answer shows the same messages.
// Every control keeps its `name`, so without JavaScript the same form posts as a plain form: the
// saved names are there with two spare rows for new ones, and the server answers with the same
// messages (src/server/forms/flash.ts).

import { useForm, useStore } from '@tanstack/react-form';
import { type ReactNode, startTransition, useActionState, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, fieldClassName, useFocusOnError, useFormId, useHydrated } from '@/components/account/fields';
import { NameLine } from '@/components/account/person-names';
import { AlertIcon, CheckIcon, ChevronDownIcon, CloseIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { IDLE, fieldId, type FormState } from '@/lib/form-state';
import {
  canBePrimary,
  keysOfSlots,
  LATIN_WRITING,
  type NameRow,
  nameField,
  parseWriting,
  primaryRefusal,
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_MAX_NAMES,
  type ProfileFormValues,
  sameNames,
  shownFormValues,
  shownSlots,
  spareRowCount,
  unflattenValues,
  writingValue,
} from '@/lib/profile-form';
import { saveProfileAction } from './actions';

const FORM_NAME = 'profile';

type Rules = typeof import('@/lib/profile-form-rules');
let rulesModule: Promise<Rules> | null = null;
/** The editor's Zod rules, fetched once on first use; a failed fetch is tried again next time. */
function loadRules(): Promise<Rules> {
  rulesModule ??= import('@/lib/profile-form-rules').catch((error: unknown) => {
    rulesModule = null;
    throw error;
  });
  return rulesModule;
}
/** Scripts whose names the name field draws a step larger (text-lg): Han, Japanese and Korean. */
const LARGER_SCRIPTS = new Set(['Hant', 'Hans', 'Hani', 'Jpan', 'Kore']);

// A biography typed before the editor hydrated. Unlike an input's, a textarea's typed text does not
// survive hydration: React puts the server's text back into it when that text is not empty
// (initTextarea in react-dom), so an edit of a saved biography made while the page's JavaScript
// was on the way would be lost. This module always runs before React draws the editor, so it reads
// what the field holds then, and a capture listener on window (which runs before React's own
// listener on the document, which may hydrate the field in the same event) follows every later
// edit, until the editor's first layout effect puts the text back and removes the listener.
let typedBio: string | null = null;
const isBioField = (target: unknown): target is HTMLTextAreaElement =>
  target instanceof HTMLTextAreaElement && target.name === 'bio' && !!target.form?.id.startsWith(FORM_NAME);
function noteTypedBio(event: Event) {
  if (isBioField(event.target)) typedBio = event.target.value;
}
if (typeof window !== 'undefined') {
  const field = document.querySelector('textarea[name="bio"]');
  if (isBioField(field) && field.value !== field.defaultValue) typedBio = field.value;
  window.addEventListener('input', noteTypedBio, true);
}
/** Puts a biography typed before hydration back into its field (see typedBio); once. */
function restoreTypedBio(form: HTMLFormElement) {
  window.removeEventListener('input', noteTypedBio, true);
  const field = form.elements.namedItem('bio');
  if (typedBio !== null && isBioField(field) && field.value !== typedBio) field.value = typedBio;
  typedBio = null;
}

/**
 * Writes saved values into the editor's uncontrolled fields, by the index of each row (the server
 * keeps the order of the rows it saves). The controlled selects follow the form state.
 */
function showValues(form: HTMLFormElement, values: ProfileFormValues) {
  const write = (name: string, value: string) => {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    // A romanization's Kind is a hidden input that React draws with its value.
    if (field.type !== 'hidden' && field.value !== value) field.value = value;
  };
  values.names.forEach((row, i) => {
    write(nameField(i, 'value'), row.value);
    write(nameField(i, 'writing'), row.writing);
    write(nameField(i, 'kind'), row.kind);
  });
  write('bio', values.bio);
  write('trainingStartYear', values.trainingStartYear);
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[type="radio"][name="primary"]')) radio.checked = radio.value === String(values.primary);
  const showPublicly = form.elements.namedItem('showPublicly');
  if (showPublicly instanceof HTMLInputElement) showPublicly.checked = values.showPublicly;
}

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
  const rules = useRef<Rules | null>(null);
  const prepareRules = () =>
    loadRules().then(
      (loaded) => {
        rules.current = loaded;
      },
      () => undefined,
    );

  // The values the fields were drawn with, kept: the fields hold the values from then on, so a new
  // render of the page (a refresh after a save elsewhere on it) must not move the state away from
  // them (TanStack Form takes new default values while nothing is touched).
  const [drawn] = useState(() => unflattenValues(initial?.values) ?? initialValues);
  const form = useForm({
    defaultValues: drawn,
    validators: {
      onSubmit: ({ value }) => {
        const fields = rules.current?.profileFormErrors(value, options.latestStartYear) ?? {};
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
  // The React key of each row of names, by index: a row keeps its fields' nodes (their text and
  // focus) when a row above it is removed, and when it is taken over at hydration (keysOfSlots).
  // Before hydration the rows are the saved names and the spare rows.
  const [rowKeys, setRowKeys] = useState(() => Array.from({ length: drawn.names.length + spareRowCount(drawn.names.length) }, (_, i) => `row-${i}`));
  const addedRows = useRef(0);

  // The form state takes over what the fields hold; React never writes it back (see the top).
  const syncFromDom = () => {
    const el = formRef.current;
    // While a save is on its way every control is read-only or disabled, and a disabled control is
    // not in the form's data: there is nothing to take over.
    if (!el || pending) return;
    const data = new FormData(el);
    const shown = shownFormValues(data);
    // A ticked display name that can no longer be one (its "Written in" or Kind was just changed):
    // its radio is unticked before it is drawn disabled.
    if (shown.primary === -1 && data.has('primary')) {
      for (const radio of el.querySelectorAll<HTMLInputElement>('input[type="radio"][name="primary"]')) radio.checked = false;
    }
    const keys = keysOfSlots(rowKeys, shownSlots(data));
    if (keys) setRowKeys(keys);
    const current = form.state.values;
    if (!sameNames(shown.names, current.names)) form.setFieldValue('names', shown.names);
    for (const key of ['primary', 'bio', 'trainingStartYear', 'showPublicly'] as const) {
      if (shown[key] !== current[key]) form.setFieldValue(key, shown[key]);
    }
  };
  // On hydration, before anything is painted and before any later event: what was typed or chosen
  // before (a slow phone connection, a webview), or in the edit whose own event made React hydrate
  // the field (it then skips that field's change event; the form's input event still comes).
  const takeOverFields = useEffectEvent(() => {
    restoreTypedBio(formRef.current!);
    syncFromDom();
  });
  useLayoutEffect(() => takeOverFields(), []);

  // A save shows the saved profile (the server cleans and orders the names, trims the biography):
  // the fields are written, then the state takes the same values. While the save is on its way the
  // text fields are read-only and every other control is disabled (the form's data was read when it
  // was sent), so no choice is made then that this would undo.
  const seen = useRef(state);
  useLayoutEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.status !== 'done') return;
    const saved = unflattenValues(state.values);
    if (!saved) return;
    showValues(formRef.current!, saved);
    form.reset(saved, { keepDefaultValues: true });
  }, [state, form]);

  const shown = checked ?? state;
  useFocusOnError(FORM, shown);
  const errors = shown.status === 'error' ? (shown.fields ?? {}) : {};
  const error = (name: string) => errors[name];

  // Without JavaScript: the saved names and two spare rows; the server ignores spare rows left empty.
  const rows: (NameRow & { spare?: boolean })[] = hydrated
    ? values.names
    : [...values.names, ...Array.from({ length: spareRowCount(values.names.length) }, () => ({ value: '', writing: LATIN_WRITING, kind: 'name' as const, spare: true }))];

  const writings = [...options.writings.map((w) => ({ value: writingValue(w), label: w.label }))];
  for (const row of values.names) {
    if (!writings.some((w) => w.value === row.writing)) {
      const w = parseWriting(row.writing);
      writings.push({ value: row.writing, label: w.script === 'Latn' ? `Latin letters (${w.lang})` : `${w.script} (${w.lang})` });
    }
  }

  const addName = () => {
    syncFromDom();
    const at = form.state.values.names.length;
    const key = `added-${addedRows.current++}`;
    form.setFieldValue('names', (list) => [...list, { value: '', writing: LATIN_WRITING, kind: 'name' }]);
    setRowKeys((keys) => [...keys.slice(0, at), key]);
    // The new row's name field takes the focus once it is rendered.
    requestAnimationFrame(() => document.getElementById(fieldId(FORM, nameField(at, 'value')))?.focus());
  };
  const removeName = (i: number) => {
    syncFromDom();
    const count = form.state.values.names.length;
    // The rows below keep their nodes, with their text and a ticked radio; the radio of a removed
    // display name goes with its row.
    form.setFieldValue('names', (list) => list.filter((_, j) => j !== i));
    form.setFieldValue('primary', (p) => (p === i ? -1 : p > i ? p - 1 : p));
    setRowKeys((keys) => keys.filter((_, j) => j !== i));
    // The focus goes to the row that took its place, or to "Add a name".
    requestAnimationFrame(() => {
      const next = document.getElementById(fieldId(FORM, nameField(Math.min(i, count - 2), 'value')));
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
      onFocus={() => void prepareRules()}
      onInput={syncFromDom}
      onChange={syncFromDom}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        // The rules check what is about to be sent.
        void prepareRules().then(() => {
          syncFromDom();
          return form.handleSubmit();
        });
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
            const refusal = primaryRefusal(row.writing, row.kind);
            const eligible = refusal === null;
            const isPrimary = values.primary === i;
            return (
              <li
                key={rowKeys[i] ?? `slot-${i}`}
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
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)]">
                    <div data-field="" className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5">
                      <Label htmlFor={valueId} optional={row.spare}>
                        {row.spare ? 'New name' : isPrimary ? 'Display name' : `Name ${i + 1}`}
                      </Label>
                      <input
                        id={valueId}
                        name={nameField(i, 'value')}
                        type="text"
                        defaultValue={row.value}
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
                        // Dense Han, kana and Hangul read better a step larger; Cyrillic, Greek and the rest keep the field size.
                        className={cx(fieldClassName, LARGER_SCRIPTS.has(writing.script) && 'text-lg')}
                      />
                      <FieldError id={`${valueId}-error`} error={valueError} />
                    </div>
                    <SelectField
                      form={FORM}
                      name={nameField(i, 'writing')}
                      label="Written in"
                      autoComplete="off"
                      defaultValue={row.writing}
                      disabled={pending}
                      state={selectState}
                    >
                      {writings.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  {/* items-start: when Kind wraps under the radio on a phone, Remove stays on the radio's line. */}
                  <div className="flex items-start justify-between gap-x-5 gap-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
                      <label htmlFor={primaryId} className={cx('flex min-h-11 items-center gap-3 text-ui', eligible || !hydrated ? 'cursor-pointer' : 'text-fg-subtle')}>
                        <input
                          id={primaryId}
                          type="radio"
                          name="primary"
                          value={i}
                          defaultChecked={isPrimary}
                          disabled={pending || (hydrated && !eligible)}
                          aria-describedby={describedBy(primaryError && `${primaryId}-error`, hydrated && !eligible && `${primaryId}-why`)}
                          className="size-5 shrink-0 cursor-pointer accent-[var(--fg)] disabled:cursor-not-allowed"
                        />
                        Use as display name
                      </label>
                      {isRomanization ? (
                        <input type="hidden" name={nameField(i, 'kind')} value="name" />
                      ) : (
                        <span className="flex min-w-0 items-center gap-2">
                          <label htmlFor={kindId} className="text-sm text-fg-muted">
                            Kind
                          </label>
                          {/* The fields' own select: 16 px (no zoom on iOS) and the thin chevron. No fixed width:
                              as wide as "Also known as" when there is room, narrower on a 320 px phone, so the
                              row never makes the page wider than the screen. */}
                          <span className="relative min-w-0 flex-1">
                            <select
                              id={kindId}
                              name={nameField(i, 'kind')}
                              defaultValue={row.kind}
                              disabled={pending}
                              className={cx(fieldClassName, 'appearance-none pr-11')}
                            >
                              <option value="name">Name</option>
                              <option value="alias">Also known as</option>
                            </select>
                            <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
                          </span>
                        </span>
                      )}
                    </div>
                    {hydrated ? (
                      <button
                        type="button"
                        onClick={() => removeName(i)}
                        disabled={pending || values.names.length <= 1}
                        className={cx(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-11 shrink-0 gap-1.5 disabled:opacity-50')}
                      >
                        <CloseIcon size={16} />
                        Remove<span className="sr-only"> name {i + 1}</span>
                      </button>
                    ) : null}
                  </div>
                  {/* On a line of its own, so Remove stays at the end of the row on every card. */}
                  {/* Why this name cannot be the display name, and what to change (the save's error says the same). */}
                  {hydrated && refusal ? (
                    <p id={`${primaryId}-why`} className="-mt-2 text-sm text-fg-subtle">
                      {refusal}
                    </p>
                  ) : null}
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
              disabled={pending || values.names.length >= PROFILE_MAX_NAMES}
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
            defaultValue={values.bio}
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
          disabled={pending}
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
            disabled={pending}
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
            disabled={pending}
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
            defaultValue={values.trainingStartYear}
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
              defaultChecked={values.showPublicly}
              disabled={pending}
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
