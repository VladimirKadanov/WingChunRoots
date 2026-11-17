'use client';

// The onboarding form (milestone M02, In scope 5): the account's own person. The selects are
// controlled, so a failed submit keeps what was chosen (finding H2), and the name inputs feed a
// preview of the name as the register will show it. With JavaScript, City lists the chosen
// country's cities and a city picked first sets its country, and the Chinese readings appear
// for a Chinese original; without it every field is there and the server checks the rest.
// `initial` is the outcome of a submit without JavaScript (src/server/forms/flash.ts).
// "How do you take part?" chooses the account type ("I train", the default, or "I teach"), saved
// through account.setType once the profile is saved; the radios are controlled too.

import { useActionState, useState } from 'react';

import { CONSENT_ORDER } from '@/components/account/consents';
import {
  CheckboxField,
  FormMessage,
  SelectField,
  SubmitButton,
  TextField,
  firstInvalid,
  useFocusOnError,
  useFormId,
  useHydrated,
} from '@/components/account/fields';
import { NameLine, NameText } from '@/components/account/person-names';
import { cx } from '@/lib/cx';
import { IDLE, fieldId, type FormState } from '@/lib/form-state';
import { onboardAction } from './actions';
import { type DocumentNote, MissingConsents } from './missing-consents';

const FORM_NAME = 'onboarding';

/** The names of the fields in the error summary, in the order of the form. */
const LABELS: Record<string, string> = {
  age_18_plus: 'Age',
  terms: 'Terms of use',
  authenticity_declaration: 'What you record',
  privacy_ack: 'Privacy notice',
  primaryName: 'Name in Latin letters',
  originalLang: 'Original script',
  originalName: 'Name in the original script',
  jyutping: 'Jyutping',
  pinyin: 'Pinyin',
  countryCode: 'Country',
  placeId: 'City',
  accountType: 'How you take part',
  trainingStartYear: 'Year you started',
};

const FIELD_ORDER = [...CONSENT_ORDER, ...Object.keys(LABELS).filter((name) => !(CONSENT_ORDER as readonly string[]).includes(name))];

/** The languages of the readings, as account.onboard stores them. */
const JYUTPING_LANG = 'yue-Latn';
const PINYIN_LANG = 'zh-Latn-pinyin';
const LATIN = 'und-Latn';

const isChineseScript = (lang: string) => lang === 'zh-Hant' || lang === 'zh-Hans';

export interface OnboardingFormOptions {
  countries: readonly { code: string; name: string }[];
  places: readonly { id: string; name: string; countryCode: string }[];
  scripts: readonly { lang: string; label: string }[];
  latestStartYear: number;
}

/** The two ways to take part: the account type account.setType sets (DEFAULT D04: verifies nothing). */
const ROLES = [
  { value: 'student', title: 'I train', hint: 'You train with one or more teachers. You can change this later in your settings.' },
  {
    value: 'sifu',
    title: 'I teach',
    hint: "Sifu can accept students, list schools and publish events. Choosing it doesn't verify you as an instructor; you can send evidence later.",
  },
] as const;

type Role = (typeof ROLES)[number]['value'];

/** An example name in a hint: in curly quotes, in its own language, never translated. */
function Example({ value, lang }: { value: string; lang: string }) {
  return (
    <>
      “<NameText name={{ value, lang }} />”
    </>
  );
}

export function OnboardingForm({
  options,
  accountType,
  missingConsents,
  documents,
  next,
  initial,
}: {
  options: OnboardingFormOptions;
  /** The account's type now: a Sifu account starts on "I teach". */
  accountType: Role;
  /** Required confirmations not given for the current documents. */
  missingConsents: readonly string[];
  documents: readonly DocumentNote[];
  next: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(onboardAction, initial ?? IDLE);
  const value = (name: string) => state.values?.[name] ?? '';
  const [originalLang, setOriginalLang] = useState(() => value('originalLang'));
  const [countryCode, setCountryCode] = useState(() => value('countryCode'));
  const [placeId, setPlaceId] = useState(() => value('placeId'));
  const [primaryName, setPrimaryName] = useState(() => value('primaryName'));
  const [originalName, setOriginalName] = useState(() => value('originalName'));
  const [jyutping, setJyutping] = useState(() => value('jyutping'));
  const [pinyin, setPinyin] = useState(() => value('pinyin'));
  const [role, setRole] = useState<string>(() => value('accountType') || accountType);
  const hydrated = useHydrated();
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, FIELD_ORDER);

  const countryName = new Map(options.countries.map((c) => [c.code, c.name]));
  const pilotCountries = [...new Set(options.places.map((p) => p.countryCode))]
    .map((code) => ({ code, name: countryName.get(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  // Without JavaScript City lists every pilot city, grouped by country (the server checks the pair).
  const filtered = hydrated && countryCode !== '';
  const places = filtered ? options.places.filter((p) => p.countryCode === countryCode) : options.places;
  const placesByCountry = new Map<string, OnboardingFormOptions['places'][number][]>();
  for (const place of places) placesByCountry.set(place.countryCode, [...(placesByCountry.get(place.countryCode) ?? []), place]);

  const errors = state.status === 'error' ? (state.fields ?? {}) : {};
  const showReadings = !hydrated || isChineseScript(originalLang) || jyutping !== '' || pinyin !== '' || Boolean(errors.jyutping || errors.pinyin);

  const chooseCountry = (code: string) => {
    setCountryCode(code);
    const place = options.places.find((p) => p.id === placeId);
    if (place && place.countryCode !== code) setPlaceId('');
  };
  const choosePlace = (id: string) => {
    setPlaceId(id);
    const place = options.places.find((p) => p.id === id);
    if (place) setCountryCode(place.countryCode);
  };

  const readings = [
    ...(showReadings && jyutping.trim() ? [{ value: jyutping.trim().toLowerCase(), lang: JYUTPING_LANG }] : []),
    ...(showReadings && pinyin.trim() ? [{ value: pinyin.trim(), lang: PINYIN_LANG }] : []),
  ];

  return (
    <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-10">
      <input type="hidden" name="next" value={next} />
      <FormMessage form={FORM} state={state} labels={LABELS} />

      <MissingConsents
        form={FORM}
        state={state}
        missingConsents={missingConsents}
        documents={documents}
        first={first}
        legend="First, confirm"
      />

      <fieldset className="grid gap-6">
        <legend className="mb-4 font-display text-2xl">Your name</legend>
        <TextField
          form={FORM}
          name="primaryName"
          label="Name in Latin letters"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          spellCheck={false}
          translate="no"
          maxLength={120}
          hint={
            <>
              The name people know you by, in Latin letters, for example <Example value="So Chuk-ching" lang={LATIN} /> or{' '}
              <Example value="Mira Probnova" lang={LATIN} />. It is shown first.
            </>
          }
          onValue={setPrimaryName}
          state={state}
          autoFocus={first === 'primaryName'}
        />
        <SelectField
          form={FORM}
          name="originalLang"
          label="Original script"
          optional
          autoComplete="off"
          hint="If your name is also written in another script, choose it and type the name below. A Chinese name can add its Jyutping and pinyin."
          value={originalLang}
          onValue={setOriginalLang}
          state={state}
          autoFocus={first === 'originalLang'}
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
          enterKeyHint="next"
          spellCheck={false}
          translate="no"
          maxLength={120}
          lang={originalLang || undefined}
          hint={
            <>
              For example <Example value="蘇竹晴" lang="zh-Hant" /> in Traditional Chinese characters or{' '}
              <Example value="Мира Пробнова" lang="bg-Cyrl" /> in Cyrillic.
            </>
          }
          onValue={setOriginalName}
          state={state}
          autoFocus={first === 'originalName'}
        />
        {showReadings ? (
          <fieldset className="grid gap-4">
            <legend className="mb-3 text-sm font-semibold">Chinese readings</legend>
            <div className="grid gap-6 sm:grid-cols-2">
              <TextField
                form={FORM}
                name="jyutping"
                label="Jyutping"
                optional
                autoComplete="off"
                autoCapitalize="none"
                enterKeyHint="next"
                spellCheck={false}
                translate="no"
                lang={JYUTPING_LANG}
                maxLength={120}
                hint={
                  <>
                    Cantonese, with tone numbers: <Example value="sou1 zuk1 cing4" lang={JYUTPING_LANG} />.
                  </>
                }
                onValue={setJyutping}
                state={state}
                autoFocus={first === 'jyutping'}
              />
              <TextField
                form={FORM}
                name="pinyin"
                label="Pinyin"
                optional
                autoComplete="off"
                enterKeyHint="next"
                spellCheck={false}
                translate="no"
                lang={PINYIN_LANG}
                maxLength={120}
                hint={
                  <>
                    Mandarin, with tone marks: <Example value="Sū Zhúqíng" lang={PINYIN_LANG} />.
                  </>
                }
                onValue={setPinyin}
                state={state}
                autoFocus={first === 'pinyin'}
              />
            </div>
          </fieldset>
        ) : null}
      </fieldset>

      {/* Needs JavaScript to follow the typing; without it the form alone is shown. */}
      {hydrated ? (
        <figure className="grid gap-3 border-y border-border-subtle py-5">
          <figcaption className="eyebrow">How your name will appear</figcaption>
          {primaryName.trim() ? (
            <NameLine
              primary={primaryName.trim().replace(/\s+/g, ' ')}
              original={originalLang && originalName.trim() ? { value: originalName.trim(), lang: originalLang } : null}
              readings={readings}
              className="text-feature"
            />
          ) : (
            <p className="text-sm text-fg-muted">Your name appears here as you type it.</p>
          )}
        </figure>
      ) : null}

      <fieldset aria-describedby={errors.accountType ? `${fieldId(FORM, 'accountType')}-error` : undefined} className="grid gap-3">
        <legend className="mb-4 font-display text-2xl">How do you take part?</legend>
        {errors.accountType ? (
          <p id={`${fieldId(FORM, 'accountType')}-error`} className="text-sm text-danger">
            {errors.accountType}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((option, index) => (
            <label
              key={option.value}
              className={cx(
                'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-sm border border-border-strong bg-surface-1 p-4',
                'transition-colors duration-(--duration-fast) hover:border-fg-muted has-[:checked]:border-fg has-[:checked]:bg-surface-2',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                'forced-colors:has-[:checked]:border-2 forced-colors:has-[:checked]:p-[15px]',
              )}
            >
              <input
                type="radio"
                name="accountType"
                value={option.value}
                id={index === 0 ? fieldId(FORM, 'accountType') : undefined}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
                aria-describedby={`${fieldId(FORM, 'accountType')}-${option.value}-hint`}
                autoFocus={first === 'accountType' && index === 0}
                // Drawn as on /dashboard/settings: a ring in ink and a dot when chosen; the system
                // draws its own radio in forced colours.
                className={cx(
                  'mt-1 grid size-5 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border-[1.5px] border-fg bg-surface-1 focus-visible:outline-none',
                  'before:size-2.5 before:scale-0 before:rounded-full before:bg-fg before:transition-transform before:duration-(--duration-fast) checked:before:scale-100',
                  'forced-colors:appearance-auto forced-colors:before:hidden',
                )}
              />
              <span className="grid gap-1">
                <span className="font-display text-xl">{option.title}</span>
                <span id={`${fieldId(FORM, 'accountType')}-${option.value}-hint`} className="text-sm text-fg-muted">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-4 font-display text-2xl">Where and since when</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <SelectField
            form={FORM}
            name="countryCode"
            label="Country"
            optional
            autoComplete="country"
            value={countryCode}
            onValue={chooseCountry}
            state={state}
            autoFocus={first === 'countryCode'}
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
            hint={
              filtered && places.length === 0
                ? 'The pilot lists no cities in this country yet. Leave it empty.'
                : 'The pilot lists a small set of cities. Leave it empty if yours is not there.'
            }
            value={placeId}
            onValue={choosePlace}
            state={state}
            autoFocus={first === 'placeId'}
          >
            <option value="">Not given</option>
            {filtered
              ? places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))
              : [...placesByCountry].map(([code, list]) => (
                  <optgroup key={code} label={countryName.get(code) ?? code}>
                    {list.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </SelectField>
        </div>
        <TextField
          form={FORM}
          name="trainingStartYear"
          label="Year you started Wing Chun"
          optional
          autoComplete="off"
          inputMode="numeric"
          enterKeyHint="done"
          maxLength={4}
          inputClassName="max-w-[10rem] tabular-nums"
          hint={`Four digits, from 1900 to ${options.latestStartYear}.`}
          state={state}
          autoFocus={first === 'trainingStartYear'}
        />
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 font-display text-2xl">Who can see it</legend>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Your profile starts private: only the people involved in your links and the reviewers see it. You can make it public now or
          later. If you leave this unticked, your profile stays private, and so do your confirmed links: a link is shown publicly only when both
          people in it have chosen “Show my profile publicly”. You always see your links on your dashboard.
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
