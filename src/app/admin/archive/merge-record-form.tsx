// "Merge into the chosen record" (archiveEditor.mergeRecord, docs/adr/0086-archive-duplicates.md):
// on a possible duplicate in the people grid, the other records it may duplicate are offered; the
// chosen one is kept and this one's links, names and evidence move to it.
//
// A Server Component, as ./edit-link-form.tsx: no client module, so the people route carries no more
// JavaScript for it. The action keeps a refusal for the page (keepFormResult).

import type { AdminT } from '@/components/admin/i18n/translate';
import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { type FormState, IDLE, messageId, summaryId } from '@/lib/form-state';
import { mergeRecordAction } from './actions';
import { Field } from './edit-link-form';
import { RECORD_MERGE_FORM } from './form-ids';
import { fieldClass } from './grid-parts';

export function MergeRecordForm({
  t,
  from,
  choices,
  initial,
}: {
  t: AdminT;
  from: string;
  choices: { slug: string; label: string }[];
  initial: FormState | null;
}) {
  const state = initial ?? IDLE;
  const form = `${RECORD_MERGE_FORM}-${from}`;
  const failed = state.status === 'error';
  const error = (name: string) => (failed ? state.fields?.[name] : undefined);
  const value = (name: string, start: string) => state.values?.[name] ?? start;
  return (
    <form id={form} action={mergeRecordAction.bind(null, IDLE)} noValidate className="grid gap-3" data-testid="record-merge-form">
      <div id={summaryId(form)} tabIndex={-1} className="outline-none">
        {failed && state.message ? (
          <p id={messageId(form)} role="alert" className="flex items-start gap-1.5 font-semibold text-danger">
            <AlertIcon size={16} className="mt-1" />
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>
      <input type="hidden" name="fromSlug" value={from} />
      <Field form={form} name="intoSlug" label={t('Record to keep')} hint={t('This record’s links, names and evidence move there, and its address opens the kept record.')} error={error('intoSlug') ?? error('fromSlug')}>
        {(props) => (
          <select {...props} name="intoSlug" defaultValue={value('intoSlug', choices[0]?.slug ?? '')} className={cx(fieldClass, 'max-w-[24rem]')}>
            {choices.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field form={form} name="reason" label={t('Reason')} hint={t('Required. Why, and on what basis; kept in the audit log with your name and role.')} error={error('reason')}>
        {(props) => <textarea {...props} name="reason" rows={2} maxLength={2000} required defaultValue={value('reason', '')} className={cx(fieldClass, 'py-2')} />}
      </Field>
      <div>
        <button type="submit" className={buttonVariants({ variant: 'danger' })}>
          {t('Merge into the chosen record')}
        </button>
      </div>
    </form>
  );
}
