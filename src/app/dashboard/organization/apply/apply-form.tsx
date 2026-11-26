'use client';

// The application of /dashboard/organization/apply (milestone M15): posts to a thin Server Action
// (../actions.ts) and works without JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../../teachers/historical/actions';
import { applyOrganizationAction } from '../actions';
import { APPLY_FORM } from '../form-ids';
import { type Country, LABELS, type Option, OrganizationFields } from '../organization-fields';

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

/** The application of /dashboard/organization/apply. */
export function ApplyForm({ idempotencyKey, initial, countries, kinds }: { idempotencyKey: string; initial?: FormState | null; countries: readonly Country[]; kinds: readonly Option[] }) {
  const [state, action, pending] = useActionState(applyOrganizationAction, initial ?? IDLE);
  const generatedId = useFormId(APPLY_FORM);
  const formId = initial ? APPLY_FORM : generatedId;
  useFocusOnError(formId, state);
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="organization-apply-form">
      <FormMessage form={formId} state={state} labels={LABELS} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <OrganizationFields formId={formId} state={state} defaults={null} countries={countries} kinds={kinds} locked={false} />
      <div className="grid gap-2">
        <p className="text-sm font-semibold">
          {LABELS.evidenceIds} <span className="font-normal text-fg-muted">(optional)</span>
        </p>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          A registration, a charter or another document that shows the organization exists. Only you, the reviewers and the administrators can open it; it is never public.
        </p>
        <EvidenceUploader
          label="Add files"
          hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files."
          initial={files}
          discard={discardEvidenceAction}
          inputId={fieldId(formId, 'evidenceIds')}
          error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
        />
      </div>
      <TextAreaField form={formId} name="note" label={LABELS.note} optional maxLength={2000} hint="Anything that helps the reviewers. Never public." state={state} className="max-w-[40rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the application
        </SubmitButton>
      </div>
    </form>
  );
}

