'use client';

// The schedule and fees form of /dashboard/schools/<id>/schedule (M21, docs/adr/0024-trial-lessons.md):
// rows of day, start, end and a short label (a row left empty is dropped), the fees as a short free
// text, and "the first trial lesson is free". Native time inputs, so a phone shows its own picker;
// without JavaScript the form posts the same fields. A thin Server Action over
// schools.updateSchedule (../../actions.ts).

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { CheckboxField, describedBy, FieldError, fieldClassName, FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { updateScheduleAction } from '../../actions';
import { SCHEDULE_FORM } from '../../form-ids';

const FORM = SCHEDULE_FORM;

const DAYS = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [7, 'Sunday'],
] as const;

export interface ScheduleRow {
  weekday: string;
  startsAt: string;
  endsAt: string;
  label: string;
}

function RowField({
  row,
  name,
  label,
  state,
  defaultValue,
  children,
  className,
}: {
  row: number;
  name: keyof ScheduleRow;
  label: string;
  state: FormState;
  defaultValue: string;
  children: (props: { id: string; name: string; defaultValue: string; invalid: boolean; describedBy: string | undefined; readOnly: boolean }) => React.ReactNode;
  className?: string;
}) {
  const key = `slot.${row}.${name}`;
  const id = fieldId(FORM, key);
  const error = state.status === 'error' ? state.fields?.[key] : undefined;
  const errorId = `${id}-error`;
  const { pending } = useFormStatus();
  return (
    <div data-field="" className={cx('grid content-start gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({ id, name: key, defaultValue: state.status === 'error' ? (state.values?.[key] ?? '') : defaultValue, invalid: Boolean(error), describedBy: describedBy(error && errorId), readOnly: pending })}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

export function ScheduleForm({
  school,
  rows,
  fees,
  firstTrialFree,
  timezone,
  limits,
  initial,
}: {
  school: { id: string; name: string };
  rows: ScheduleRow[];
  fees: string | null;
  firstTrialFree: boolean;
  timezone: string;
  limits: { label: number; fees: number };
  initial: FormState | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateScheduleAction, initial ?? (firstTrialFree ? { status: 'idle', values: { firstTrialFree: 'on' } } : IDLE));
  useFocusOnError(FORM, state);
  return (
    <form id={FORM} action={action} className="grid gap-8" data-testid="schedule-form" noValidate>
      <FormMessage form={FORM} state={state} />
      <input type="hidden" name="id" value={school.id} />
      <input type="hidden" name="rows" value={rows.length} />
      <fieldset className="grid gap-4">
        <legend className="font-display text-xl">Weekly classes</legend>
        <p className="text-sm text-fg-muted">
          Times are local to the school ({timezone.replace(/_/g, ' ')}). Leave a row empty to remove it; save to get more empty rows.
        </p>
        <ol className="grid gap-4">
          {rows.map((r, row) => (
            <li key={row} className="grid gap-3 border-b border-border-subtle pb-4 sm:grid-cols-[minmax(9rem,1fr)_7rem_7rem_minmax(8rem,1.4fr)]" data-testid="schedule-row">
              <span className="sr-only">Class {row + 1}</span>
              <RowField row={row} name="weekday" label="Day" state={state} defaultValue={r.weekday}>
                {(p) => (
                  <select id={p.id} name={p.name} defaultValue={p.defaultValue} aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} className={fieldClassName}>
                    <option value="">No class</option>
                    {DAYS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </RowField>
              <RowField row={row} name="startsAt" label="Starts" state={state} defaultValue={r.startsAt}>
                {(p) => (
                  <input id={p.id} name={p.name} type="time" step={300} defaultValue={p.defaultValue} readOnly={p.readOnly} aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} className={fieldClassName} />
                )}
              </RowField>
              <RowField row={row} name="endsAt" label="Ends" state={state} defaultValue={r.endsAt}>
                {(p) => (
                  <input id={p.id} name={p.name} type="time" step={300} defaultValue={p.defaultValue} readOnly={p.readOnly} aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} className={fieldClassName} />
                )}
              </RowField>
              <RowField row={row} name="label" label="Class (optional)" state={state} defaultValue={r.label}>
                {(p) => (
                  <input
                    id={p.id}
                    name={p.name}
                    type="text"
                    maxLength={limits.label}
                    autoComplete="off"
                    placeholder="Beginners"
                    defaultValue={p.defaultValue}
                    readOnly={p.readOnly}
                    aria-invalid={p.invalid || undefined}
                    aria-describedby={p.describedBy}
                    className={fieldClassName}
                  />
                )}
              </RowField>
            </li>
          ))}
        </ol>
      </fieldset>
      <fieldset className="grid gap-4">
        <legend className="font-display text-xl">Fees</legend>
        <CheckboxField form={FORM} name="firstTrialFree" label="The first trial lesson is free" state={state} />
        <TextAreaField
          form={FORM}
          name="fees"
          label="Fees"
          state={state}
          optional
          maxLength={limits.fees}
          rows={4}
          defaultValue={state.status === 'error' ? undefined : (fees ?? undefined)}
          hint={`Up to ${limits.fees} characters, as you want them shown: a monthly fee, a single class, discounts.`}
        />
      </fieldset>
      <p className="text-sm text-fg-muted">
        Saving counts as activity for {school.name}: the listing stays as it is and its activity check starts again.
      </p>
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save the schedule
        </SubmitButton>
      </div>
    </form>
  );
}
