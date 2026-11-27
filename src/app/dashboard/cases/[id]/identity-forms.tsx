'use client';

// The proof forms of an impersonation report on /dashboard/cases/<id> (ADR 0089): ask someone to
// vouch, ask for an own-channel code, type a mailed code back. Plain forms posted to thin Server
// Actions over identity.askVouch, identity.addCode and identity.confirmCode. Work without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { addCodeAction, askVouchAction, confirmCodeAction } from './actions';
import { CODE_ADD_FORM, CODE_CONFIRM_FORM, VOUCH_ASK_FORM } from './form-ids';

const radioClass =
  'peer mt-0.5 size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-surface-1 checked:border-[7px] checked:border-fg hover:border-fg-muted';

function Choice({ formId, name, options, state, legend }: { formId: string; name: string; options: { value: string; label: string; hint: string }[]; state: FormState; legend: string }) {
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const chosen = state.values?.[name] ?? options[0]?.value;
  return (
    <fieldset className="grid gap-2" aria-describedby={error ? `${fieldId(formId, name)}-error` : undefined}>
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {error ? (
        <p id={`${fieldId(formId, name)}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {options.map((o, i) => (
        <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border-subtle px-3 py-2.5 text-ui has-checked:border-fg">
          <input id={i === 0 ? fieldId(formId, name) : undefined} type="radio" name={name} value={o.value} defaultChecked={chosen === o.value} className={radioClass} />
          <span className="grid min-w-0 gap-0.5">
            <span className="font-semibold">{o.label}</span>
            <span className="text-sm text-fg-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function AskVouchForm({ caseId, noteMax, initial }: { caseId: string; noteMax: number; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(askVouchAction, initial ?? IDLE);
  const generatedId = useFormId(VOUCH_ASK_FORM);
  const formId = initial ? VOUCH_ASK_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="identity-vouch-form">
      <FormMessage form={formId} state={state} labels={{ slug: 'Their profile address', kind: 'They are', message: 'Your message to them' }} />
      <input type="hidden" name="caseId" value={caseId} />
      <TextField
        form={formId}
        name="slug"
        label="Their profile address"
        autoComplete="off"
        hint="The address of their WingChunRoots profile, for example /people/demo-name."
        state={state}
        className="max-w-[34rem]"
      />
      <Choice
        formId={formId}
        name="kind"
        legend="They are"
        state={state}
        options={[
          { value: 'teacher', label: 'My verified teacher, or a verified instructor', hint: 'One is enough.' },
          { value: 'peer', label: 'A member whose training is verified', hint: 'Two are needed, from different schools.' },
        ]}
      />
      <TextAreaField
        form={formId}
        name="message"
        label="Your message to them"
        optional
        maxLength={noteMax}
        hint="They read it with the question: say who you are and how they know you."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Asking…" variant="secondary">
          Ask them to vouch
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddCodeForm({ caseId, targetMax, initial }: { caseId: string; targetMax: number; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(addCodeAction, initial ?? IDLE);
  const generatedId = useFormId(CODE_ADD_FORM);
  const formId = initial ? CODE_ADD_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="identity-code-form">
      <FormMessage form={formId} state={state} labels={{ channel: 'Where', target: 'Address' }} />
      <input type="hidden" name="caseId" value={caseId} />
      <Choice
        formId={formId}
        name="channel"
        legend="Where"
        state={state}
        options={[
          { value: 'email', label: 'An e-mail address at my school’s own domain', hint: 'We send a six-digit code there; you type it back here. We keep only the domain.' },
          { value: 'page', label: 'My school’s website or official social page', hint: 'We show you a code to post there; an administrator looks for it on the page.' },
        ]}
      />
      <TextField
        form={formId}
        name="target"
        label="Address"
        autoComplete="off"
        maxLength={targetMax}
        hint="The e-mail address, or the full address of the page (https://…)."
        state={state}
        className="max-w-[34rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…" variant="secondary">
          Get a code
        </SubmitButton>
      </div>
    </form>
  );
}

export function ConfirmCodeForm({ caseId, codeId, initial }: { caseId: string; codeId: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(confirmCodeAction, initial ?? IDLE);
  const generatedId = useFormId(`${CODE_CONFIRM_FORM}-${codeId}`);
  const formId = initial ? CODE_CONFIRM_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="flex flex-wrap items-end gap-3" data-testid="identity-confirm-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="codeId" value={codeId} />
      <TextField form={formId} name="code" label="The code from the e-mail" autoComplete="one-time-code" inputMode="numeric" maxLength={6} state={state} className="w-48" />
      <SubmitButton pending={pending} pendingLabel="Checking…" variant="secondary">
        Confirm the code
      </SubmitButton>
    </form>
  );
}
