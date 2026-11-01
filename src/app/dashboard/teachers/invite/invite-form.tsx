'use client';

// The forms of /dashboard/teachers/invite (milestone M10b, In scope 1): "Invite your teacher"
// lists a living teacher who is not on WingChunRoots yet (the name in Latin letters, optionally in
// its own script, the lineage, when the training was, optional evidence for the reviewers of the
// teacher's claim, and optionally the teacher's e-mail address for the invitation); "Send the
// invitation" sends it later, or again, for a request that waits. Plain forms posted to thin Server
// Actions, each with an idempotency key the page made for it.

import { useActionState, useState } from 'react';

import { CheckboxField, FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../historical/actions';
import { inviteTeacherAction, sendInvitationAction } from './actions';
import { INVITE_FORM, SEND_INVITATION_FORM } from './form-ids';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3 sm:max-w-[30rem]';

export interface InviteFormOptions {
  lineages: { id: string; name: string }[];
  scripts: { lang: string; label: string }[];
}

function MonthOptions() {
  return (
    <>
      <option value="">Not sure</option>
      {MONTHS.map((month, index) => (
        <option key={month} value={String(index + 1)}>
          {month}
        </option>
      ))}
    </>
  );
}

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function InviteForm({ options, idempotencyKey, initial }: { options: InviteFormOptions; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(inviteTeacherAction, initial ?? IDLE);
  const generatedId = useFormId(INVITE_FORM);
  const formId = initial ? INVITE_FORM : generatedId;
  useFocusOnError(formId, state);
  // Controlled selects: React resets the form after its action (finding H2 of M02).
  const start = initial?.values ?? {};
  const [selects, setSelects] = useState<Record<string, string>>({
    lineageId: start.lineageId ?? '',
    originalLang: start.originalLang ?? '',
    fromMonth: start.fromMonth ?? '',
    toMonth: start.toMonth ?? '',
  });
  const select = (name: string) => ({ value: selects[name] ?? '', onValue: (value: string) => setSelects((current) => ({ ...current, [name]: value })) });
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  const labels: Record<string, string> = {
    teacherName: 'Teacher’s name',
    originalName: 'Name in its own script',
    originalLang: 'Script',
    lineageId: 'Lineage',
    fromYear: 'Started',
    toYear: 'Ended',
    email: 'Teacher’s e-mail address',
    evidenceIds: 'Evidence',
  };

  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-8" data-testid="invite-form">
      <FormMessage form={formId} state={state} labels={labels} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <section aria-labelledby={`${formId}-teacher`} className="grid gap-4">
        <h2 id={`${formId}-teacher`} className="font-display text-2xl">
          Your teacher
        </h2>
        <TextField
          form={formId}
          name="teacherName"
          label="Teacher’s name in Latin letters"
          autoComplete="off"
          maxLength={120}
          hint="As it is usually written in Latin letters. Add the name in its own script below."
          state={state}
          className="max-w-[34rem]"
        />
        <div className="grid gap-3 sm:max-w-[34rem]">
          <TextField form={formId} name="originalName" label="Name in its own script" optional autoComplete="off" maxLength={120} state={state} />
          <SelectField form={formId} name="originalLang" label="Script of that name" optional autoComplete="off" state={state} {...select('originalLang')}>
            <option value="">Choose a script</option>
            {options.scripts.map((script) => (
              <option key={script.lang} value={script.lang}>
                {script.label}
              </option>
            ))}
          </SelectField>
        </div>
        <SelectField form={formId} name="lineageId" label="Lineage of this training" autoComplete="off" state={state} className="max-w-[34rem]" {...select('lineageId')}>
          <option value="">Choose a lineage</option>
          {options.lineages.map((lineage) => (
            <option key={lineage.id} value={lineage.id}>
              {lineage.name}
            </option>
          ))}
        </SelectField>
      </section>

      <section aria-labelledby={`${formId}-when`} className="grid gap-4">
        <h2 id={`${formId}-when`} className="font-display text-2xl">
          When you trained
        </h2>
        <div className={ROW}>
          <TextField form={formId} name="fromYear" label="Started (year)" autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
          <SelectField form={formId} name="fromMonth" label="Month" optional autoComplete="off" state={state} {...select('fromMonth')}>
            <MonthOptions />
          </SelectField>
        </div>
        <CheckboxField form={formId} name="ongoing" label="I still train with this teacher" state={state} />
        <div className={ROW}>
          <TextField form={formId} name="toYear" label="Ended (year)" optional autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
          <SelectField form={formId} name="toMonth" label="Month" optional autoComplete="off" state={state} {...select('toMonth')}>
            <MonthOptions />
          </SelectField>
        </div>
      </section>

      <section aria-labelledby={`${formId}-invitation`} className="grid gap-4">
        <h2 id={`${formId}-invitation`} className="font-display text-2xl">
          Invitation
        </h2>
        <TextField
          form={formId}
          name="email"
          type="email"
          label="Teacher’s e-mail address"
          optional
          autoComplete="off"
          inputMode="email"
          maxLength={320}
          hint="We send one e-mail with a link to claim the profile. The link works for 14 days and only once. The address is used for nothing else and is deleted 30 days after the invitation ends. You can send the invitation later."
          state={state}
          className="max-w-[34rem]"
        />
      </section>

      <section aria-labelledby={`${formId}-evidence`} className="grid gap-4">
        <h2 id={`${formId}-evidence`} className="font-display text-2xl">
          Evidence (optional)
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          A certificate, a letter, a photograph of you training together. Your teacher can open these files only once their claim to the profile is
          approved, when they answer your request; the administrators can open them too. They are never public.
        </p>
        <EvidenceUploader
          label="Add files"
          hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files."
          initial={files}
          discard={discardEvidenceAction}
          inputId={fieldId(formId, 'evidenceIds')}
          error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
        />
      </section>

      <div className="grid gap-3">
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Nothing becomes public. Until your teacher claims the profile, a reviewer approves the claim and your teacher approves your request, only you,
          your teacher and the reviewers see it.
        </p>
        <div>
          <SubmitButton pending={pending} pendingLabel="Saving…">
            Invite your teacher
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function SendInvitationForm({ relationshipId, idempotencyKey, again, initial }: { relationshipId: string; idempotencyKey: string; again: boolean; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(sendInvitationAction, initial ?? IDLE);
  const generatedId = useFormId(SEND_INVITATION_FORM);
  const formId = initial ? SEND_INVITATION_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="send-invitation-form">
      <FormMessage form={formId} state={state} labels={{ email: 'Teacher’s e-mail address' }} />
      <input type="hidden" name="relationshipId" value={relationshipId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextField
        form={formId}
        name="email"
        type="email"
        label="Teacher’s e-mail address"
        autoComplete="off"
        inputMode="email"
        maxLength={320}
        hint={
          again
            ? 'A new link is sent; the earlier link stops working. The link works for 14 days and only once.'
            : 'We send one e-mail with a link to claim the profile. The link works for 14 days and only once.'
        }
        state={state}
        className="max-w-[34rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          {again ? 'Send a new invitation' : 'Send the invitation'}
        </SubmitButton>
      </div>
    </form>
  );
}
