'use client';

// The teacher's passport forms on /dashboard/students (milestone M19, In scope 2 and 7): record a
// rank, an examination or a form or skill; change one (the title, the date, a skill's progress);
// withdraw one; mark attendance at a past event. Thin Server Actions over the passport procedures;
// the service checks everything again (a verified relationship or the issuing organization, never
// the student, a relationship in arbitration read only). Dates as people remember them: a year, a
// month or a day (DEFAULT M19, question 2).

import Link from 'next/link';
import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE } from '@/lib/form-state';
import { addExamAction, addRankAction, addSkillAction, markAttendanceAction, updateEntryAction, withdrawEntryAction } from './actions';
import { ENTRY_FORM, EXAM_FORM, RANK_FORM, SKILL_FORM } from './form-ids';

export interface Choice {
  value: string;
  label: string;
}

const DATE_HINT = 'A year (2019), a month (2019-05) or a day (2019-05-12), as precise as you know it; or leave it empty.';

function DateField({ form, state, defaultValue }: { form: string; state: FormState; defaultValue?: string }) {
  return <TextField form={form} name="date" label="Date" state={state} optional hint={DATE_HINT} autoComplete="off" inputMode="numeric" maxLength={10} defaultValue={defaultValue} />;
}

function OrganizationField({ form, state, organizations }: { form: string; state: FormState; organizations: Choice[] }) {
  if (organizations.length === 0) return null;
  return (
    <SelectField form={form} name="organizationId" label="Awarded by" state={state} optional autoComplete="off" defaultValue={state.values?.organizationId ?? ''} hint="An organization you administer, or yourself as the teacher.">
      <option value="">You, as the teacher</option>
      {organizations.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectField>
  );
}

export function RankForm({ personId, organizations, initial }: { personId: string; organizations: Choice[]; initial: FormState | null }) {
  const [state, action, pending] = useActionState(addRankAction, initial ?? IDLE);
  useFocusOnError(RANK_FORM, state);
  return (
    <form id={RANK_FORM} action={action} noValidate className="grid gap-4" data-testid="passport-rank-form">
      <FormMessage form={RANK_FORM} state={state} labels={{ rank: 'Rank', date: 'Date', organizationId: 'Awarded by' }} />
      <input type="hidden" name="personId" value={personId} />
      <TextField form={RANK_FORM} name="rank" label="Rank" state={state} autoComplete="off" maxLength={120} hint="As your school writes it, such as “Second level”." />
      <DateField form={RANK_FORM} state={state} />
      <OrganizationField form={RANK_FORM} state={state} organizations={organizations} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Recording…" variant="secondary">
          Record the rank
        </SubmitButton>
      </div>
    </form>
  );
}

export function ExamForm({ personId, organizations, examiners, initial }: { personId: string; organizations: Choice[]; examiners: Choice[]; initial: FormState | null }) {
  const [state, action, pending] = useActionState(addExamAction, initial ?? IDLE);
  useFocusOnError(EXAM_FORM, state);
  return (
    <form id={EXAM_FORM} action={action} noValidate className="grid gap-4" data-testid="passport-exam-form">
      <FormMessage form={EXAM_FORM} state={state} labels={{ awardedRank: 'Awarded rank', date: 'Date', examinerPersonId: 'Examiner', organizationId: 'Awarded by' }} />
      <input type="hidden" name="personId" value={personId} />
      <TextField form={EXAM_FORM} name="awardedRank" label="Awarded rank" state={state} autoComplete="off" maxLength={120} />
      <DateField form={EXAM_FORM} state={state} />
      <SelectField
        form={EXAM_FORM}
        name="examinerPersonId"
        label="Examiner"
        state={state}
        optional
        autoComplete="off"
        defaultValue={state.values?.examinerPersonId ?? ''}
        hint="You, your teachers or the student’s other teachers. The profile names the examiner only while their own profile is public."
      >
        <option value="">Not recorded</option>
        {examiners.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </SelectField>
      <OrganizationField form={EXAM_FORM} state={state} organizations={organizations} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Recording…" variant="secondary">
          Record the examination
        </SubmitButton>
      </div>
    </form>
  );
}

export function SkillForm({ personId, organizations, initial }: { personId: string; organizations: Choice[]; initial: FormState | null }) {
  const [state, action, pending] = useActionState(addSkillAction, initial ?? IDLE);
  useFocusOnError(SKILL_FORM, state);
  return (
    <form id={SKILL_FORM} action={action} noValidate className="grid gap-4" data-testid="passport-skill-form">
      <FormMessage form={SKILL_FORM} state={state} labels={{ name: 'Form or skill', progress: 'Progress', date: 'Date', organizationId: 'Awarded by' }} />
      <input type="hidden" name="personId" value={personId} />
      <TextField form={SKILL_FORM} name="name" label="Form or skill" state={state} autoComplete="off" maxLength={120} />
      <SelectField form={SKILL_FORM} name="progress" label="Progress" state={state} autoComplete="off" defaultValue={state.values?.progress ?? 'learning'}>
        <option value="learning">Learning</option>
        <option value="approved">Approved by the teacher</option>
      </SelectField>
      <DateField form={SKILL_FORM} state={state} />
      <OrganizationField form={SKILL_FORM} state={state} organizations={organizations} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Recording…" variant="secondary">
          Record the form or skill
        </SubmitButton>
      </div>
    </form>
  );
}

/** The change of one entry: its title and date, and a skill's progress. */
export function EditEntryForm({
  personId,
  kind,
  id,
  title,
  date,
  progress,
  cancelHref,
  initial,
}: {
  personId: string;
  kind: 'rank' | 'exam' | 'skill';
  id: string;
  title: string;
  date: string | null;
  progress: 'learning' | 'approved' | null;
  cancelHref: string;
  initial: FormState | null;
}) {
  const [state, action, pending] = useActionState(updateEntryAction, initial ?? IDLE);
  useFocusOnError(ENTRY_FORM, state);
  const titleLabel = kind === 'rank' ? 'Rank' : kind === 'exam' ? 'Awarded rank' : 'Form or skill';
  return (
    <form id={ENTRY_FORM} action={action} noValidate className="grid gap-4 rounded-sm border border-border-strong p-4" data-testid="passport-edit-form">
      <FormMessage form={ENTRY_FORM} state={state} labels={{ title: titleLabel, date: 'Date', progress: 'Progress' }} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <TextField form={ENTRY_FORM} name="title" label={titleLabel} state={state} autoComplete="off" maxLength={120} defaultValue={title} autoFocus />
      <DateField form={ENTRY_FORM} state={state} defaultValue={date ?? ''} />
      {kind === 'skill' ? (
        <SelectField form={ENTRY_FORM} name="progress" label="Progress" state={state} autoComplete="off" defaultValue={state.values?.progress ?? progress ?? 'learning'}>
          <option value="learning">Learning</option>
          <option value="approved">Approved by the teacher</option>
        </SelectField>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} pendingLabel="Saving…" variant="secondary">
          Save the change
        </SubmitButton>
        <Link href={cancelHref} className="link inline-flex min-h-11 items-center">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** A one-button form of a row (withdraw, mark as attended): the refusal in words under it. */
function RowButton({
  action,
  fields,
  label,
  pendingLabel,
  testId,
  initial,
}: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  label: React.ReactNode;
  pendingLabel: string;
  testId: string;
  initial: FormState | null;
}) {
  const [state, formAction, pending] = useActionState(action, initial ?? IDLE);
  return (
    <form action={formAction} className="grid gap-1" data-testid={testId}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div>
        <button
          type="submit"
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          className={buttonVariants({ variant: 'ghost' })}
        >
          {pending ? pendingLabel : label}
        </button>
      </div>
      {state.status === 'error' && state.message ? (
        <p role="status" className="text-sm text-danger">
          <span className="font-semibold">Not changed:</span> {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function WithdrawButton({ personId, kind, id, title, initial }: { personId: string; kind: string; id: string; title: string; initial: FormState | null }) {
  return (
    <RowButton
      action={withdrawEntryAction}
      fields={{ personId, kind, id }}
      label={
        <>
          Withdraw<span className="sr-only"> “{title}”</span>
        </>
      }
      pendingLabel="Withdrawing…"
      testId="passport-withdraw-form"
      initial={initial}
    />
  );
}

export function AttendanceButton({ personId, eventId, title, initial }: { personId: string; eventId: string; title: string; initial: FormState | null }) {
  return (
    <RowButton
      action={markAttendanceAction}
      fields={{ personId, eventId }}
      label={
        <>
          Mark as attended<span className="sr-only">: {title}</span>
        </>
      }
      pendingLabel="Marking…"
      testId="passport-attendance-form"
      initial={initial}
    />
  );
}
