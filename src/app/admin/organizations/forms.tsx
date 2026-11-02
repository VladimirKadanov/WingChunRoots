'use client';

// The forms of /admin/organizations/<id> (milestone M15): give an approved organization a test or
// complimentary Federation plan (a reason, a start and an end), and revoke a grant with a reason.
// Thin Server Actions over organizations.grant and organizations.revokeGrant; they work without
// JavaScript (src/server/forms/flash.ts). DEFAULT D09: the price is not final and nothing is charged.

import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { type FormState, IDLE } from '@/lib/form-state';
import { grantOrganizationPlanAction, revokeOrganizationPlanAction } from './actions';
import { GRANT_FORM, revokeForm } from './form-ids';

const LABELS = { source: 'Kind', reason: 'Reason', startsOn: 'Starts', endsOn: 'Ends' };

export function GrantForm({ organizationId, initial }: { organizationId: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(grantOrganizationPlanAction, initial ?? IDLE);
  const generatedId = useFormId(GRANT_FORM);
  const formId = initial ? GRANT_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="organization-grant-form">
      <FormMessage form={formId} state={state} labels={LABELS} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <SelectField form={formId} name="source" label={LABELS.source} state={state} autoComplete="off" defaultValue={state.values?.source ?? 'test_grant'} className="max-w-[20rem]">
        <option value="test_grant">Test plan</option>
        <option value="complimentary">Complimentary</option>
      </SelectField>
      <TextField form={formId} name="reason" label={LABELS.reason} state={state} autoComplete="off" maxLength={500} hint="Kept in the audit log." className="max-w-[40rem]" />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField form={formId} name="startsOn" type="date" label={LABELS.startsOn} state={state} optional autoComplete="off" hint="Today when empty." />
        <TextField form={formId} name="endsOn" type="date" label={LABELS.endsOn} state={state} optional autoComplete="off" hint="No end when empty." />
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Giving…">
          Give Federation
        </SubmitButton>
      </div>
    </form>
  );
}

export function RevokeForm({ organizationId, grantId, initial }: { organizationId: string; grantId: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(revokeOrganizationPlanAction, initial ?? IDLE);
  const formId = revokeForm(grantId);
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="organization-revoke-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="grantId" value={grantId} />
      <TextField form={formId} name="reason" label="Reason to revoke" state={state} autoComplete="off" maxLength={500} hint="Members, school links and the public page stay; only member and school administration closes." className="max-w-[40rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Revoking…" variant="danger">
          Revoke
        </SubmitButton>
      </div>
    </form>
  );
}
