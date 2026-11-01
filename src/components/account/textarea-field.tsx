'use client';

// A field of several lines for the M10a forms: a reviewer's reason or note, a claim's note to the
// reviewers, an archival edit's reason. Its own module, not in fields.tsx, because fields.tsx is in
// the JavaScript of every account and dashboard form and those routes sit at their 170 kB budget
// (scripts/check-bundle-budget.mjs); only the forms that use it pay for it.

import { useFormStatus } from 'react-dom';

import { type BaseFieldProps, describedBy, FieldError, fieldClassName, FieldLabel, Hint } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { fieldId } from '@/lib/form-state';

/**
 * A text of several lines (M10a: a reviewer's reason or note, a claim's note to the reviewers, an
 * archival edit's reason). Uncontrolled, like TextField: the value after a refused submit comes
 * back through `state.values`.
 */
export function TextAreaField({
  form,
  name,
  label,
  state,
  hint,
  optional,
  autoFocus,
  maxLength,
  rows = 4,
  lang,
  defaultValue,
  className,
}: BaseFieldProps & { maxLength: number; rows?: number; lang?: string; defaultValue?: string; className?: string }) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const { pending } = useFormStatus();
  return (
    <div data-field="" className={cx('grid grid-cols-[minmax(0,1fr)] content-start gap-1.5', className)}>
      <FieldLabel id={id} label={label} optional={optional} />
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        lang={lang}
        required={!optional}
        defaultValue={state.values?.[name] ?? defaultValue}
        autoFocus={autoFocus}
        readOnly={pending}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errorId : undefined}
        aria-describedby={describedBy(hintId, error && errorId)}
        className={cx(fieldClassName, 'min-h-28 py-3 leading-relaxed')}
      />
      <Hint id={hintId} hint={hint} />
      <FieldError id={errorId} error={error} />
    </div>
  );
}
