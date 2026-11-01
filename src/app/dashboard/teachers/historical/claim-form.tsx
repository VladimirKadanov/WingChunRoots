'use client';

// The claim form of /dashboard/teachers/historical (milestone M10a, In scope 1 and 2): the teacher
// (one found on record, fixed, or a new record: the name in Latin letters, optionally in its own
// script, and whether the teacher has died), the lineage, when the training was, the evidence (the
// plain file field of src/components/evidence/uploader.tsx: at least one file) and a note for the
// reviewers. A plain form posted to a thin Server Action over relationships.requestHistorical,
// with an idempotency key the page made for it, so a double press sends one claim.

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextAreaField, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { NameText } from '@/components/account/person-names';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction, requestHistoricalAction } from './actions';
import { HISTORICAL_FORM } from './form-ids';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3 sm:max-w-[30rem]';

export interface ClaimFormOptions {
  lineages: { id: string; name: string }[];
  scripts: { lang: string; label: string }[];
  noteMax: number;
}

/** A teacher found on record (?teacher=<slug>): fixed in the form. */
export interface FixedTeacher {
  id: string;
  slug: string;
  name: string;
  where: string;
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

export function ClaimForm({ options, teacher, idempotencyKey, initial }: { options: ClaimFormOptions; teacher: FixedTeacher | null; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(requestHistoricalAction, initial ?? IDLE);
  const generatedId = useFormId(HISTORICAL_FORM);
  const formId = initial ? HISTORICAL_FORM : generatedId;
  useFocusOnError(formId, state);
  // Controlled selects: React resets the form after its action (finding H2 of M02).
  const start = initial?.values ?? {};
  const [selects, setSelects] = useState<Record<string, string>>({
    lineageId: start.lineageId ?? '',
    originalLang: start.originalLang ?? '',
    lifeStatus: start.lifeStatus ?? 'unknown',
    fromMonth: start.fromMonth ?? '',
    toMonth: start.toMonth ?? '',
  });
  const select = (name: string) => ({ value: selects[name] ?? '', onValue: (value: string) => setSelects((current) => ({ ...current, [name]: value })) });
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  const labels: Record<string, string> = {
    teacherId: 'Teacher',
    teacherName: 'Teacher’s name',
    originalName: 'Name in its own script',
    originalLang: 'Script',
    lineageId: 'Lineage',
    fromYear: 'Started',
    toYear: 'Ended',
    evidenceIds: 'Evidence',
    note: 'Note for the reviewers',
  };

  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-8" data-testid="historical-claim-form">
      <FormMessage form={formId} state={state} labels={labels} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <section aria-labelledby={`${formId}-teacher`} className="grid gap-4">
        <h2 id={`${formId}-teacher`} className="font-display text-2xl">
          The teacher
        </h2>
        {teacher ? (
          <div data-testid="chosen-teacher" className="grid gap-0.5">
            <input type="hidden" name="teacherId" value={teacher.id} />
            <input type="hidden" name="teacherSlug" value={teacher.slug} />
            <NameText name={{ value: teacher.name, lang: 'und-Latn' }} className="font-display text-xl" />
            {teacher.where ? <span className="text-sm text-fg-muted">{teacher.where}</span> : null}
            {state.status === 'error' && state.fields?.teacherId ? <p className="text-sm text-danger">{state.fields.teacherId}</p> : null}
          </div>
        ) : (
          <>
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
            <SelectField form={formId} name="lifeStatus" label="Has the teacher died?" autoComplete="off" state={state} className="max-w-[34rem]" {...select('lifeStatus')}>
              <option value="unknown">Not known</option>
              <option value="deceased">Yes, the teacher has died</option>
            </SelectField>
          </>
        )}
      </section>

      <section aria-labelledby={`${formId}-lineage`} className="grid gap-3">
        <h2 id={`${formId}-lineage`} className="font-display text-2xl">
          Lineage
        </h2>
        <SelectField
          form={formId}
          name="lineageId"
          label="Lineage of this training"
          optional={teacher !== null}
          autoComplete="off"
          state={state}
          className="max-w-[34rem]"
          {...select('lineageId')}
        >
          {teacher ? <option value="">The teacher’s own lineage</option> : <option value="">Choose a lineage</option>}
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
        <div className={ROW}>
          <TextField form={formId} name="toYear" label="Ended (year)" autoComplete="off" inputMode="numeric" maxLength={4} state={state} />
          <SelectField form={formId} name="toMonth" label="Month" optional autoComplete="off" state={state} {...select('toMonth')}>
            <MonthOptions />
          </SelectField>
        </div>
      </section>

      <section aria-labelledby={`${formId}-evidence`} className="grid gap-4">
        <h2 id={`${formId}-evidence`} className="font-display text-2xl">
          Evidence
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          A certificate, a letter, a photograph of you training together, a page of a school register. Only you, the reviewers and the
          administrators can open these files; they are never public. Location data and other metadata are removed from photographs.
        </p>
        <EvidenceUploader
          label="Add files"
          hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files."
          initial={files}
          discard={discardEvidenceAction}
          error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
        />
        <TextAreaField
          form={formId}
          name="note"
          label="Note for the reviewers"
          optional
          maxLength={options.noteMax}
          hint="Where the evidence comes from and what it shows. The reviewers read it; it is never public."
          state={state}
          className="max-w-[40rem]"
        />
      </section>

      <div className="grid gap-3">
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Until the reviewers confirm it, only you and the reviewers see this claim{teacher ? '' : ' and the new teacher record'}. When they confirm it,
          the link is shown publicly, and so are both profiles, unless you have withdrawn your consent to be shown publicly.
        </p>
        <div>
          <SubmitButton pending={pending} pendingLabel="Sending…">
            Send the claim
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
