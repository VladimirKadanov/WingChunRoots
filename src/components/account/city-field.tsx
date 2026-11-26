'use client';

// A form's city field with the type-ahead (role replay 2026-11-25, P2-12): the label, the hint,
// the error and "My city is missing", around CityCombobox. The forms render it once hydrated and
// keep their select of the large cities before that (and without JavaScript).

import Link from 'next/link';
import type { ReactNode } from 'react';

import { fieldId, type FormState } from '@/lib/form-state';
import { type CityChoice, CityCombobox } from './city-combobox';
import { FieldError, FieldLabel, Hint, describedBy } from './fields';

/** "My city is missing": the page that tells the admins, back to this form afterwards. */
export function MissingCityLink({ next, countryCode }: { next: string; countryCode?: string | null }) {
  const search = new URLSearchParams({ next, ...(countryCode ? { country: countryCode } : {}) });
  return (
    <Link href={`/dashboard/places/missing?${search}`} className="link inline-flex min-h-11 items-center text-sm" data-testid="missing-city-link">
      My city is missing
    </Link>
  );
}

export function CityField({
  form,
  name,
  label,
  state,
  hint,
  optional,
  value,
  onValue,
  countryCode,
  next,
  disabled,
  autoFocus,
}: {
  form: string;
  name: string;
  label: ReactNode;
  state: FormState;
  hint?: ReactNode;
  optional?: boolean;
  value: CityChoice | null;
  onValue: (choice: CityChoice | null) => void;
  /** Only this country's places, when the form has chosen one. */
  countryCode?: string | null;
  /** This form's address, for "My city is missing" to come back to. */
  next: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  return (
    <div data-field="" data-city-field="" className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5">
      <FieldLabel id={id} label={label} optional={optional} />
      <CityCombobox
        id={id}
        name={name}
        value={value}
        onValue={onValue}
        countryCode={countryCode}
        describedBy={describedBy(hintId, error && errorId)}
        errorId={errorId}
        invalid={Boolean(error)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <Hint id={hintId} hint={hint} />
      <FieldError id={errorId} error={error} />
      <p>
        <MissingCityLink next={next} countryCode={countryCode} />
      </p>
    </div>
  );
}
