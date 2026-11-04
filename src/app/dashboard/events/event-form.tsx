'use client';

// The event form (milestone M17, In scope 6): whom to publish as, title, kind, the dates and times
// in the event's own zone (a city's zone, or the zone chosen for an online event), the city or
// online, the venue line, the school, the organizer's link, the instructors and the description.
// Saved through events.create or events.update (thin Server Actions, plan §6.8). It works without
// JavaScript: the times are native date-and-time fields, "Online" a radio, the city a select (the
// city search above the form puts its matches first).

import { useActionState, useState } from 'react';

import { describedBy, FieldError, fieldClassName, FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useHydrated } from '@/components/account/fields';
import { CheckIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import type { EventEditor, MyEvents } from '@/server/services/events';
import { createEventAction, updateEventAction } from './actions';
import { EVENT_FORM } from './form-ids';

const LABELS: Record<string, string> = {
  organizationId: 'Publish as',
  title: 'Title',
  kind: 'Kind',
  startsAt: 'Starts',
  endsAt: 'Ends',
  placeId: 'City or town',
  timezone: 'Time zone',
  venue: 'Venue',
  schoolId: 'School',
  externalUrl: 'Link',
  instructorIds: 'Instructors',
  description: 'About the event',
};

const radioClass = cx(
  'peer size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-surface-1',
  'checked:border-[7px] checked:border-fg hover:border-fg-muted forced-colors:appearance-auto',
);
const boxClass = cx(
  'peer size-6 cursor-pointer appearance-none rounded-[3px] border-2 border-border-strong bg-surface-1',
  'transition-colors duration-(--duration-fast) checked:border-fg checked:bg-fg hover:border-fg-muted',
  'forced-colors:appearance-auto',
);

export interface EventFormProps {
  editor: EventEditor;
  /** Whom the account may publish as (a new event only). */
  publishAs: MyEvents['publishAs'];
  cityQuery: string | null;
  initial: FormState | null;
}

export function EventForm({ editor, publishAs, cityQuery, initial }: EventFormProps) {
  const current = editor.event;
  const [state, action, pending] = useActionState(current ? updateEventAction : createEventAction, initial ?? IDLE);
  const form = EVENT_FORM;
  useFocusOnError(form, state);
  const hydrated = useHydrated();
  const values = state.values;
  const error = (name: string) => (state.status === 'error' ? state.fields?.[name] : undefined);

  const choices = publishAs.filter((p) => p.canPublish);
  const [as, setAs] = useState(values?.organizationId ?? (choices[0]?.kind === 'organization' ? choices[0].id! : 'self'));
  const [where, setWhere] = useState<'city' | 'online'>((values?.where as 'city' | 'online' | undefined) ?? (current?.online ? 'online' : 'city'));
  const firstFound = editor.places.find((p) => p.found)?.id;
  const [placeId, setPlaceId] = useState(values?.placeId ?? firstFound ?? current?.placeId ?? '');
  const organizationId = current ? current.organizationId : as === 'self' ? null : as;
  const schools = editor.schools.filter((s) => s.organizationId === organizationId);
  const found = editor.places.filter((p) => p.found);
  const byCountry = new Map<string, typeof editor.places>();
  for (const p of editor.places.filter((place) => !place.found)) byCountry.set(p.countryCode, [...(byCountry.get(p.countryCode) ?? []), p]);
  const isChosen = (id: string) => (values ? values[`instructor.${id}`] === 'on' : (current?.instructorIds ?? []).includes(id));
  const zoneHintId = `${fieldId(form, 'startsAt')}-zone`;

  return (
    <form id={form} action={action} noValidate className="grid gap-6" data-testid="event-form">
      <FormMessage form={form} state={state} labels={LABELS} />
      {current ? <input type="hidden" name="id" value={current.id} /> : null}

      {!current && publishAs.length > 1 ? (
        <fieldset className="grid gap-2" data-field="">
          <legend className="mb-1 text-sm font-semibold">{LABELS.organizationId}</legend>
          <FieldError id={`${fieldId(form, 'organizationId')}-error`} error={error('organizationId')} />
          {publishAs.map((p, i) => {
            const value = p.kind === 'self' ? 'self' : p.id!;
            return (
              <label key={value} className={cx('flex min-h-11 items-start gap-3 rounded-sm border border-border-subtle px-3 py-3 has-checked:border-fg', p.canPublish ? 'cursor-pointer' : 'opacity-70')}>
                <input
                  id={i === 0 ? fieldId(form, 'organizationId') : undefined}
                  type="radio"
                  name="organizationId"
                  value={value}
                  disabled={!p.canPublish}
                  defaultChecked={as === value}
                  onChange={() => setAs(value)}
                  className={radioClass}
                />
                <span className="grid gap-0.5">
                  <span className="text-ui font-semibold">{p.name}</span>
                  {p.note ? <span className="text-sm text-fg-muted">{p.note}</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : !current && choices[0]?.kind === 'organization' ? (
        <input type="hidden" name="organizationId" value={choices[0].id!} />
      ) : null}
      {current?.organizationName ? <p className="text-sm text-fg-muted">Published as {current.organizationName}.</p> : null}

      <TextField form={form} name="title" label={LABELS.title} state={state} autoComplete="off" maxLength={160} defaultValue={current?.title ?? ''} />

      <SelectField form={form} name="kind" label={LABELS.kind} state={state} autoComplete="off" defaultValue={values?.kind ?? current?.kind ?? ''}>
        <option value="" disabled>
          Choose the kind
        </option>
        {editor.kinds.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </SelectField>

      <fieldset className="grid gap-2" data-field="">
        <legend className="mb-1 text-sm font-semibold">Where</legend>
        {(
          [
            ['city', 'In a city', 'The times are in the city’s own time zone.'],
            ['online', 'Online', 'Choose the time zone the times are given in.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border-subtle px-3 py-3 has-checked:border-fg">
            <input type="radio" name="where" value={value} defaultChecked={where === value} onChange={() => setWhere(value)} className={radioClass} data-testid={`event-where-${value}`} />
            <span className="grid gap-0.5">
              <span className="text-ui font-semibold">{label}</span>
              <span className="text-sm text-fg-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Both are drawn without JavaScript (the server reads the one the radio chose); with it,
          only the chosen one shows. */}
      <div className={cx('grid gap-6', hydrated && where === 'online' && 'hidden')}>
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
          <option value="">Choose the city or town</option>
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
        <TextField
          form={form}
          name="venue"
          label={LABELS.venue}
          state={state}
          optional
          autoComplete="off"
          maxLength={200}
          hint="A line you publish yourself, such as a hall or a park. Never your school’s private address."
          defaultValue={current?.venue ?? ''}
        />
      </div>

      <div className={cx(hydrated && where === 'city' && 'hidden')}>
        <SelectField form={form} name="timezone" label={LABELS.timezone} state={state} autoComplete="off" defaultValue={values?.timezone ?? current?.timezone ?? 'UTC'}>
          {editor.timezones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(['startsAt', 'endsAt'] as const).map((name) => {
          const id = fieldId(form, name);
          return (
            <div key={name} className="grid gap-1.5" data-field="">
              <label htmlFor={id} className="text-sm font-semibold">
                {LABELS[name]}
              </label>
              <input
                id={id}
                name={name}
                type="datetime-local"
                step={300}
                required
                defaultValue={values?.[name] ?? current?.[name] ?? ''}
                aria-invalid={error(name) ? true : undefined}
                aria-describedby={describedBy(zoneHintId, error(name) && `${id}-error`)}
                className={fieldClassName}
              />
              <FieldError id={`${id}-error`} error={error(name)} />
            </div>
          );
        })}
      </div>
      <p id={zoneHintId} className="-mt-3 text-sm text-fg-muted">
        {where === 'online' ? 'In the time zone chosen above.' : 'In the chosen city’s own time zone.'} Every page shows the event in this zone, with its name.
      </p>

      {schools.length > 0 ? (
        <SelectField form={form} name="schoolId" label={LABELS.schoolId} state={state} optional autoComplete="off" defaultValue={values?.schoolId ?? current?.schoolId ?? ''}>
          <option value="">No school</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <TextField
        form={form}
        name="externalUrl"
        label={LABELS.externalUrl}
        state={state}
        optional
        autoComplete="url"
        maxLength={600}
        placeholder="https://"
        hint="Your own page about the event, with https://. It opens in the same window."
        defaultValue={current?.externalUrl ?? ''}
      />

      <fieldset className="grid gap-1" data-field="">
        <legend className="mb-1 text-sm font-semibold">
          {LABELS.instructorIds}
          <span className="font-normal text-fg-muted"> (optional, at most 5)</span>
        </legend>
        <p className="text-sm text-fg-muted">People of the archive with a public profile: you, your confirmed teachers and students, your schools’ instructors.</p>
        <FieldError id={`${fieldId(form, 'instructorIds')}-error`} error={error('instructorIds')} />
        {editor.instructorOptions.length > 0 ? (
          <div className="grid sm:grid-cols-2">
            {editor.instructorOptions.map((o, i) => (
              <label key={o.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-ui">
                <span className="relative grid size-6 shrink-0 place-items-center">
                  <input
                    id={i === 0 ? fieldId(form, 'instructorIds') : undefined}
                    type="checkbox"
                    name="instructorIds"
                    value={o.id}
                    defaultChecked={isChosen(o.id)}
                    className={boxClass}
                  />
                  <CheckIcon size={18} className="pointer-events-none absolute hidden text-fg-inverse peer-checked:block forced-colors:peer-checked:hidden" />
                </span>
                <span className="min-w-0 pt-px">{o.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Nobody can be named yet.</p>
        )}
      </fieldset>

      <div className="grid gap-1.5" data-field="">
        <label htmlFor={fieldId(form, 'description')} className="text-sm font-semibold">
          {LABELS.description}
          <span className="font-normal text-fg-muted"> (optional)</span>
        </label>
        <textarea
          id={fieldId(form, 'description')}
          name="description"
          rows={6}
          maxLength={4000}
          defaultValue={values?.description ?? current?.description ?? ''}
          aria-invalid={error('description') ? true : undefined}
          aria-describedby={describedBy(error('description') && `${fieldId(form, 'description')}-error`)}
          className={cx(fieldClassName, 'py-3')}
        />
        <FieldError id={`${fieldId(form, 'description')}-error`} error={error('description')} />
      </div>

      <div>
        <SubmitButton pending={pending} pendingLabel={current ? 'Saving…' : 'Publishing…'}>
          {current ? 'Save changes' : 'Publish the event'}
        </SubmitButton>
      </div>
    </form>
  );
}
