'use client';

// The account type form of /dashboard/settings (milestone M08, In scope 2): Student or Sifu, two
// radio cards and one button. Nothing is chosen for the visitor: the current type is the one
// selected. Works without JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { IDLE, fieldId, type FormState } from '@/lib/form-state';
import { setAccountTypeAction } from './actions';

const OPTIONS = [
  {
    value: 'student',
    title: 'Student',
    text: 'You train with one or more teachers. Plan: Free Student.',
  },
  {
    value: 'sifu',
    title: 'Sifu',
    text: 'You teach. Plan: Free Sifu, with up to 5 approved students. Shown as “Instructor (unverified)” until an archivist checks your instructor status.',
  },
] as const;

export function AccountTypeForm({ current, initial }: { current: 'student' | 'sifu'; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(setAccountTypeAction, initial ?? IDLE);
  const formId = useFormId('account-type');
  useFocusOnError(formId, state);
  const chosen = state.values?.accountType ?? current;
  const error = state.status === 'error' ? state.fields?.accountType : undefined;
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={formId} state={state} single />
      <fieldset aria-describedby={error ? `${fieldId(formId, 'accountType')}-error` : undefined} className="grid gap-3">
        <legend className="mb-3 text-sm font-semibold">Account type</legend>
        {error ? (
          <p id={`${fieldId(formId, 'accountType')}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cx(
                'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-sm border border-border-strong bg-surface-1 p-4',
                'transition-colors duration-(--duration-fast) hover:border-fg-muted has-[:checked]:border-fg has-[:checked]:bg-surface-2',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              )}
            >
              <input
                type="radio"
                name="accountType"
                value={option.value}
                id={option.value === 'student' ? fieldId(formId, 'accountType') : undefined}
                defaultChecked={chosen === option.value}
                className="mt-1 size-5 shrink-0 cursor-pointer accent-fg focus-visible:outline-none"
              />
              <span className="grid gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2 font-display text-xl">
                  {option.title}
                  {current === option.value ? <span className="font-sans text-label font-semibold text-fg-muted">Current</span> : null}
                </span>
                <span className="text-sm text-fg-muted">{option.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save account type
        </SubmitButton>
      </div>
    </form>
  );
}
