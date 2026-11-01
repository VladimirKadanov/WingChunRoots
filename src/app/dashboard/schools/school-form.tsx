'use client';

// The school form (milestone M11, In scope 2): name, city, how the location is shown, the pin,
// contacts, the forms taught and the instructors. Saved through schools.create or schools.update
// (thin Server Actions, plan §6.8). It works without JavaScript; with it, "Drop the pin on a map"
// loads a small map (src/components/map/pin-picker.tsx) that fills in the latitude and longitude.
//
// Location (plan §6.4): "Exact pin" makes the point public; "City only" keeps any point private
// (school_private_location) and the map shows the school at its city's centre.

import { lazy, Suspense, useActionState, useState } from 'react';

import { FieldError, FormMessage, SelectField, SubmitButton, TextField, describedBy, fieldClassName, useFocusOnError, useHydrated } from '@/components/account/fields';
import { CheckIcon, PinIcon } from '@/components/icons';
import { CityRingMark, ExactPinMark } from '@/components/schools/marks';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import type { GeoPointDto } from '@/server/dto/schools';
import { createSchoolAction, updateSchoolAction } from './actions';
import { SCHOOL_FORM } from './form-ids';

// React.lazy rather than next/dynamic: the picker renders only after a click (never on the server),
// and the page's first JavaScript stays without next/dynamic's loader (the route budget, ADR 0013).
const PinPicker = lazy(() => import('@/components/map/pin-picker'));
const pickerLoading = <div className="h-72 animate-pulse rounded-sm bg-surface-1 motion-reduce:animate-none md:h-96" />;

export interface SchoolFormPlace {
  id: string;
  name: string;
  countryCode: string;
  point: GeoPointDto;
  found: boolean;
}

export interface SchoolFormProps {
  /** The school being edited, or null for a new one. */
  school: {
    id: string;
    name: string;
    placeId: string;
    locationPrivacy: 'exact' | 'city_only';
    point: GeoPointDto | null;
    websiteUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    description: string | null;
    formsTaught: string[];
    instructorIds: string[];
  } | null;
  places: SchoolFormPlace[];
  /** The city search the page answered ("Find a city or town"), to name its matches. */
  cityQuery: string | null;
  forms: { key: string; label: string }[];
  instructorOptions: { id: string; label: string; self: boolean }[];
  styles: { light: string; dark: string };
  /** A new school's request key (one per form: a resent form saves once). */
  idempotencyKey: string | null;
  /** The outcome of a post without JavaScript. */
  initial: FormState | null;
}

const LABELS: Record<string, string> = {
  name: 'Name of the school',
  placeId: 'City or town',
  locationPrivacy: 'Location',
  lat: 'Pin',
  websiteUrl: 'Website',
  contactEmail: 'E-mail',
  contactPhone: 'Phone',
  description: 'About the school',
  formsTaught: 'Forms taught',
  instructorIds: 'Instructors',
};

const radioClass = cx(
  'peer size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-surface-1',
  'checked:border-[7px] checked:border-fg hover:border-fg-muted',
);
const boxClass = cx(
  'peer size-6 cursor-pointer appearance-none rounded-[3px] border-2 border-border-strong bg-surface-1',
  'transition-colors duration-(--duration-fast) checked:border-fg checked:bg-fg hover:border-fg-muted',
);

function Check({ name, value, label, defaultChecked, describedById }: { name: string; value: string; label: string; defaultChecked: boolean; describedById?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-ui">
      <span className="relative grid size-6 shrink-0 place-items-center">
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} aria-describedby={describedById} className={boxClass} />
        <CheckIcon size={18} className="pointer-events-none absolute hidden text-fg-inverse peer-checked:block" />
      </span>
      <span className="min-w-0 pt-px">{label}</span>
    </label>
  );
}

export function SchoolForm({ school, places, cityQuery, forms, instructorOptions, styles, idempotencyKey, initial }: SchoolFormProps) {
  const [state, action, pending] = useActionState(school ? updateSchoolAction : createSchoolAction, initial ?? IDLE);
  const form = SCHOOL_FORM;
  useFocusOnError(form, state);
  const hydrated = useHydrated();
  const values = state.values;
  const error = (name: string) => (state.status === 'error' ? state.fields?.[name] : undefined);

  // The city: the first match of a search, else the school's own, else none chosen yet.
  const firstFound = places.find((p) => p.found)?.id;
  const [placeId, setPlaceId] = useState(values?.placeId ?? firstFound ?? school?.placeId ?? '');
  // Nothing is chosen in advance for a new school: the Sifu decides whether the address is public
  // (privacy by default, as the M08 rule for choices); a saved school shows its own choice.
  const [privacy, setPrivacy] = useState<'exact' | 'city_only' | null>((values?.locationPrivacy as 'exact' | 'city_only' | undefined) ?? school?.locationPrivacy ?? null);
  const [lat, setLat] = useState(values?.lat ?? (school?.point ? String(school.point.lat) : ''));
  const [lng, setLng] = useState(values?.lng ?? (school?.point ? String(school.point.lng) : ''));
  const [picking, setPicking] = useState(false);
  const city = places.find((p) => p.id === placeId) ?? null;
  const typedPoint = /^-?\d{1,3}(\.\d+)?$/.test(lat) && /^-?\d{1,3}(\.\d+)?$/.test(lng) ? { lat: Number(lat), lng: Number(lng) } : null;

  const saved = (prefix: string, key: string, kept: string[] | undefined) => (values ? values[`${prefix}.${key}`] === 'on' : (kept ?? []).includes(key));
  const found = places.filter((p) => p.found);
  const byCountry = new Map<string, SchoolFormPlace[]>();
  for (const p of places.filter((place) => !place.found)) byCountry.set(p.countryCode, [...(byCountry.get(p.countryCode) ?? []), p]);
  const others = instructorOptions.filter((o) => !o.self);
  const latId = fieldId(form, 'lat');
  const pointHintId = `${latId}-hint`;
  const pointErrorId = `${latId}-error`;

  return (
    <form id={form} action={action} noValidate className="grid gap-6" data-testid="school-form">
      <FormMessage form={form} state={state} labels={LABELS} />
      {school ? <input type="hidden" name="id" value={school.id} /> : null}
      {idempotencyKey ? <input type="hidden" name="idempotencyKey" value={values?.idempotencyKey ?? idempotencyKey} /> : null}

      <TextField form={form} name="name" label={LABELS.name} state={state} autoComplete="organization" maxLength={120} defaultValue={school?.name ?? ''} />

      <SelectField
        form={form}
        name="placeId"
        label={LABELS.placeId}
        state={state}
        autoComplete="off"
        value={placeId}
        onValue={setPlaceId}
        hint={cityQuery ? `Matches for “${cityQuery}” come first. Not there? Search again above.` : 'Large cities are listed; find a smaller town with the search above.'}
      >
        <option value="" disabled>
          Choose the city or town
        </option>
        {found.length > 0 ? (
          <optgroup label={`Matches for “${cityQuery ?? ''}”`}>
            {found.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.countryCode}
              </option>
            ))}
          </optgroup>
        ) : null}
        {[...byCountry].map(([country, list]) => (
          <optgroup key={country} label={country}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.countryCode}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>

      <fieldset className="grid gap-2" data-field="">
        <legend className="mb-1 text-sm font-semibold">{LABELS.locationPrivacy}</legend>
        <FieldError id={`${fieldId(form, 'locationPrivacy')}-error`} error={error('locationPrivacy')} />
        {(
          [
            ['exact', 'Exact pin', 'The pin and the address are public. The school shows as a solid pin.'],
            ['city_only', 'City only: private club, by invitation', 'The address stays private. The map shows a hollow ring at the centre of the city.'],
          ] as const
        ).map(([value, label, hint], i) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border-subtle px-3 py-3 has-checked:border-fg">
            <input
              id={i === 0 ? fieldId(form, 'locationPrivacy') : undefined}
              type="radio"
              name="locationPrivacy"
              value={value}
              defaultChecked={privacy === value}
              onChange={() => setPrivacy(value)}
              className={radioClass}
            />
            <span className="grid gap-0.5">
              <span className="flex items-center gap-2 text-ui font-semibold">
                {value === 'exact' ? <ExactPinMark size={18} /> : <CityRingMark size={18} />}
                {label}
              </span>
              <span className="text-sm text-fg-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-3" data-field="">
        <legend className="mb-1 text-sm font-semibold">
          {LABELS.lat}
          {privacy === 'city_only' ? <span className="font-normal text-fg-muted"> (optional, kept private)</span> : null}
        </legend>
        <p id={pointHintId} className="text-sm text-fg-muted">
          {privacy === 'city_only'
            ? 'A city-only school can keep its exact point for itself: nobody else sees it.'
            : 'Where the school is, within 50 km of the city. Type the latitude and longitude, or drop the pin on a map.'}
        </p>
        <FieldError id={pointErrorId} error={error('lat')} />
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <label htmlFor={latId} className="text-sm">
              Latitude
            </label>
            <input
              id={latId}
              name="lat"
              inputMode="decimal"
              autoComplete="off"
              value={lat}
              onChange={(event) => setLat(event.currentTarget.value)}
              placeholder="42.6977"
              aria-invalid={error('lat') ? true : undefined}
              aria-describedby={describedBy(pointHintId, error('lat') && pointErrorId)}
              className={fieldClassName}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={fieldId(form, 'lng')} className="text-sm">
              Longitude
            </label>
            <input
              id={fieldId(form, 'lng')}
              name="lng"
              inputMode="decimal"
              autoComplete="off"
              value={lng}
              onChange={(event) => setLng(event.currentTarget.value)}
              placeholder="23.3219"
              aria-describedby={pointHintId}
              className={fieldClassName}
            />
          </div>
        </div>
        {hydrated ? (
          picking && (city || typedPoint) ? (
            <Suspense fallback={pickerLoading}>
              <PinPicker
                center={typedPoint ?? city!.point}
                point={typedPoint}
                styles={styles}
                onPick={(p) => {
                  setLat(String(p.lat));
                  setLng(String(p.lng));
                }}
              />
            </Suspense>
          ) : (
            <p>
              <button
                type="button"
                className={buttonVariants({ variant: 'secondary' })}
                onClick={() => setPicking(true)}
                aria-disabled={!city && !typedPoint ? true : undefined}
                disabled={!city && !typedPoint}
                data-testid="drop-pin"
              >
                <PinIcon />
                Drop the pin on a map
              </button>
              {!city && !typedPoint ? <span className="ml-3 text-sm text-fg-muted">Choose the city first.</span> : null}
            </p>
          )
        ) : null}
      </fieldset>

      <TextField form={form} name="websiteUrl" label={LABELS.websiteUrl} state={state} optional autoComplete="url" maxLength={300} placeholder="https://" defaultValue={school?.websiteUrl ?? ''} />
      <TextField form={form} name="contactEmail" label={LABELS.contactEmail} state={state} optional type="email" inputMode="email" autoComplete="email" maxLength={254} defaultValue={school?.contactEmail ?? ''} />
      <TextField form={form} name="contactPhone" label={LABELS.contactPhone} state={state} optional autoComplete="tel" maxLength={40} defaultValue={school?.contactPhone ?? ''} />

      <div className="grid gap-1.5" data-field="">
        <label htmlFor={fieldId(form, 'description')} className="text-sm font-semibold">
          {LABELS.description}
          <span className="font-normal text-fg-muted"> (optional)</span>
        </label>
        <textarea
          id={fieldId(form, 'description')}
          name="description"
          rows={5}
          maxLength={2000}
          defaultValue={values?.description ?? school?.description ?? ''}
          aria-invalid={error('description') ? true : undefined}
          aria-describedby={describedBy(error('description') && `${fieldId(form, 'description')}-error`)}
          className={cx(fieldClassName, 'py-3')}
        />
        <FieldError id={`${fieldId(form, 'description')}-error`} error={error('description')} />
      </div>

      <fieldset className="grid gap-1" data-field="">
        <legend className="mb-1 text-sm font-semibold">
          {LABELS.formsTaught}
          <span className="font-normal text-fg-muted"> (optional)</span>
        </legend>
        <div className="grid sm:grid-cols-2">
          {forms.map((f) => (
            <Check key={f.key} name="formsTaught" value={f.key} label={f.label} defaultChecked={saved('forms', f.key, school?.formsTaught)} />
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-1" data-field="">
        <legend className="mb-1 text-sm font-semibold">{LABELS.instructorIds}</legend>
        <p className="text-sm text-fg-muted">You are the head instructor. Others can be added from the students you confirmed.</p>
        <FieldError id={`${fieldId(form, 'instructorIds')}-error`} error={error('instructorIds')} />
        {others.length > 0 ? (
          others.map((o) => <Check key={o.id} name="instructorIds" value={o.id} label={o.label} defaultChecked={saved('instructor', o.id, school?.instructorIds)} />)
        ) : (
          <p className="text-sm text-fg-muted">None of your confirmed students can be added yet.</p>
        )}
      </fieldset>

      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {school ? 'Save changes' : 'Save the draft'}
        </SubmitButton>
      </div>
    </form>
  );
}
