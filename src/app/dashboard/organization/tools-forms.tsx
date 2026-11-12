'use client';

// The forms of the organization tools (milestone M24): the CSV upload of the bulk import, and the
// one-button forms (import, discard, withdraw a claim, leave a membership). Each posts to a thin
// Server Action (./tools-actions.ts) and works without JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { FieldError, FieldLabel, fieldClassName, FormMessage, Hint, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { commitImportAction, discardImportAction, leaveOrganizationAction, previewImportAction, withdrawClaimAction } from './tools-actions';
import { IMPORT_FORM } from './tools-form-ids';

export function ImportUploadForm({ organizationId, maxKb, maxRows, initial }: { organizationId: string; maxKb: number; maxRows: number; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(previewImportAction, initial ?? IDLE);
  const generatedId = useFormId(IMPORT_FORM);
  const formId = initial ? IMPORT_FORM : generatedId;
  useFocusOnError(formId, state);
  const id = fieldId(formId, 'file');
  const error = state.status === 'error' ? state.fields?.file : undefined;
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} encType="multipart/form-data" className="grid gap-4" data-testid="organization-import-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="organizationId" value={organizationId} />
      <div data-field="" className="grid max-w-[32rem] grid-cols-[minmax(0,1fr)] gap-1.5">
        <FieldLabel id={id} label="CSV file" />
        <input
          id={id}
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${id}-error` : undefined}
          aria-describedby={cx(`${id}-hint`, error && `${id}-error`)}
          className={cx(fieldClassName, 'min-h-12 py-2.5')}
        />
        <Hint id={`${id}-hint`} hint={`UTF-8, comma or semicolon separated, at most ${maxRows} rows and ${maxKb} KB. Nothing is imported until you check the preview and confirm it.`} />
        <FieldError id={`${id}-error`} error={error} />
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Checking…">
          Check the file
        </SubmitButton>
      </div>
    </form>
  );
}

const ONE_BUTTON = {
  commit: commitImportAction,
  discard: discardImportAction,
  claim: withdrawClaimAction,
  leave: leaveOrganizationAction,
} as const;

/** A one-button form: import or discard a preview, withdraw a claim, leave a membership. */
export function ToolButton({
  kind,
  formId,
  hidden,
  label,
  pendingLabel,
  initial,
  testId,
  context,
  primary = false,
}: {
  kind: keyof typeof ONE_BUTTON;
  formId: string;
  hidden: Record<string, string>;
  label: string;
  pendingLabel: string;
  initial?: FormState | null;
  testId: string;
  /** What the button acts on, for a screen reader. */
  context?: string;
  /** The page's main action: a button rather than a link-styled one. */
  primary?: boolean;
}) {
  const [state, action, pending] = useActionState(ONE_BUTTON[kind], initial ?? IDLE);
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} className="grid justify-items-start gap-2" data-testid={testId}>
      <FormMessage form={formId} state={state} single />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {primary ? (
        <SubmitButton pending={pending} pendingLabel={pendingLabel}>
          {label}
        </SubmitButton>
      ) : (
        <button
          type="submit"
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          className="link inline-flex min-h-11 items-center text-sm font-semibold"
        >
          {pending ? pendingLabel : label}
          {context ? <span className="sr-only">: {context}</span> : null}
        </button>
      )}
    </form>
  );
}
