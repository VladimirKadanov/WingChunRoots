'use client';

// The forms of the review queue (milestone M10a, In scope 4 and 5): assign, the three decisions,
// the internal note and the archival edit. Each is one thin Server Action over one procedure
// (./actions.ts), with an idempotency key the page made for it (except the archival edit, which
// writes nothing when nothing changed). The button is aria-disabled while the action runs, so a
// double click sends one request. They work without JavaScript: the browser posts the form and a
// refusal comes back opened at the form's message (src/server/forms/flash.ts).

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader } from '@/components/evidence/uploader';
import { ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import type { ArchiveRecordView } from '@/server/services/review';
import { discardEvidenceAction } from '../../dashboard/teachers/historical/actions';
import { addNoteAction, archiveUpdateAction, assignCaseAction, decideCaseAction } from './actions';
import { ARCHIVE_FORM, assignForm, DECIDE_FORM, NOTE_FORM } from './form-ids';

function Button({ pending, label, pendingLabel, variant = 'secondary' }: { pending: boolean; label: string; pendingLabel: string; variant?: 'secondary' | 'ink' | 'danger' | 'primary' }) {
  return (
    <button
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      // Full width on a phone, every decision button alike (M10a review, screens-10).
      className={cx(buttonVariants({ variant }), 'w-full sm:w-auto sm:min-w-40')}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * "Assign to me", "Unassign", or an administrator's choice of reviewer. The form sends its `mode`,
 * so only "Unassign" ever unassigns; "Assign" with no reviewer chosen is refused with the field's
 * message (M10a review, screens-1).
 */
export function AssignForm({
  caseId,
  idempotencyKey,
  mode,
  reviewers = [],
  initial,
}: {
  caseId: string;
  idempotencyKey: string;
  /** `self`: assign to me; `none`: unassign; `choose`: an administrator picks a reviewer. */
  mode: { kind: 'self'; userId: string } | { kind: 'none' } | { kind: 'choose' };
  reviewers?: { id: string; label: string }[];
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(assignCaseAction, initial ?? IDLE);
  const fixedId = assignForm(mode.kind);
  const generatedId = useFormId(fixedId);
  const formId = initial ? fixedId : generatedId;
  useFocusOnError(formId, state);
  const [assignee, setAssignee] = useState(initial?.values?.assigneeId ?? '');
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-2" data-testid={`assign-${mode.kind}`}>
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="mode" value={mode.kind} />
      {mode.kind === 'self' ? <input type="hidden" name="assigneeId" value={mode.userId} /> : null}
      {mode.kind === 'choose' ? (
        <SelectField form={formId} name="assigneeId" label="Give the case to" autoComplete="off" state={state} value={assignee} onValue={setAssignee}>
          {/* Not disabled: the select always sends a value, and an empty one is refused by name. */}
          <option value="">Choose a reviewer</option>
          {reviewers.map((reviewer) => (
            <option key={reviewer.id} value={reviewer.id}>
              {reviewer.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <div>
        <Button
          pending={pending}
          label={mode.kind === 'self' ? 'Assign to me' : mode.kind === 'none' ? 'Unassign' : 'Assign'}
          pendingLabel={mode.kind === 'none' ? 'Unassigning…' : 'Assigning…'}
          variant={mode.kind === 'self' ? 'ink' : 'secondary'}
        />
      </div>
    </form>
  );
}

const DECISIONS = {
  verify: {
    label: 'Verify the claim',
    pending: 'Verifying…',
    reason: 'Note on the decision',
    hint: 'Optional. Kept with the case for the reviewers; the claimant is told the claim was confirmed.',
    optional: true,
    variant: 'primary',
  },
  reject: {
    label: 'Refuse the claim',
    pending: 'Refusing…',
    reason: 'Reason',
    hint: 'Required. The claimant reads it on Your teachers. Neutral and specific: what the evidence does not show.',
    optional: false,
    variant: 'danger',
  },
  needs_info: {
    label: 'Ask for more information',
    pending: 'Sending…',
    reason: 'Question for the claimant',
    hint: 'Required. The claimant reads it on Your teachers and can add evidence to the claim.',
    optional: false,
    variant: 'secondary',
  },
} as const;

/** One decision on a case: verify, refuse with a reason, or ask for more information. */
export function DecideForm({ caseId, decision, idempotencyKey, initial }: { caseId: string; decision: keyof typeof DECISIONS; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(decideCaseAction, initial ?? IDLE);
  const generatedId = useFormId(`${DECIDE_FORM}-${decision}`);
  const formId = initial ? `${DECIDE_FORM}-${decision}` : generatedId;
  useFocusOnError(formId, state);
  const text = DECISIONS[decision];
  return (
    <details open={state.status === 'error' || undefined} className="group rounded-sm border border-border-strong" data-testid={`decide-${decision}`}>
      {/* The chevron turns when the form is open (M10a review, screens-10), as on every disclosure. */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm px-4 py-2 font-semibold hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
        <span>{text.label}…</span>
        <ChevronDownIcon size={18} className="shrink-0 text-fg-muted transition-transform duration-(--duration-fast) group-open:rotate-180" />
      </summary>
      <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3 px-4 pt-1 pb-4">
        <FormMessage form={formId} state={state} single />
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="decision" value={decision} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <TextAreaField form={formId} name="reason" label={text.reason} optional={text.optional} maxLength={2000} hint={text.hint} state={state} />
        <div>
          <Button pending={pending} label={text.label} pendingLabel={text.pending} variant={text.variant} />
        </div>
      </form>
    </details>
  );
}

/** An internal note: for reviewers only, never shown to the parties. */
export function NoteForm({ caseId, idempotencyKey, initial }: { caseId: string; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(addNoteAction, initial ?? IDLE);
  const generatedId = useFormId(NOTE_FORM);
  const formId = initial ? NOTE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="note-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextAreaField form={formId} name="body" label="Internal note" maxLength={2000} hint="Only reviewers read internal notes." state={state} />
      <div>
        <Button pending={pending} label="Add the note" pendingLabel="Adding…" />
      </div>
    </form>
  );
}

/** The archival edit of a record kept by the platform or unclaimed (an archivist only). */
export function ArchiveForm({ record, initial }: { record: ArchiveRecordView; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(archiveUpdateAction, initial ?? IDLE);
  const generatedId = useFormId(ARCHIVE_FORM);
  const formId = initial ? ARCHIVE_FORM : generatedId;
  useFocusOnError(formId, state);
  const start = initial?.values;
  const [selects, setSelects] = useState({ lifeStatus: start?.lifeStatus ?? record.lifeStatus, originalLang: start?.originalLang ?? record.original?.lang ?? '' });
  const labels = { primaryName: 'Name in Latin letters', originalName: 'Name in its own script', originalLang: 'Script', lifeStatus: 'Life status', bio: 'Biography', reason: 'Reason', evidenceIds: 'Evidence' };
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="archive-form">
      <FormMessage form={formId} state={state} labels={labels} />
      <input type="hidden" name="personId" value={record.id} />
      <input type="hidden" name="slug" value={record.slug} />
      <TextField form={formId} name="primaryName" label={labels.primaryName} autoComplete="off" maxLength={120} defaultValue={record.primaryName} state={state} className="max-w-[34rem]" />
      <div className="grid gap-3 sm:max-w-[34rem]">
        <TextField form={formId} name="originalName" label={labels.originalName} optional autoComplete="off" maxLength={120} defaultValue={record.original?.value} state={state} />
        <SelectField
          form={formId}
          name="originalLang"
          label="Script of that name"
          optional
          autoComplete="off"
          state={state}
          value={selects.originalLang}
          onValue={(value) => setSelects((current) => ({ ...current, originalLang: value }))}
        >
          <option value="">Choose a script</option>
          {record.scripts.map((script) => (
            <option key={script.lang} value={script.lang}>
              {script.label}
            </option>
          ))}
        </SelectField>
      </div>
      <SelectField
        form={formId}
        name="lifeStatus"
        label={labels.lifeStatus}
        autoComplete="off"
        state={state}
        className="max-w-[34rem]"
        value={selects.lifeStatus}
        onValue={(value) => setSelects((current) => ({ ...current, lifeStatus: value as typeof current.lifeStatus }))}
      >
        <option value="unknown">Not known</option>
        <option value="deceased">Deceased</option>
        <option value="living">Living</option>
      </SelectField>
      <TextAreaField form={formId} name="bio" label="Biography (English)" optional maxLength={1000} rows={5} lang="en" defaultValue={record.bio ?? undefined} state={state} className="max-w-[40rem]" />
      <EvidenceUploader
        label="Link evidence"
        hint="Optional. JPEG, PNG, WebP or PDF, up to 20 MB each. Linked files stay with the record."
        discard={discardEvidenceAction}
        // The error summary's link and the focus after a refusal find the field by this id (screens-3).
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <TextAreaField
        form={formId}
        name="reason"
        label={labels.reason}
        maxLength={2000}
        hint="Required. Why the record changes and on what basis; kept in the audit log with your name and role."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save the record
        </SubmitButton>
      </div>
    </form>
  );
}
