'use client';

// "Propose a correction" of a shared archival record (milestone M25, In scope 3): the record's
// editable fields as they should be, the reason and, for a change of the life status, at least one
// file of evidence (DEFAULT M25 question 7). Posted to a thin Server Action over records.propose.

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '@/app/dashboard/teachers/historical/actions';
import { proposeRecordAction } from './actions';
import { PROPOSE_FORM } from './form-ids';

export interface ProposeRecord {
  personId: string;
  slug: string;
  primaryName: string;
  originalName: string | null;
  originalLang: string | null;
  lifeStatus: 'living' | 'deceased' | 'unknown';
  bio: string | null;
  scripts: { lang: string; label: string }[];
}

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function ProposeForm({ record, idempotencyKey, initial }: { record: ProposeRecord; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(proposeRecordAction, initial ?? IDLE);
  const generatedId = useFormId(PROPOSE_FORM);
  const formId = initial ? PROPOSE_FORM : generatedId;
  useFocusOnError(formId, state);
  const start = initial?.values;
  const [lifeStatus, setLifeStatus] = useState(start?.lifeStatus ?? record.lifeStatus);
  const [originalLang, setOriginalLang] = useState(start?.originalLang ?? record.originalLang ?? '');
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  const labels = { primaryName: 'Name in Latin letters', originalName: 'Name in its own script', originalLang: 'Script', lifeStatus: 'Life status', bio: 'Biography', reason: 'Reason', evidenceIds: 'Evidence' };
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="propose-form">
      <FormMessage form={formId} state={state} labels={labels} />
      <input type="hidden" name="personId" value={record.personId} />
      <input type="hidden" name="slug" value={record.slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextField form={formId} name="primaryName" label={labels.primaryName} autoComplete="off" maxLength={120} defaultValue={record.primaryName} state={state} className="max-w-[34rem]" />
      <div className="grid gap-3 sm:max-w-[34rem]">
        <TextField form={formId} name="originalName" label={labels.originalName} optional autoComplete="off" maxLength={120} defaultValue={record.originalName ?? undefined} state={state} />
        <SelectField form={formId} name="originalLang" label="Script of that name" optional autoComplete="off" state={state} value={originalLang} onValue={setOriginalLang}>
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
        hint="A change of the life status needs at least one file of evidence."
        value={lifeStatus}
        onValue={(value) => setLifeStatus(value as typeof lifeStatus)}
      >
        <option value="unknown">Not known</option>
        <option value="deceased">Deceased</option>
        <option value="living">Living</option>
      </SelectField>
      <TextAreaField form={formId} name="bio" label="Biography (English)" optional maxLength={1000} rows={5} lang="en" defaultValue={record.bio ?? undefined} state={state} className="max-w-[40rem]" />
      <TextAreaField
        form={formId}
        name="reason"
        label={labels.reason}
        maxLength={2000}
        hint="Why the record should change and on what basis. The archivists read it; it is never public."
        state={state}
        className="max-w-[40rem]"
      />
      <EvidenceUploader
        label="Add evidence"
        hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files. The files are never public."
        initial={files}
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the proposal
        </SubmitButton>
      </div>
    </form>
  );
}
