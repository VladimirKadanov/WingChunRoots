'use client';

// The fields of the account forms (milestone M02): native inputs styled like the Input of the
// design system, so the forms work before JavaScript loads and add little to the page's
// JavaScript. Every field has a visible label, an optional hint and a server-side error that is
// tied to the input (aria-invalid, aria-describedby, aria-errormessage). After a failed submit
// the first field with an error, or the form's message, gets the focus: through `autoFocus` in
// the server-rendered page without JavaScript, and through an effect with it.

import { type ReactNode, useEffect, useRef } from 'react';
import { CheckIcon, ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState } from '@/lib/form-state';

export const fieldClassName = cx(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg',
  'placeholder:text-fg-subtle transition-[border-color,background-color] duration-(--duration-fast) ease-out',
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-danger',
);

/** Moves the focus to the first invalid field, or to the form's message, after a failed submit. */
export function useFocusOnError(formId: string, state: FormState) {
  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.status === 'idle') return;
    const form = document.getElementById(formId);
    const target =
      (state.status === 'error' ? form?.querySelector<HTMLElement>('[aria-invalid="true"]') : null) ??
      form?.querySelector<HTMLElement>('[data-form-message]');
    target?.focus();
  }, [formId, state]);
}

/** The first field name (in the order given) that has an error. */
export function firstInvalid(state: FormState, order: readonly string[]): string | null {
  if (state.status !== 'error' || !state.fields) return null;
  return order.find((name) => state.fields?.[name]) ?? null;
}

export function FormMessage({ form, state }: { form: string; state: FormState }) {
  if (!state.message || state.status === 'idle') return null;
  const error = state.status === 'error';
  const hasFieldErrors = error && state.fields && Object.keys(state.fields).length > 0;
  return (
    <div
      id={`${form}-message`}
      data-form-message=""
      tabIndex={-1}
      role={error ? 'alert' : 'status'}
      autoFocus={!hasFieldErrors}
      className={cx(
        'rounded-sm border-l-4 px-4 py-3 text-sm outline-offset-4',
        error ? 'border-danger bg-surface-2 text-fg' : 'border-fg bg-surface-2 text-fg',
      )}
    >
      <p className="flex gap-2">
        <span aria-hidden="true" className={cx('font-semibold', error && 'text-danger')}>
          {error ? '✕' : '✓'}
        </span>
        <span>{state.message}</span>
      </p>
    </div>
  );
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <p id={id} className="text-sm text-danger">
      <span aria-hidden="true">✕ </span>
      {error}
    </p>
  );
}

function describedBy(...ids: (string | false | undefined)[]) {
  const list = ids.filter(Boolean).join(' ');
  return list || undefined;
}

interface BaseFieldProps {
  form: string;
  name: string;
  label: ReactNode;
  state: FormState;
  hint?: ReactNode;
  optional?: boolean;
  autoFocus?: boolean;
}

export function TextField({
  form,
  name,
  label,
  state,
  hint,
  optional,
  autoFocus,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  minLength,
  lang,
  defaultValue,
  spellCheck,
  autoCapitalize,
  translate,
  placeholder,
}: BaseFieldProps & {
  type?: 'text' | 'email' | 'password' | 'number';
  autoComplete: string;
  inputMode?: 'text' | 'email' | 'numeric';
  maxLength?: number;
  minLength?: number;
  lang?: string;
  defaultValue?: string;
  spellCheck?: boolean;
  autoCapitalize?: string;
  translate?: 'no';
  placeholder?: string;
}) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  // Passwords are never sent back to the page.
  const value = type === 'password' ? undefined : (state.values?.[name] ?? defaultValue);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {optional ? <span className="font-normal text-fg-muted"> (optional)</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        minLength={minLength}
        lang={lang}
        translate={translate}
        spellCheck={spellCheck}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        required={!optional}
        defaultValue={value}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errorId : undefined}
        aria-describedby={describedBy(hintId, error && errorId)}
        className={fieldClassName}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

export function SelectField({
  form,
  name,
  label,
  state,
  hint,
  optional,
  autoFocus,
  autoComplete,
  onChange,
  children,
}: BaseFieldProps & { autoComplete: string; onChange?: (value: string) => void; children: ReactNode }) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {optional ? <span className="font-normal text-fg-muted"> (optional)</span> : null}
      </label>
      <div className="relative">
        <select
          id={id}
          name={name}
          autoComplete={autoComplete}
          required={!optional}
          defaultValue={state.values?.[name] ?? ''}
          autoFocus={autoFocus}
          onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          aria-describedby={describedBy(hintId, error && errorId)}
          className={cx(fieldClassName, 'appearance-none pr-11')}
        >
          {children}
        </select>
        <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

/** A checkbox that is never ticked in advance; the whole row is the 44 px target. */
export function CheckboxField({
  form,
  name,
  label,
  state,
  autoFocus,
  required,
}: Omit<BaseFieldProps, 'optional' | 'hint'> & { required?: boolean }) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const errorId = `${id}-error`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
      {/* The whole row is the label, so the target is the row (at least 44 px tall). */}
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-ui">
        <span className="relative grid size-6 shrink-0 place-items-center">
          <input
            id={id}
            name={name}
            type="checkbox"
            value="on"
            required={required}
            defaultChecked={state.values?.[name] === 'on'}
            autoFocus={autoFocus}
            aria-invalid={error ? true : undefined}
            aria-errormessage={error ? errorId : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cx(
              'peer size-6 cursor-pointer appearance-none rounded-[3px] border-2 border-border-strong bg-surface-1',
              'transition-colors duration-(--duration-fast) checked:border-fg checked:bg-fg hover:border-fg-muted',
              'aria-invalid:border-danger',
            )}
          />
          <CheckIcon size={18} className="pointer-events-none absolute hidden text-fg-inverse peer-checked:block" />
        </span>
        <span className="min-w-0 pt-px">{label}</span>
      </label>
      <div className="pl-9">
        <FieldError id={errorId} error={error} />
      </div>
    </div>
  );
}

export function SubmitButton({ pending, children, pendingLabel }: { pending: boolean; children: ReactNode; pendingLabel: string }) {
  return (
    <button
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cx(buttonVariants({ variant: 'primary', size: 'lg' }), 'w-full sm:w-auto sm:min-w-48')}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * What happened after a successful submit, in place of the form: a heading, the text and the next
 * steps. It takes the focus (autoFocus without JavaScript, the effect with it), so screen readers
 * read it at once.
 */
export function DoneNotice({ form, title, children }: { form: string; title: ReactNode; children: ReactNode }) {
  return (
    <div
      id={`${form}-message`}
      data-form-message=""
      role="status"
      tabIndex={-1}
      autoFocus
      className="grid gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4 outline-offset-4 md:px-5"
    >
      <h2 className="flex items-baseline gap-2 font-display text-xl">
        <CheckIcon size={20} className="shrink-0 translate-y-0.5" />
        {title}
      </h2>
      <div className="grid gap-2 text-ui text-fg-muted">{children}</div>
    </div>
  );
}
