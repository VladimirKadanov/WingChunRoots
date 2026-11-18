'use client';
'use no memo';

// The forms of the archive editor (milestone M26, docs/adr/0034-archive-editor.md): a new lineage, a
// lineage's name, description and root, a new historical record, a new link and ending a link. Each
// posts to one thin Server Action over one procedure (./actions.ts) and works without JavaScript (the
// browser posts the form and a refusal comes back opened at the form's message:
// src/server/forms/flash.ts). The button is aria-disabled while the action runs, so a double click
// sends one request; a link also carries an idempotency key the page made for it.

import { useActionState } from 'react';

import { useAdminT } from '@/components/admin/i18n/client';
import type { AdminT } from '@/components/admin/i18n/translate';
import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../../dashboard/teachers/historical/actions';
import { addLinkAction, createLineageAction, createRecordAction, endLinkAction, updateLineageAction } from './actions';
import { LINEAGE_CREATE_FORM, LINEAGE_EDIT_FORM, LINK_ADD_FORM, LINK_END_FORM, RECORD_CREATE_FORM } from './form-ids';

const lineageLabels = (t: AdminT) => ({ name: t('Name of the lineage'), description: t('Description'), rootSlug: t('Root record'), reason: t('Reason') });
const recordLabels = (t: AdminT) => ({
  primaryName: t('Name in Latin letters'),
  originalName: t('Name in its own script'),
  originalLang: t('Script of that name'),
  jyutping: 'Jyutping',
  pinyin: t('Pinyin'),
  lifeStatus: t('Life status'),
  bio: t('Biography (English)'),
  reason: t('Reason'),
  evidenceIds: t('Evidence'),
});
const linkLabels = (t: AdminT) => ({
  lineageId: t('Lineage'),
  teacherSlug: t('Teacher'),
  studentSlug: t('Student'),
  fromYear: t('From (year)'),
  toYear: t('To (year)'),
  source: t('Source'),
  evidenceIds: t('Evidence'),
});
const reasonHint = (t: AdminT) => t('Required. Why, and on what basis; kept in the audit log with your name and role.');

function LineageFields({ formId, state, start }: { formId: string; state: FormState; start?: { name: string; description: string | null; rootSlug: string | null } }) {
  const t = useAdminT();
  const labels = lineageLabels(t);
  return (
    <>
      <TextField form={formId} name="name" label={labels.name} autoComplete="off" maxLength={120} defaultValue={start?.name} hint={t('In Latin letters, as the explorer shows it.')} state={state} className="max-w-[34rem]" />
      <TextAreaField form={formId} name="description" label={labels.description} optional maxLength={2000} rows={3} lang="en" defaultValue={start?.description ?? undefined} state={state} className="max-w-[40rem]" />
      <TextField
        form={formId}
        name="rootSlug"
        label={labels.rootSlug}
        optional
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        translate="no"
        maxLength={200}
        defaultValue={start?.rootSlug ?? undefined}
        hint={t('Optional. The address of the record at the root (the part after /people/, or as the search shows it). Leave empty when the root is not known.')}
        state={state}
        className="max-w-[34rem]"
      />
      <TextAreaField form={formId} name="reason" label={labels.reason} maxLength={2000} rows={3} hint={reasonHint(t)} state={state} className="max-w-[40rem]" />
    </>
  );
}

/** A new lineage: shown in the explorer once its root and one of its links are public. */
export function CreateLineageForm({ initial }: { initial?: FormState | null }) {
  const t = useAdminT();
  const [state, action, pending] = useActionState(createLineageAction, initial ?? IDLE);
  const generatedId = useFormId(LINEAGE_CREATE_FORM);
  const formId = initial ? LINEAGE_CREATE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="lineage-create-form">
      <FormMessage form={formId} state={state} labels={lineageLabels(t)} />
      <LineageFields formId={formId} state={state} />
      <div>
        <SubmitButton pending={pending} pendingLabel={t('Creating…')}>
          {t('Create the lineage')}
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
  const t = useAdminT();
  const [state, action, pending] = useActionState(updateLineageAction, initial ?? IDLE);
  const generatedId = useFormId(LINEAGE_EDIT_FORM);
  const formId = initial ? LINEAGE_EDIT_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="lineage-edit-form">
      <FormMessage form={formId} state={state} labels={lineageLabels(t)} />
      <input type="hidden" name="lineageId" value={lineage.id} />
      <input type="hidden" name="slug" value={lineage.slug} />
      <LineageFields formId={formId} state={state} start={lineage} />
      <div>
        <SubmitButton pending={pending} pendingLabel={t('Saving…')} variant="secondary">
          {t('Save the lineage')}
        </SubmitButton>
      </div>
    </form>
  );
}

/** A new historical record kept by the platform: private until one of its links is verified. */
export function CreateRecordForm({ scripts, back, name, initial }: { scripts: { lang: string; label: string }[]; back?: string; name?: string; initial?: FormState | null }) {
  const t = useAdminT();
  const labels = recordLabels(t);
  const [state, action, pending] = useActionState(createRecordAction, initial ?? IDLE);
  const generatedId = useFormId(RECORD_CREATE_FORM);
  const formId = initial ? RECORD_CREATE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="record-create-form">
      <FormMessage form={formId} state={state} labels={labels} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <TextField form={formId} name="primaryName" label={labels.primaryName} autoComplete="off" maxLength={120} defaultValue={name} hint={t("The everyday spelling, shown as the person's name.")} state={state} className="max-w-[34rem]" />
      <div className="grid gap-3 sm:max-w-[34rem]">
        <TextField form={formId} name="originalName" label={labels.originalName} optional autoComplete="off" maxLength={120} state={state} />
        <SelectField form={formId} name="originalLang" label={labels.originalLang} optional autoComplete="off" state={state} defaultValue="">
          <option value="">{t('Choose a script')}</option>
          {scripts.map((script) => (
            <option key={script.lang} value={script.lang}>
              {script.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-3 sm:max-w-[34rem] sm:grid-cols-2">
        <TextField form={formId} name="jyutping" label={labels.jyutping} optional autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={120} hint={t('For example: sou1 zuk1 cing4')} state={state} />
        <TextField form={formId} name="pinyin" label={labels.pinyin} optional autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={120} state={state} />
      </div>
      <SelectField
        form={formId}
        name="lifeStatus"
        label={labels.lifeStatus}
        autoComplete="off"
        hint={t('A person whose life status is not known is treated as living: the record and its links stay off the public pages until the evidence shows a death.')}
        state={state}
        defaultValue="deceased"
        className="max-w-[34rem]"
      >
        <option value="deceased">{t('Deceased')}</option>
        <option value="unknown">{t('Not known')}</option>
      </SelectField>
      <TextAreaField form={formId} name="bio" label={labels.bio} optional maxLength={1000} rows={5} lang="en" state={state} className="max-w-[40rem]" />
      <EvidenceUploader
        label={t('Evidence')}
        hint={t('Optional. JPEG, PNG, WebP or PDF, up to 20 MB each. Linked files stay with the record; staff only.')}
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <TextAreaField form={formId} name="reason" label={labels.reason} maxLength={2000} rows={3} hint={reasonHint(t)} state={state} className="max-w-[40rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel={t('Creating…')}>
          {t('Create the record')}
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
  const t = useAdminT();
  const labels = linkLabels(t);
  const [state, action, pending] = useActionState(addLinkAction, initial ?? IDLE);
  const generatedId = useFormId(LINK_ADD_FORM);
  const formId = initial ? LINK_ADD_FORM : generatedId;
  useFocusOnError(formId, state);
  const slugField = { autoComplete: 'off', spellCheck: false, autoCapitalize: 'none', translate: 'no' as const, maxLength: 200 };
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="link-add-form">
      <FormMessage form={formId} state={state} labels={labels} />
      <input type="hidden" name="lineageId" value={lineage.id} />
      <input type="hidden" name="slug" value={lineage.slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {person ? <input type="hidden" name="person" value={person} /> : null}
      <div className="grid gap-3 sm:max-w-[40rem] sm:grid-cols-2">
        <TextField form={formId} name="teacherSlug" label={labels.teacherSlug} {...slugField} defaultValue={teacherSlug} hint={t("The teacher's record address.")} state={state} />
        <TextField form={formId} name="studentSlug" label={labels.studentSlug} {...slugField} defaultValue={studentSlug} hint={t("The student's record address.")} state={state} />
      </div>
      <div className="grid gap-3 sm:max-w-[34rem] sm:grid-cols-2">
        <TextField form={formId} name="fromYear" label={labels.fromYear} optional autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
        <TextField form={formId} name="toYear" label={labels.toYear} optional autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
      </div>
      <p className="max-w-[60ch] text-sm text-fg-muted">{t('Leave both years empty when the dates of the training are not known.')}</p>
      <TextAreaField
        form={formId}
        name="source"
        label={labels.source}
        maxLength={2000}
        rows={3}
        hint={t('Required. Where this training is recorded: a book and its page, an interview, a certificate. Staff see it; the public pages do not.')}
        state={state}
        className="max-w-[40rem]"
      />
      <EvidenceUploader
        label={t('Evidence')}
        hint={t('Optional. JPEG, PNG, WebP or PDF, up to 20 MB each: a scan of the page, a photo of the certificate. Staff only.')}
        discard={discardEvidenceAction}
        inputId={fieldId(formId, 'evidenceIds')}
        error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel={t('Adding…')}>
          {t('Add the link')}
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
  const t = useAdminT();
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
      <TextAreaField form={formId} name="reason" label={t('Reason for ending this link')} maxLength={2000} rows={2} hint={t('Required. The link leaves the public pages; its history stays.')} state={state} />
      <div>
        <SubmitButton pending={pending} pendingLabel={t('Ending…')} variant="danger">
          {t('End this link')}
        </SubmitButton>
      </div>
    </form>
  );
}
