'use client';

// The forms of /admin/grants (milestone M08, In scope 3): give a test plan (account, plan, kind,
// reason, start, end) and revoke one (with a reason). Both post to thin Server Actions over
// grants.create and grants.revoke, and work without JavaScript (src/server/forms/flash.ts).

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { IDLE, type FormState } from '@/lib/form-state';
import { createGrantAction, revokeGrantAction } from './actions';

const LABELS = {
  email: 'Account e-mail',
  planCode: 'Plan',
  source: 'Kind',
  reason: 'Reason',
  startsOn: 'Starts',
  endsOn: 'Ends',
};

export function CreateGrantForm({
  plans,
  prefill,
  today,
  initial,
}: {
  plans: readonly { code: string; name: string; audience: string }[];
  prefill: { email: string; planCode: string; requestId: string } | null;
  today: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(createGrantAction, initial ?? IDLE);
  const formId = useFormId('create-grant');
  useFocusOnError(formId, state);
  const values = state.status === 'done' ? {} : (state.values ?? {});
  const [planCode, setPlanCode] = useState(values.planCode ?? prefill?.planCode ?? plans[0]?.code ?? '');
  const [source, setSource] = useState(values.source ?? 'test_grant');
  const requestId = values.requestId ?? prefill?.requestId ?? '';
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={formId} state={state} labels={LABELS} />
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      <TextField
        form={formId}
        name="email"
        type="email"
        label={LABELS.email}
        autoComplete="off"
        inputMode="email"
        spellCheck={false}
        autoCapitalize="none"
        translate="no"
        maxLength={320}
        defaultValue={prefill?.email}
        hint="The address the account signs in with."
        state={state}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField form={formId} name="planCode" label={LABELS.planCode} autoComplete="off" value={planCode} onValue={setPlanCode} state={state}>
          {plans.map((plan) => (
            <option key={plan.code} value={plan.code}>
              {plan.name} ({plan.audience === 'sifu' ? 'Sifu accounts' : 'Student accounts'})
            </option>
          ))}
        </SelectField>
        <SelectField form={formId} name="source" label={LABELS.source} autoComplete="off" value={source} onValue={setSource} state={state}>
          <option value="test_grant">Test plan</option>
          <option value="complimentary">Complimentary</option>
        </SelectField>
      </div>
      <TextField
        form={formId}
        name="reason"
        label={LABELS.reason}
        autoComplete="off"
        maxLength={500}
        hint="Kept in the audit log with the grant."
        state={state}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField form={formId} name="startsOn" type="date" label={LABELS.startsOn} autoComplete="off" defaultValue={today} hint="From 00:00 UTC that day." state={state} />
        <TextField
          form={formId}
          name="endsOn"
          type="date"
          label={LABELS.endsOn}
          optional
          autoComplete="off"
          hint="The plan stops at 00:00 UTC that day. Leave empty for no end date."
          state={state}
        />
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Giving the plan…">
          Give the plan
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Revoking a grant, behind a disclosure on its row: the reason, then the button. <details> opens
 * without JavaScript and by keyboard. The button names the plan and the account.
 */
export function RevokeGrantForm({ grantId, planName, email, initial }: { grantId: string; planName: string; email: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(revokeGrantAction, initial ?? IDLE);
  const formId = useFormId('revoke-grant');
  useFocusOnError(formId, state);
  const failed = state.status === 'error';
  return (
    <details open={failed || undefined} className="group">
      <summary
        className={cx(
          buttonVariants({ variant: 'danger', size: 'sm' }),
          'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
        )}
      >
        Revoke<span className="sr-only"> {planName} of {email}</span>
      </summary>
      <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="mt-3 grid gap-3">
        <FormMessage form={formId} state={state} single />
        <input type="hidden" name="grantId" value={grantId} />
        <TextField form={formId} name="reason" label="Reason for revoking" autoComplete="off" maxLength={500} state={state} />
        <p className="text-sm text-fg-muted">Confirmed links stay confirmed and public; only new approvals above the plan left wait.</p>
        <div>
          <button
            type="submit"
            aria-disabled={pending || undefined}
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
            className={buttonVariants({ variant: 'danger' })}
          >
            {pending ? 'Revoking…' : `Revoke ${planName}`}
            <span className="sr-only"> of {email}</span>
          </button>
        </div>
      </form>
    </details>
  );
}
