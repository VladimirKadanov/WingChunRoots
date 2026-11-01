'use client';

// "Report profile" (milestone M10b, In scope 4): the reason (copyright, spam, inappropriate,
// misleading) and optional details, posted to a thin Server Action over reports.create with an
// idempotency key the page made for it.

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { type FormState, IDLE } from '@/lib/form-state';
import { reportProfileAction } from './actions';
import { REPORT_FORM } from './form-ids';

export function ReportForm({
  personId,
  slug,
  reasons,
  idempotencyKey,
  initial,
}: {
  personId: string;
  slug: string;
  reasons: { value: string; label: string }[];
  idempotencyKey: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(reportProfileAction, initial ?? IDLE);
  const generatedId = useFormId(REPORT_FORM);
  const formId = initial ? REPORT_FORM : generatedId;
  useFocusOnError(formId, state);
  // Controlled: React resets the form after its action (finding H2 of M02).
  const [reason, setReason] = useState(initial?.values?.reason ?? '');
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="report-form">
      <FormMessage form={formId} state={state} labels={{ reason: 'Reason', details: 'Details' }} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <SelectField form={formId} name="reason" label="Reason" autoComplete="off" state={state} value={reason} onValue={setReason} className="max-w-[34rem]">
        <option value="">Choose a reason</option>
        {reasons.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        form={formId}
        name="details"
        label="Details"
        optional
        maxLength={2000}
        hint="What is wrong and where. The moderators read it; it is never public, and the person is not told who reported."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the report
        </SubmitButton>
      </div>
    </form>
  );
}
