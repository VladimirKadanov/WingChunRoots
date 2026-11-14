'use client';

// The forms of the review queue (milestone M10a, In scope 4 and 5): assign, the three decisions,
// the internal note and the archival edit. Each is one thin Server Action over one procedure
// (./actions.ts), with an idempotency key the page made for it (except the archival edit, which
// writes nothing when nothing changed). The button is aria-disabled while the action runs, so a
// double click sends one request. They work without JavaScript: the browser posts the form and a
// refusal comes back opened at the form's message (src/server/forms/flash.ts).

import { useActionState, useState } from 'react';

import { CheckboxField, FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader } from '@/components/evidence/uploader';
import { ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import type { ArchiveRecordView } from '@/server/services/review';
import { discardEvidenceAction } from '../../dashboard/teachers/historical/actions';
import { addNoteAction, arbitrateAction, archiveUpdateAction, assignCaseAction, decideCaseAction, removeGalleryPhotoAction, removePhotoAction, removeSchoolPhotoAction, restoreAction, takeDownAction } from './actions';
import { ARBITRATE_FORM, ARCHIVE_FORM, assignForm, DECIDE_FORM, GALLERY_REMOVE_FORM, NOTE_FORM, PHOTO_REMOVE_FORM, RESTORE_FORM, SCHOOL_PHOTO_REMOVE_FORM, TAKEDOWN_FORM } from './form-ids';

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
/** The words of a decision for the case's kind (M10b: review.get `decisions`); the claim's by default. */
export interface DecideText {
  label: string;
  pending: string;
  reason: string;
  hint: string;
  optional: boolean;
}

export function DecideForm({
  caseId,
  decision,
  idempotencyKey,
  initial,
  text: given,
  schoolVersion = null,
  organizationVersion = null,
  takeDownOption = false,
  lifeStatusChoice = false,
}: {
  caseId: string;
  decision: keyof typeof DECISIONS;
  idempotencyKey: string;
  initial?: FormState | null;
  text?: DecideText;
  /** M11: a school listing is decided from the version of the listing the card shows (school-review.ts). */
  schoolVersion?: string | null;
  /** M15: an organization's application is decided from the version the card shows (organization-review.ts). */
  organizationVersion?: string | null;
  /** Review 2026-11: an upheld report may also take the profile down (a box, never ticked in advance). */
  takeDownOption?: boolean;
  /**
   * Review 2026-11-14 (owner decision): the teacher's life status is "unknown", so the record is
   * treated as living and hidden. Verifying asks the plain question first (the evidence shows a
   * death, or it cannot be established); only the first publishes the record.
   */
  lifeStatusChoice?: boolean;
}) {
  const [state, action, pending] = useActionState(decideCaseAction, initial ?? IDLE);
  const generatedId = useFormId(`${DECIDE_FORM}-${decision}`);
  const formId = initial ? `${DECIDE_FORM}-${decision}` : generatedId;
  useFocusOnError(formId, state);
  const choosing = lifeStatusChoice && decision === 'verify';
  const [deceased, setDeceased] = useState(state.values?.deceased ?? '');
  const establishing = choosing && deceased === 'established';
  const text = { ...DECISIONS[decision], ...given, variant: DECISIONS[decision].variant };
  const reasonHint = establishing
    ? 'Required. Say what the evidence shows and where to find it (a file on this case, a source). Kept with the case and in the audit log; the claimant is not shown it.'
    : choosing
      ? 'Optional here. Kept with the case for the reviewers; the claimant is told the claim was confirmed.'
      : text.hint;
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
        {schoolVersion ? <input type="hidden" name="schoolVersion" value={schoolVersion} /> : null}
        {organizationVersion ? <input type="hidden" name="organizationVersion" value={organizationVersion} /> : null}
        {choosing ? <LifeStatusChoice form={formId} state={state} value={deceased} onValue={setDeceased} /> : null}
        <TextAreaField form={formId} name="reason" label={text.reason} optional={establishing ? false : text.optional} maxLength={2000} hint={reasonHint} state={state} />
        {takeDownOption ? (
          <CheckboxField
            form={formId}
            name="takeDown"
            label="Also take the profile down from the public pages"
            hint="Not ticked unless you choose it. The note above is then required and is sent to the owner as the reason (never name the reporter). You can put the profile back from the record page."
            state={state}
          />
        ) : null}
        <div>
          <Button pending={pending} label={text.label} pendingLabel={text.pending} variant={text.variant} />
        </div>
      </form>
    </details>
  );
}

/**
 * The plain choice a verify of a claim about a teacher with an unknown life status asks for
 * (review 2026-11-14). Both answers verify the claim when the evidence supports the training; only
 * the first makes the record public, because only that one establishes that the teacher has died.
 */
function LifeStatusChoice({ form, state, value, onValue }: { form: string; state: FormState; value: string; onValue: (value: string) => void }) {
  const error = state.status === 'error' ? state.fields?.deceased : undefined;
  const errorId = `${fieldId(form, 'deceased')}-error`;
  const options = [
    {
      value: 'established',
      label: 'The evidence shows this person is deceased',
      text: 'The record is marked deceased with your reason and is shown publicly once both people of the link have chosen to be public.',
    },
    {
      value: 'not_established',
      label: 'I cannot establish this',
      text: 'The claim can still be verified. The record stays hidden, treated as a living person, until someone with the evidence marks it deceased.',
    },
  ] as const;
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="grid gap-2" data-testid="life-status-choice">
      <legend className="mb-1 font-semibold">The teacher’s life status is not known</legend>
      <p className="text-sm text-fg-muted">A person whose status is not known is treated as living and is never shown publicly. Choose one to verify.</p>
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {options.map((option, index) => (
        <label
          key={option.value}
          className={cx(
            'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-sm border border-border-strong bg-surface-1 p-3',
            'transition-colors duration-(--duration-fast) hover:border-fg-muted has-[:checked]:border-fg has-[:checked]:bg-surface-2',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
            'forced-colors:has-[:checked]:border-2 forced-colors:has-[:checked]:p-[11px]',
          )}
        >
          <input
            type="radio"
            name="deceased"
            value={option.value}
            id={index === 0 ? fieldId(form, 'deceased') : undefined}
            checked={value === option.value}
            onChange={() => onValue(option.value)}
            className={cx(
              'mt-0.5 grid size-5 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border-[1.5px] border-fg bg-surface-1 focus-visible:outline-none',
              'before:size-2.5 before:scale-0 before:rounded-full before:bg-fg before:transition-transform before:duration-(--duration-fast) checked:before:scale-100',
              'forced-colors:appearance-auto forced-colors:before:hidden',
            )}
          />
          <span className="grid gap-0.5">
            <span className="font-semibold">{option.label}</span>
            <span className="text-sm text-fg-muted">{option.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
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

/**
 * M10b (DEFAULT D19): "Set in arbitration" of a verified relationship, with the reason both people
 * read (a moderator or an administrator; review.arbitrate).
 */
export function ArbitrateForm({ relationshipId, idempotencyKey, initial }: { relationshipId: string; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(arbitrateAction, initial ?? IDLE);
  const generatedId = useFormId(ARBITRATE_FORM);
  const formId = initial ? ARBITRATE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="arbitrate-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="relationshipId" value={relationshipId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextAreaField
        form={formId}
        name="reason"
        label="Reason"
        maxLength={2000}
        hint="Required. Both people read it in their notification, their e-mail and on their case page. Say what is disputed and what evidence would settle it."
        state={state}
      />
      <div>
        <Button pending={pending} label="Set in arbitration" pendingLabel="Setting…" variant="danger" />
      </div>
    </form>
  );
}

/**
 * M14: "Remove photo" of the profile a case is about, with the reason kept in the audit log
 * (photos.remove; staff with the second factor). The owner can add a new photo afterwards.
 */
export function RemovePhotoForm({ caseId, slug, initial }: { caseId: string; slug: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(removePhotoAction, initial ?? IDLE);
  const generatedId = useFormId(PHOTO_REMOVE_FORM);
  const formId = initial ? PHOTO_REMOVE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="photo-remove-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="slug" value={slug} />
      <TextAreaField
        form={formId}
        name="reason"
        label="Reason for removing the photo"
        maxLength={1000}
        hint="Required. Kept in the audit log. The photo's files are deleted; the person can add another photo."
        state={state}
      />
      <div>
        <Button pending={pending} label="Remove photo" pendingLabel="Removing…" variant="danger" />
      </div>
    </form>
  );
}

/**
 * M16: "Remove photo" of one photo of a gallery (a reported profile's: gallery.remove) or of a
 * school (its listing case: schoolPhotos.remove), with the reason kept in the audit log.
 */
export function RemoveGalleryPhotoForm({
  caseId,
  photoId,
  kind,
  initial,
}: {
  caseId: string;
  photoId: string;
  kind: 'person' | 'school';
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(kind === 'person' ? removeGalleryPhotoAction : removeSchoolPhotoAction, initial ?? IDLE);
  const fixed = kind === 'person' ? GALLERY_REMOVE_FORM : SCHOOL_PHOTO_REMOVE_FORM;
  const generatedId = useFormId(fixed);
  const formId = initial ? fixed : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="gallery-remove-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="photoId" value={photoId} />
      <TextAreaField
        form={formId}
        name="reason"
        label="Reason for removing this photo"
        maxLength={1000}
        hint="Required. Kept in the audit log. The photo's files are deleted."
        state={state}
      />
      <div>
        <Button pending={pending} label="Remove photo" pendingLabel="Removing…" variant="danger" />
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

/**
 * Review 2026-11: "Take down" (the record leaves every public page, with a reason the owner reads)
 * and "Restore" (it goes back), for a moderator or an administrator. From a case, `caseId` records
 * the change on it.
 */
export function TakeDownForm({
  personId,
  slug,
  caseId,
  held,
  initial,
}: {
  personId: string;
  slug: string;
  caseId?: string;
  held: boolean;
  initial?: FormState | null;
}) {
  const fixed = held ? RESTORE_FORM : TAKEDOWN_FORM;
  const [state, action, pending] = useActionState(held ? restoreAction : takeDownAction, initial ?? IDLE);
  const generatedId = useFormId(fixed);
  const formId = initial ? fixed : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid={held ? 'restore-form' : 'takedown-form'}>
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="slug" value={slug} />
      {caseId ? <input type="hidden" name="caseId" value={caseId} /> : null}
      <TextAreaField
        form={formId}
        name="reason"
        label={held ? 'Reason for putting the record back' : 'Reason for taking the record down'}
        maxLength={500}
        hint={
          held
            ? 'Required. Kept in the audit log. The owner is told the record is back, and it returns to what the owner chose.'
            : 'Required. Kept in the audit log and sent to the owner, if the record has one. Write it for the owner to read, and never name a reporter. The record can be put back at any time.'
        }
        state={state}
      />
      <div>
        <Button pending={pending} label={held ? 'Restore record' : 'Take record down'} pendingLabel={held ? 'Restoring…' : 'Taking down…'} variant={held ? 'secondary' : 'danger'} />
      </div>
    </form>
  );
}
