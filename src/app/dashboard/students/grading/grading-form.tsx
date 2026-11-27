'use client';

// "Record a grading" (role replay 2026-11-25, P2-8, ADR 0072): the date, the awarded rank (the
// account's rank ladder as the pick list), the examiner and the issuer once, then a tick for each
// student who passed. Native checkboxes in a fieldset: it works without JavaScript, and the service
// checks every student again.

import { useActionState } from 'react';

import { CheckboxField, describedBy, FieldError, FormMessage, SelectField, SubmitButton, TextField, useFocusOnError } from '@/components/account/fields';
import { type FormState, fieldId, IDLE } from '@/lib/form-state';
import { GRADING_FORM } from '../form-ids';
import { recordGradingAction } from './actions';

export interface GradingStudent {
  personId: string;
  name: string;
  lang: string;
  standing: string;
}

interface Choice {
  value: string;
  label: string;
}

export function GradingForm({
  students,
  examiners,
  organizations,
  ladder,
  teacher,
  initial,
}: {
  students: GradingStudent[];
  /** The account has a profile of its own and so can award as the teacher. */
  teacher: boolean;
  examiners: Choice[];
  organizations: Choice[];
  ladder?: string;
  initial: FormState | null;
}) {
  const [state, action, pending] = useActionState(recordGradingAction, initial ?? IDLE);
  useFocusOnError(GRADING_FORM, state);
  const form = GRADING_FORM;
  const ticked = new Set((state.values?.personIds ?? '').split(',').filter(Boolean));
  const error = state.status === 'error' ? state.fields?.personIds : undefined;
  const groupId = fieldId(form, 'personIds');
  return (
    <form id={form} action={action} noValidate className="grid gap-5" data-testid="passport-grading-form">
      <FormMessage form={form} state={state} labels={{ awardedRank: 'Awarded rank', date: 'Date', examinerPersonId: 'Examiner', organizationId: 'Awarded by', personIds: 'Who passed' }} />
      <TextField
        form={form}
        name="awardedRank"
        label="Awarded rank"
        state={state}
        autoComplete="off"
        maxLength={120}
        list={ladder}
        hint={ladder ? 'Pick one of your rank ladder, or write another.' : 'As your school writes it, such as “Second level”.'}
      />
      <TextField
        form={form}
        name="date"
        label="Date"
        state={state}
        optional
        autoComplete="off"
        inputMode="numeric"
        maxLength={10}
        hint="A year (2019), a month (2019-05) or a day (2019-05-12), as precise as you know it; or leave it empty."
      />
      <SelectField form={form} name="examinerPersonId" label="Examiner" state={state} optional autoComplete="off" defaultValue={state.values?.examinerPersonId ?? ''} hint="You or your teachers. Anyone but you is named once they accept.">
        <option value="">Not recorded</option>
        {examiners.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </SelectField>
      {organizations.length > 0 ? (
        <SelectField
          form={form}
          name="organizationId"
          label="Awarded by"
          state={state}
          optional={teacher}
          autoComplete="off"
          defaultValue={state.values?.organizationId ?? (teacher ? '' : organizations[0]!.value)}
          hint={teacher ? 'An organization you administer, or yourself as the teacher.' : 'The organization you administer that awards it.'}
        >
          {teacher ? <option value="">You, as the teacher</option> : null}
          {organizations.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <CheckboxField form={form} name="alsoRank" label="Also make it their current rank" state={state} defaultChecked hint="Each student gets the examination; with this, also the rank." />
      <fieldset
        id={groupId}
        tabIndex={-1}
        className="grid gap-1 border-t border-border-subtle pt-4"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(`${groupId}-hint`, error && `${groupId}-error`)}
        data-field=""
      >
        <legend className="font-display text-xl">Who passed</legend>
        <p id={`${groupId}-hint`} className="text-sm text-fg-muted">
          Tick each student who passed. At most 50 at a time.
        </p>
        <FieldError id={`${groupId}-error`} error={error} />
        <ul className="grid gap-0.5">
          {students.map((s) => {
            const id = `${groupId}-${s.personId}`;
            return (
              <li key={s.personId}>
                <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-2" data-testid="grading-student">
                  <input id={id} type="checkbox" name="personId" value={s.personId} defaultChecked={ticked.has(s.personId)} className="size-6 shrink-0 cursor-pointer accent-fg" />
                  <span className="grid">
                    <span lang={s.lang} translate="no" className="font-display text-lg">
                      {s.name}
                    </span>
                    <span className="text-sm text-fg-muted">{s.standing}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div>
        <SubmitButton pending={pending} pendingLabel="Recording…">
          Record the grading
        </SubmitButton>
      </div>
    </form>
  );
}
