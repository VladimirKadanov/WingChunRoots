'use client';

// "This account is pretending to be me" (ADR 0088): for an impostor report the proof route
// (vouching, own channel, private video), and the reporter's reason, posted to a thin Server Action
// over identity.report with an idempotency key the page made for it. Works without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { reportIdentityAction } from './actions';
import { IDENTITY_REPORT_FORM } from './form-ids';

const radioClass =
  'peer mt-0.5 size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-surface-1 checked:border-[7px] checked:border-fg hover:border-fg-muted';

export function IdentityReportForm({
  personId,
  slug,
  routes,
  detailsMax,
  idempotencyKey,
  initial,
}: {
  personId: string;
  slug: string;
  routes: { value: string; label: string; hint: string }[];
  detailsMax: number;
  idempotencyKey: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(reportIdentityAction, initial ?? IDLE);
  const generatedId = useFormId(IDENTITY_REPORT_FORM);
  const formId = initial ? IDENTITY_REPORT_FORM : generatedId;
  useFocusOnError(formId, state);
  const routeError = state.status === 'error' ? state.fields?.route : undefined;
  const chosen = state.values?.route;
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="identity-report-form">
      <FormMessage form={formId} state={state} labels={{ route: 'How you will show it', details: 'Why this profile is yours' }} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {routes.length > 0 ? (
        <fieldset className="grid gap-2" aria-describedby={routeError ? `${fieldId(formId, 'route')}-error` : undefined}>
          <legend className="mb-1 text-sm font-semibold">How you will show it</legend>
          {routeError ? (
            <p id={`${fieldId(formId, 'route')}-error`} className="text-sm text-danger">
              {routeError}
            </p>
          ) : null}
          {routes.map((r, i) => (
            <label key={r.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border-subtle px-3 py-2.5 text-ui has-checked:border-fg">
              <input
                id={i === 0 ? fieldId(formId, 'route') : undefined}
                type="radio"
                name="route"
                value={r.value}
                defaultChecked={chosen === r.value}
                className={radioClass}
                data-testid={`identity-route-${r.value}`}
              />
              <span className="grid min-w-0 gap-0.5">
                <span className="font-semibold">{r.label}</span>
                <span className="text-sm text-fg-muted">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <TextAreaField
        form={formId}
        name="details"
        label="Why this profile is yours"
        maxLength={detailsMax}
        hint="Who you are, where you train or teach, and what on the profile is yours. The moderators and administrators read it; the account that holds the profile never does."
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
