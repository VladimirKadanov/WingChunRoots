'use client';

// The answer on /dashboard/vouches/<id> (ADR 0089): a
// plain form posted to a thin Server Action over identityVouches.answer. Works without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { answerVouchAction } from './actions';
import { VOUCH_FORM } from './form-ids';

const radioClass =
  'peer size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-surface-1 checked:border-[7px] checked:border-fg hover:border-fg-muted';

export function AnswerForm({
  id,
  answers,
  noteMax,
  initial,
}: {
  id: string;
  answers: { value: string; label: string }[];
  noteMax: number;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(answerVouchAction, initial ?? IDLE);
  const generatedId = useFormId(VOUCH_FORM);
  const formId = initial ? VOUCH_FORM : generatedId;
  useFocusOnError(formId, state);
  const answerError = state.status === 'error' ? state.fields?.answer : undefined;
  const chosen = state.values?.answer;
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="vouch-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="id" value={id} />
      <fieldset className="grid gap-2" aria-describedby={answerError ? `${fieldId(formId, 'answer')}-error` : undefined}>
        <legend className="mb-1 text-sm font-semibold">Your answer</legend>
        {answerError ? (
          <p id={`${fieldId(formId, 'answer')}-error`} className="text-sm text-danger">
            {answerError}
          </p>
        ) : null}
        {answers.map((a, i) => (
          <label key={a.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border-subtle px-3 py-2.5 text-ui has-checked:border-fg">
            <input
              id={i === 0 ? fieldId(formId, 'answer') : undefined}
              type="radio"
              name="answer"
              value={a.value}
              defaultChecked={chosen === a.value}
              className={radioClass}
              data-testid={`vouch-answer-${a.value}`}
            />
            <span className="min-w-0">{a.label}</span>
          </label>
        ))}
      </fieldset>
      <TextAreaField
        form={formId}
        name="note"
        label="Anything the administrators should know"
        optional
        maxLength={noteMax}
        hint="Only the administrators read it. For example, how you know this person."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…" variant="primary">
          Send the answer
        </SubmitButton>
      </div>
    </form>
  );
}
