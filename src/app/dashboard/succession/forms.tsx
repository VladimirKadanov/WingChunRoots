'use client';

// The forms of /dashboard/succession (milestone M25, In scope 1): the owner's nomination of a
// verified student and its revocation, the nominee's answer, and an accepted successor's request
// with evidence. Each posts to a thin Server Action (./actions.ts); a refusal comes back as the
// form's message, also without JavaScript (src/server/forms/flash.ts).

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../teachers/historical/actions';
import { answerNominationAction, nominateSuccessorAction, requestSuccessionAction, revokeNominationAction } from './actions';
import { ANSWER_FORM, NOMINATE_FORM, REQUEST_FORM, REVOKE_FORM } from './form-ids';

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

function Button({ pending, label, pendingLabel, who, variant = 'secondary', name, value }: { pending: boolean; label: string; pendingLabel: string; who: string; variant?: 'secondary' | 'danger'; name?: string; value?: string }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cx(buttonVariants({ variant }), 'w-full sm:w-auto')}
    >
      {pending ? pendingLabel : label}
      <span className="sr-only"> ({who})</span>
    </button>
  );
}

export function NominateForm({ candidates, initial }: { candidates: { id: string; name: string }[]; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(nominateSuccessorAction, initial ?? IDLE);
  const generatedId = useFormId(NOMINATE_FORM);
  const formId = initial ? NOMINATE_FORM : generatedId;
  useFocusOnError(formId, state);
  const [chosen, setChosen] = useState(initial?.values?.successorPersonId ?? '');
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="nominate-form">
      <FormMessage form={formId} state={state} labels={{ successorPersonId: 'Successor' }} />
      <SelectField form={formId} name="successorPersonId" label="Successor" autoComplete="off" state={state} value={chosen} onValue={setChosen} className="max-w-[34rem]">
        <option value="">Choose a verified student</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <div>
        <SubmitButton pending={pending} pendingLabel="Nominating…">
          Nominate
        </SubmitButton>
      </div>
    </form>
  );
}

export function RevokeForm({ nominationId, who, initial }: { nominationId: string; who: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(revokeNominationAction, initial ?? IDLE);
  const generatedId = useFormId(REVOKE_FORM);
  const formId = initial ? REVOKE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-2" data-testid="revoke-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="nominationId" value={nominationId} />
      <div>
        <Button pending={pending} label="Revoke the nomination" pendingLabel="Revoking…" who={who} variant="danger" />
      </div>
    </form>
  );
}

export function AnswerForm({ nominationId, who, initial }: { nominationId: string; who: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(answerNominationAction, initial ?? IDLE);
  const generatedId = useFormId(ANSWER_FORM);
  const formId = initial ? ANSWER_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-2" data-testid="answer-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="nominationId" value={nominationId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button pending={pending} label="Accept" pendingLabel="Saving…" who={who} name="answer" value="accept" />
        <Button pending={pending} label="Decline" pendingLabel="Saving…" who={who} name="answer" value="decline" />
      </div>
    </form>
  );
}

export function SuccessionRequestForm({
  nominationId,
  inactivityOpen,
  inactivityDays,
  idempotencyKey,
  initial,
}: {
  nominationId: string;
  inactivityOpen: boolean;
  inactivityDays: number;
  idempotencyKey: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(requestSuccessionAction, initial ?? IDLE);
  const generatedId = useFormId(REQUEST_FORM);
  const formId = initial ? REQUEST_FORM : generatedId;
  useFocusOnError(formId, state);
  const [basis, setBasis] = useState(initial?.values?.basis ?? '');
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="succession-request-form">
      <FormMessage form={formId} state={state} labels={{ basis: 'The request rests on', note: 'What happened', evidenceIds: 'Evidence' }} />
      <input type="hidden" name="nominationId" value={nominationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <SelectField
        form={formId}
        name="basis"
        label="The request rests on"
        autoComplete="off"
        state={state}
        value={basis}
        onValue={setBasis}
        hint={
          inactivityOpen
            ? `A reported death, or more than ${inactivityDays} days without any activity on the owner’s account. Inactivity alone is never taken as a death.`
            : `The owner’s account was active within the last ${inactivityDays} days, so only a reported death can be the basis now.`
        }
        className="max-w-[34rem]"
      >
        <option value="">Choose one</option>
        <option value="reported_death">A reported death</option>
        {inactivityOpen ? <option value="inactivity">More than {inactivityDays} days of inactivity</option> : null}
      </SelectField>
      <TextAreaField
        form={formId}
        name="note"
        label="What happened"
        maxLength={2000}
        hint="What happened and what your evidence shows. Only you, the owner and the administrators read it."
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
          Send the request
        </SubmitButton>
      </div>
    </form>
  );
}
