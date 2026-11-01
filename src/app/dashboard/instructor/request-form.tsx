'use client';

// The instructor verification form of /dashboard/instructor (milestone M10b, In scope 3): the
// evidence (the M10a field: at least one file) and a note for the reviewers, posted to a thin
// Server Action over instructor.request with an idempotency key the page made for it.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../teachers/historical/actions';
import { requestInstructorAction } from './actions';
import { INSTRUCTOR_FORM } from './form-ids';

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function InstructorRequestForm({ idempotencyKey, initial }: { idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(requestInstructorAction, initial ?? IDLE);
  const generatedId = useFormId(INSTRUCTOR_FORM);
  const formId = initial ? INSTRUCTOR_FORM : generatedId;
  useFocusOnError(formId, state);
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="instructor-form">
      <FormMessage form={formId} state={state} labels={{ evidenceIds: 'Evidence', note: 'Note for the reviewers' }} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <p className="max-w-[60ch] text-sm text-fg-muted">
        An instructor certificate, a letter from your own teacher, a page of your school’s register. Only you, the reviewers and the administrators can
        open these files; they are never public. Location data and other metadata are removed from photographs.
      </p>
      <EvidenceUploader
        label="Add files"
        hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files."
        initial={files}
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <TextAreaField
        form={formId}
        name="note"
        label="Note for the reviewers"
        optional
        maxLength={2000}
        hint="Where you teach and what the evidence shows. Never public."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send for verification
        </SubmitButton>
      </div>
    </form>
  );
}
