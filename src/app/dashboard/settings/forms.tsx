'use client';

// The account type form of /dashboard/settings (milestone M08, In scope 2): Student or Sifu, two
// radio cards and one button. Nothing is chosen for the visitor: the current type is the one
// selected. Works without JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { IDLE, fieldId, type FormState } from '@/lib/form-state';
import { setAccountTypeAction } from './actions';

/**
 * The two options. The Sifu text follows the instructor status of the account's own person
 * (review round 2, recheck-9): a Sifu an archivist has verified is not told they show as unverified.
 */
function options(instructorVerified: boolean) {
  return [
    {
      value: 'student',
      title: 'Student',
      text: 'You train with one or more teachers. Plan: Free Student.',
    },
    {
      value: 'sifu',
      title: 'Sifu',
      text: instructorVerified
        ? 'You teach. Plan: Free Sifu, with up to 5 approved students. Shown as “Instructor”: an archivist has checked your instructor status.'
        : 'You teach. Plan: Free Sifu, with up to 5 approved students. Shown as “Instructor (unverified)” until an archivist checks your instructor status.',
    },
  ] as const;
}

export function AccountTypeForm({
  current,
  instructorVerified = false,
  initial,
}: {
  current: 'student' | 'sifu';
  /** Whether an archivist has verified the account's person as an instructor (only a Sifu shows it). */
  instructorVerified?: boolean;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(setAccountTypeAction, initial ?? IDLE);
  const formId = useFormId('account-type');
  useFocusOnError(formId, state);
  const chosen = state.values?.accountType ?? current;
  const error = state.status === 'error' ? state.fields?.accountType : undefined;
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={formId} state={state} single />
      <fieldset aria-describedby={error ? `${fieldId(formId, 'accountType')}-error` : undefined} className="grid gap-3">
        {/* The section's heading already says "Account type" on screen (review round 1, design-13). */}
        <legend className="sr-only">Account type</legend>
        {error ? (
          <p id={`${fieldId(formId, 'accountType')}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {options(instructorVerified).map((option, index) => (
            <label
              key={option.value}
              className={cx(
                'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-sm border border-border-strong bg-surface-1 p-4',
                'transition-colors duration-(--duration-fast) hover:border-fg-muted has-[:checked]:border-fg has-[:checked]:bg-surface-2',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                // Forced colours (Windows High Contrast) paint both borders in CanvasText: the chosen
                // card gets a heavier one, its padding one pixel less so nothing moves (recheck-3).
                'forced-colors:has-[:checked]:border-2 forced-colors:has-[:checked]:p-[15px]',
              )}
            >
              <input
                type="radio"
                name="accountType"
                value={option.value}
                id={option.value === 'student' ? fieldId(formId, 'accountType') : undefined}
                defaultChecked={chosen === option.value}
                // Without JavaScript a refused choice comes back with the focus on the first option
                // (review round 1, a11y-webview-1); with it, useFocusOnError() does the same.
                autoFocus={error ? index === 0 : undefined}
                // Drawn in ink (design-13): a 1.5px ring, and a dot when chosen; the native disc
                // renders as a filled grey circle in the dark theme. In forced colours the dot's
                // background would be replaced by Canvas, so the system draws its own radio there
                // (review round 2, recheck-3).
                className={cx(
                  'mt-1 grid size-5 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border-[1.5px] border-fg bg-surface-1 focus-visible:outline-none',
                  'before:size-2.5 before:scale-0 before:rounded-full before:bg-fg before:transition-transform before:duration-(--duration-fast) checked:before:scale-100',
                  'forced-colors:appearance-auto forced-colors:before:hidden',
                )}
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
