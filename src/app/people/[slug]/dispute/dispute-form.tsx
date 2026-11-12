'use client';

// "Report a lineage error" (milestone M25, In scope 2; specification §16.1): the relationship, what
// is wrong with it, the details and at least one file of evidence, posted to a thin Server Action
// over disputes.report with an idempotency key the page made for it.

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '@/app/dashboard/teachers/historical/actions';
import { reportLineageAction } from './actions';
import { DISPUTE_FORM } from './form-ids';

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function DisputeForm({
  slug,
  relationships,
  grounds,
  idempotencyKey,
  initial,
}: {
  slug: string;
  relationships: { value: string; label: string }[];
  grounds: { value: string; label: string }[];
  idempotencyKey: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(reportLineageAction, initial ?? IDLE);
  const generatedId = useFormId(DISPUTE_FORM);
  const formId = initial ? DISPUTE_FORM : generatedId;
  useFocusOnError(formId, state);
  const [relationship, setRelationship] = useState(initial?.values?.relationshipId ?? (relationships.length === 1 ? relationships[0]!.value : ''));
  const [ground, setGround] = useState(initial?.values?.grounds ?? '');
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="dispute-form">
      <FormMessage form={formId} state={state} labels={{ relationshipId: 'Relationship', grounds: 'What is wrong', details: 'Details', evidenceIds: 'Evidence' }} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <SelectField form={formId} name="relationshipId" label="Relationship" autoComplete="off" state={state} value={relationship} onValue={setRelationship} className="max-w-[34rem]">
        <option value="">Choose a relationship</option>
        {relationships.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </SelectField>
      <SelectField form={formId} name="grounds" label="What is wrong" autoComplete="off" state={state} value={ground} onValue={setGround} className="max-w-[34rem]">
        <option value="">Choose one</option>
        {grounds.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        form={formId}
        name="details"
        label="Details"
        maxLength={2000}
        hint="What is wrong and what your evidence shows. Only the moderators read it; it is never public, and the people involved are not told who reported."
        state={state}
        className="max-w-[40rem]"
      />
      <EvidenceUploader
        label="Add evidence"
        hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files. At least one file is needed. The files are never public."
        initial={files}
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the report
        </SubmitButton>
      </div>
    </form>
  );
}
