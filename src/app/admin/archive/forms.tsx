'use client';

// The forms of the archive editor (milestone M26, docs/adr/0034-archive-editor.md): a new lineage, a
// lineage's name, description and root, a new historical record, a new link and ending a link. Each
// posts to one thin Server Action over one procedure (./actions.ts) and works without JavaScript (the
// browser posts the form and a refusal comes back opened at the form's message:
// src/server/forms/flash.ts). The button is aria-disabled while the action runs, so a double click
// sends one request; a link also carries an idempotency key the page made for it.

import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../../dashboard/teachers/historical/actions';
import { addLinkAction, createLineageAction, createRecordAction, endLinkAction, updateLineageAction } from './actions';
import { LINEAGE_CREATE_FORM, LINEAGE_EDIT_FORM, LINK_ADD_FORM, LINK_END_FORM, RECORD_CREATE_FORM } from './form-ids';

const LINEAGE_LABELS = { name: 'Name of the lineage', description: 'Description', rootSlug: 'Root record', reason: 'Reason' };
const RECORD_LABELS = {
  primaryName: 'Name in Latin letters',
  originalName: 'Name in its own script',
  originalLang: 'Script of that name',
  jyutping: 'Jyutping',
  pinyin: 'Pinyin',
  lifeStatus: 'Life status',
  bio: 'Biography (English)',
  reason: 'Reason',
  evidenceIds: 'Evidence',
};
const LINK_LABELS = { lineageId: 'Lineage', teacherSlug: 'Teacher', studentSlug: 'Student', fromYear: 'From (year)', toYear: 'To (year)', source: 'Source', evidenceIds: 'Evidence' };
const ROOT_HINT = 'Optional. The address of the record at the root (the part after /people/, or as the search shows it). Leave empty when the root is not known.';
const REASON_HINT = 'Required. Why, and on what basis; kept in the audit log with your name and role.';

function LineageFields({ formId, state, start }: { formId: string; state: FormState; start?: { name: string; description: string | null; rootSlug: string | null } }) {
  return (
    <>
      <TextField form={formId} name="name" label={LINEAGE_LABELS.name} autoComplete="off" maxLength={120} defaultValue={start?.name} hint="In Latin letters, as the explorer shows it." state={state} className="max-w-[34rem]" />
      <TextAreaField form={formId} name="description" label={LINEAGE_LABELS.description} optional maxLength={2000} rows={3} lang="en" defaultValue={start?.description ?? undefined} state={state} className="max-w-[40rem]" />
      <TextField
        form={formId}
        name="rootSlug"
        label={LINEAGE_LABELS.rootSlug}
        optional
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        translate="no"
        maxLength={200}
        defaultValue={start?.rootSlug ?? undefined}
        hint={ROOT_HINT}
        state={state}
        className="max-w-[34rem]"
      />
      <TextAreaField form={formId} name="reason" label={LINEAGE_LABELS.reason} maxLength={2000} rows={3} hint={REASON_HINT} state={state} className="max-w-[40rem]" />
    </>
  );
}

/** A new lineage: shown in the explorer once its root and one of its links are public. */
export function CreateLineageForm({ initial }: { initial?: FormState | null }) {
  const [state, action, pending] = useActionState(createLineageAction, initial ?? IDLE);
  const generatedId = useFormId(LINEAGE_CREATE_FORM);
  const formId = initial ? LINEAGE_CREATE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="lineage-create-form">
      <FormMessage form={formId} state={state} labels={LINEAGE_LABELS} />
      <LineageFields formId={formId} state={state} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create the lineage
        </SubmitButton>
      </div>
    </form>
  );
}

/** A lineage's name, description and root. */
export function EditLineageForm({
  lineage,
  initial,
}: {
  lineage: { id: string; slug: string; name: string; description: string | null; rootSlug: string | null };
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(updateLineageAction, initial ?? IDLE);
  const generatedId = useFormId(LINEAGE_EDIT_FORM);
  const formId = initial ? LINEAGE_EDIT_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="lineage-edit-form">
      <FormMessage form={formId} state={state} labels={LINEAGE_LABELS} />
      <input type="hidden" name="lineageId" value={lineage.id} />
      <input type="hidden" name="slug" value={lineage.slug} />
      <LineageFields formId={formId} state={state} start={lineage} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…" variant="secondary">
          Save the lineage
        </SubmitButton>
      </div>
    </form>
  );
}

/** A new historical record kept by the platform: private until one of its links is verified. */
export function CreateRecordForm({ scripts, back, name, initial }: { scripts: { lang: string; label: string }[]; back?: string; name?: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(createRecordAction, initial ?? IDLE);
  const generatedId = useFormId(RECORD_CREATE_FORM);
  const formId = initial ? RECORD_CREATE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="record-create-form">
      <FormMessage form={formId} state={state} labels={RECORD_LABELS} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <TextField form={formId} name="primaryName" label={RECORD_LABELS.primaryName} autoComplete="off" maxLength={120} defaultValue={name} hint="The everyday spelling, shown as the person's name." state={state} className="max-w-[34rem]" />
      <div className="grid gap-3 sm:max-w-[34rem]">
        <TextField form={formId} name="originalName" label={RECORD_LABELS.originalName} optional autoComplete="off" maxLength={120} state={state} />
        <SelectField form={formId} name="originalLang" label={RECORD_LABELS.originalLang} optional autoComplete="off" state={state} defaultValue="">
          <option value="">Choose a script</option>
          {scripts.map((script) => (
            <option key={script.lang} value={script.lang}>
              {script.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-3 sm:max-w-[34rem] sm:grid-cols-2">
        <TextField form={formId} name="jyutping" label={RECORD_LABELS.jyutping} optional autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={120} hint="For example: sou1 zuk1 cing4" state={state} />
        <TextField form={formId} name="pinyin" label={RECORD_LABELS.pinyin} optional autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={120} state={state} />
      </div>
      <SelectField
        form={formId}
        name="lifeStatus"
        label={RECORD_LABELS.lifeStatus}
        autoComplete="off"
        hint="A person whose life status is not known is treated as living: the record and its links stay off the public pages until the evidence shows a death."
        state={state}
        defaultValue="deceased"
        className="max-w-[34rem]"
      >
        <option value="deceased">Deceased</option>
        <option value="unknown">Not known</option>
      </SelectField>
      <TextAreaField form={formId} name="bio" label={RECORD_LABELS.bio} optional maxLength={1000} rows={5} lang="en" state={state} className="max-w-[40rem]" />
      <EvidenceUploader
        label="Evidence"
        hint="Optional. JPEG, PNG, WebP or PDF, up to 20 MB each. Linked files stay with the record; staff only."
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <TextAreaField form={formId} name="reason" label={RECORD_LABELS.reason} maxLength={2000} rows={3} hint={REASON_HINT} state={state} className="max-w-[40rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create the record
        </SubmitButton>
      </div>
    </form>
  );
}

/** A verified link teacher → student in this lineage, on a source. */
export function AddLinkForm({
  lineage,
  teacherSlug,
  studentSlug,
  idempotencyKey,
  initial,
  person,
}: {
  lineage: { id: string; slug: string };
  teacherSlug?: string;
  studentSlug?: string;
  idempotencyKey: string;
  initial?: FormState | null;
  /** The person open in the outline's panel, to come back to. */
  person?: string;
}) {
  const [state, action, pending] = useActionState(addLinkAction, initial ?? IDLE);
  const generatedId = useFormId(LINK_ADD_FORM);
  const formId = initial ? LINK_ADD_FORM : generatedId;
  useFocusOnError(formId, state);
  const slugField = { autoComplete: 'off', spellCheck: false, autoCapitalize: 'none', translate: 'no' as const, maxLength: 200 };
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="link-add-form">
      <FormMessage form={formId} state={state} labels={LINK_LABELS} />
      <input type="hidden" name="lineageId" value={lineage.id} />
      <input type="hidden" name="slug" value={lineage.slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {person ? <input type="hidden" name="person" value={person} /> : null}
      <div className="grid gap-3 sm:max-w-[40rem] sm:grid-cols-2">
        <TextField form={formId} name="teacherSlug" label={LINK_LABELS.teacherSlug} {...slugField} defaultValue={teacherSlug} hint="The teacher's record address." state={state} />
        <TextField form={formId} name="studentSlug" label={LINK_LABELS.studentSlug} {...slugField} defaultValue={studentSlug} hint="The student's record address." state={state} />
      </div>
      <div className="grid gap-3 sm:max-w-[34rem] sm:grid-cols-2">
        <TextField form={formId} name="fromYear" label={LINK_LABELS.fromYear} optional autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
        <TextField form={formId} name="toYear" label={LINK_LABELS.toYear} optional autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
      </div>
      <p className="max-w-[60ch] text-sm text-fg-muted">Leave both years empty when the dates of the training are not known.</p>
      <TextAreaField
        form={formId}
        name="source"
        label={LINK_LABELS.source}
        maxLength={2000}
        rows={3}
        hint="Required. Where this training is recorded: a book and its page, an interview, a certificate. Staff see it; the public pages do not."
        state={state}
        className="max-w-[40rem]"
      />
      <EvidenceUploader
        label="Evidence"
        hint="Optional. JPEG, PNG, WebP or PDF, up to 20 MB each: a scan of the page, a photo of the certificate. Staff only."
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Adding…">
          Add the link
        </SubmitButton>
      </div>
    </form>
  );
}

/** "End this link": a link entered by mistake is ended with a reason (never deleted). */
export function EndLinkForm({
  relationshipId,
  slug,
  idempotencyKey,
  initial,
  fromLinks = false,
}: {
  relationshipId: string;
  slug: string;
  idempotencyKey: string;
  initial?: FormState | null;
  /** Posted from the links grid: come back there. */
  fromLinks?: boolean;
}) {
  const [state, action, pending] = useActionState(endLinkAction, initial ?? IDLE);
  const fixed = `${LINK_END_FORM}-${relationshipId}`;
  const generatedId = useFormId(fixed);
  const formId = initial ? fixed : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="link-end-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="relationshipId" value={relationshipId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {fromLinks ? <input type="hidden" name="view" value="links" /> : null}
      <TextAreaField form={formId} name="reason" label="Reason for ending this link" maxLength={2000} rows={2} hint="Required. The link leaves the public pages; its history stays." state={state} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Ending…" variant="danger">
          End this link
        </SubmitButton>
      </div>
    </form>
  );
}
