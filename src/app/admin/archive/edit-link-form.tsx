// "Save the years and source" (archiveEditor.editLink, docs/adr/0042-archive-link-edit.md): the form
// in the links grid's panel, prefilled with the link's years and source.
//
// A Server Component on purpose (as src/app/people/[slug]/passport-remove-form.tsx): no client
// module, so the links route carries no more JavaScript for it (scripts/check-bundle-budget.mjs).
// The action keeps a refusal for the page (keepFormResult), which reads it back as `initial`; the ids
// follow the form kit (src/lib/form-state.ts), so the page opens at the message or the field.

import type { ReactNode } from 'react';

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE, messageId, summaryId } from '@/lib/form-state';
import { editLinkAction } from './actions';
import { LINK_EDIT_FORM } from './form-ids';
import { fieldClass } from './grid-parts';

function Problem({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <AlertIcon size={16} className="mt-0.5" />
      <span>{text}</span>
    </p>
  );
}

function Field({
  form,
  name,
  label,
  hint,
  error,
  children,
}: {
  form: string;
  name: string;
  label: string;
  hint?: string;
  error: string | undefined;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = fieldId(form, name);
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      {children({ id, ...(error ? { 'aria-invalid': true as const } : {}), ...(described ? { 'aria-describedby': described } : {}) })}
      <Problem id={`${id}-error`} text={error} />
    </div>
  );
}

export function EditLinkForm({
  link,
  slug,
  initial,
}: {
  link: { id: string; fromYear: number | null; toYear: number | null; source: string | null };
  slug: string;
  initial: FormState | null;
}) {
  const state = initial ?? IDLE;
  const form = `${LINK_EDIT_FORM}-${link.id}`;
  const failed = state.status === 'error';
  const error = (name: string) => (failed ? state.fields?.[name] : undefined);
  const value = (name: string, start: string) => state.values?.[name] ?? start;
  const yearInput = 'max-w-[10rem] tabular-nums';
  return (
    <form id={form} action={editLinkAction.bind(null, IDLE)} noValidate className="grid gap-3" data-testid="link-edit-form">
      <div id={summaryId(form)} tabIndex={-1} className="outline-none">
        {failed && state.message ? (
          <p id={messageId(form)} role="alert" className="flex items-start gap-1.5 font-semibold text-danger">
            <AlertIcon size={16} className="mt-1" />
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>
      <input type="hidden" name="relationshipId" value={link.id} />
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field form={form} name="fromYear" label="From (year), optional" error={error('fromYear')}>
          {(props) => <input {...props} name="fromYear" inputMode="numeric" maxLength={4} autoComplete="off" defaultValue={value('fromYear', link.fromYear === null ? '' : String(link.fromYear))} className={cx(fieldClass, yearInput)} />}
        </Field>
        <Field form={form} name="toYear" label="To (year), optional" error={error('toYear')}>
          {(props) => <input {...props} name="toYear" inputMode="numeric" maxLength={4} autoComplete="off" defaultValue={value('toYear', link.toYear === null ? '' : String(link.toYear))} className={cx(fieldClass, yearInput)} />}
        </Field>
      </div>
      <Field form={form} name="source" label="Source" hint="Required. Where this training is recorded. Staff only." error={error('source')}>
        {(props) => <textarea {...props} name="source" rows={3} maxLength={2000} required defaultValue={value('source', link.source ?? '')} className={cx(fieldClass, 'py-2')} />}
      </Field>
      <Field form={form} name="reason" label="Reason" hint="Required. Why, and on what basis; kept in the audit log with your name and role." error={error('reason')}>
        {(props) => <textarea {...props} name="reason" rows={2} maxLength={2000} required defaultValue={value('reason', '')} className={cx(fieldClass, 'py-2')} />}
      </Field>
      <div>
        <button type="submit" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Save the years and source
        </button>
      </div>
    </form>
  );
}
