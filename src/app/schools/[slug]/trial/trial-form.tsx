'use client';

// The trial lesson request form of /schools/<slug>/trial (M21, docs/adr/0024-trial-lessons.md):
// preferred times and a message (both optional), and how the school may reach the sender: the
// account's e-mail address, or a phone number typed here. A plain notice above the button says what
// the school will see. A thin Server Action over trial.request (./actions.ts).

import { useActionState, useState } from 'react';

import { FormMessage, SubmitButton, TextField, useFocusOnError, useHydrated } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { requestTrialAction } from './actions';
import { TRIAL_REQUEST_FORM } from './form-ids';

const FORM = TRIAL_REQUEST_FORM;

const LABELS = {
  preferredTimes: 'Times that suit you',
  message: 'Message to the school',
  contactMethod: 'How the school may reach you',
  phone: 'Phone number',
};

const radioClass =
  'peer size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-surface-1 checked:border-[7px] checked:border-fg hover:border-fg-muted';

export function TrialForm({
  school,
  sender,
  limits,
  initial,
}: {
  school: { id: string; slug: string; name: string };
  sender: { name: string | null; email: string };
  limits: { message: number; preferred: number };
  initial: FormState | null;
}) {
  const [state, action, pending] = useActionState(requestTrialAction, initial ?? IDLE);
  useFocusOnError(FORM, state);
  const [method, setMethod] = useState(state.values?.contactMethod === 'phone' ? 'phone' : 'email');
  const hydrated = useHydrated();
  const methodError = state.status === 'error' ? state.fields?.contactMethod : undefined;
  return (
    <form id={FORM} action={action} className="grid gap-6" data-testid="trial-form" noValidate>
      <FormMessage form={FORM} state={state} labels={LABELS} />
      <input type="hidden" name="schoolId" value={school.id} />
      <input type="hidden" name="slug" value={school.slug} />
      <TextField
        form={FORM}
        name="preferredTimes"
        label={LABELS.preferredTimes}
        state={state}
        optional
        autoComplete="off"
        maxLength={limits.preferred}
        hint="For example: weekday evenings, or Saturday mornings."
      />
      <TextAreaField
        form={FORM}
        name="message"
        label={LABELS.message}
        state={state}
        optional
        maxLength={limits.message}
        rows={5}
        hint={`Up to ${limits.message} characters: your experience, questions about the classes.`}
      />
      <fieldset className="grid gap-2" aria-describedby={methodError ? `${fieldId(FORM, 'contactMethod')}-error` : undefined}>
        <legend className="mb-1 text-sm font-semibold">{LABELS.contactMethod}</legend>
        {methodError ? (
          <p id={`${fieldId(FORM, 'contactMethod')}-error`} className="text-sm text-danger">
            {methodError}
          </p>
        ) : null}
        {(
          [
            ['email', `By e-mail: ${sender.email}`],
            ['phone', 'By phone: a number you type below'],
          ] as const
        ).map(([value, label], i) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border-subtle px-3 py-2.5 text-ui has-checked:border-fg"
          >
            <input
              id={i === 0 ? fieldId(FORM, 'contactMethod') : undefined}
              type="radio"
              name="contactMethod"
              value={value}
              checked={method === value}
              onChange={() => setMethod(value)}
              className={radioClass}
              data-testid={`trial-contact-${value}`}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
          </label>
        ))}
      </fieldset>
      {/* Shown for "By phone" (and always without JavaScript: the server ignores it for e-mail). */}
      <div className={cx(hydrated && method !== 'phone' && 'hidden')} data-testid="trial-phone">
        <TextField
          form={FORM}
          name="phone"
          label={LABELS.phone}
          state={state}
          optional={!hydrated || method !== 'phone'}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          hint="With the country code, like +359 …"
        />
      </div>
      <div className="grid gap-3 rounded-sm bg-surface-2 p-4 text-sm" data-testid="trial-privacy-notice">
        <p>
          <strong className="font-semibold">What {school.name} will see:</strong> your profile name
          {sender.name ? ` (${sender.name})` : ''} and the contact you chose above, with the times and the message. Nothing else of your
          account.
        </p>
        <p className="text-fg-muted">The school answers on this site; you find the answer in your trial lesson requests and in your notifications.</p>
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the request
        </SubmitButton>
      </div>
    </form>
  );
}
