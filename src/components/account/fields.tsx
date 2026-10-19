'use client';

// The fields of the account forms (milestone M02): native inputs styled like the Input of the
// design system, so the forms work before JavaScript loads and add little to the page's
// JavaScript. Every field has a visible label, an optional hint and a server-side error that is
// tied to the input (aria-invalid, aria-describedby, aria-errormessage).
//
// After a failed submit the focus moves to the error summary (several fields: how many, with a
// link to each), to the one field with an error (a form of one field: its own message only), or to
// the form's message; after a submit that replaces the form, to the new heading. Without
// JavaScript the server-rendered page does the same with `autofocus` (src/server/forms/flash.ts
// brings the state back to the page).

import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';

import { AlertIcon, CheckIcon, ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState } from '@/lib/form-state';

export const fieldClassName = cx(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg',
  'placeholder:text-fg-subtle transition-[border-color,background-color] duration-(--duration-fast) ease-out',
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-danger [&[readonly]]:bg-surface-2',
);

type EnterKeyHint = 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';

/**
 * The id of one form instance. With Cache Components, Next.js keeps up to three earlier routes in
 * the document, hidden (React Activity), so the same form can be there twice, for example
 * /sign-in and /sign-in?verified=1; a fixed id would tie a visible label to a hidden input.
 */
export function useFormId(name: string): string {
  return `${name}${useId()}`;
}

const subscribeNever = () => () => {};
/** False in the server render and before hydration, true after: for controls that need JavaScript. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** The ids focus moves to (see the top of this file). */
export const summaryId = (form: string) => `${form}-summary`;
export const messageId = (form: string) => `${form}-message`;
export const doneId = (form: string) => `${form}-done`;

/** Moves the focus after a submit: see the top of this file. */
export function useFocusOnError(formId: string, state: FormState) {
  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.status === 'idle') return;
    const byId = (id: string) => document.getElementById(id);
    const form = byId(formId);
    const target =
      state.status === 'error'
        ? (byId(summaryId(formId)) ?? form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? byId(messageId(formId)))
        : (byId(doneId(formId)) ?? byId(messageId(formId)));
    target?.focus();
    // A heading at the top of the page: also show the eyebrow above it.
    if (target && target.id === doneId(formId)) window.scrollTo({ top: 0 });
  }, [formId, state]);
}

/** The first field name (in the order given) that has an error. */
export function firstInvalid(state: FormState, order: readonly string[]): string | null {
  if (state.status !== 'error' || !state.fields) return null;
  return order.find((name) => state.fields?.[name]) ?? null;
}

/** Whether the summary takes the focus (several fields), rather than the first invalid field. */
export function hasSummary(state: FormState, single: boolean): boolean {
  return !single && state.status === 'error' && Object.keys(state.fields ?? {}).length > 0;
}

/**
 * The form's message. With field errors: a summary of how many fields need a look, each a link
 * to its field (in a form of one field nothing, the field's own message says it). Without: the
 * message itself. `labels` names the fields in the summary, in the order of the form.
 */
export function FormMessage({
  form,
  state,
  labels = {},
  single = false,
}: {
  form: string;
  state: FormState;
  labels?: Record<string, string>;
  single?: boolean;
}) {
  if (state.status === 'idle') return null;
  const fields = state.status === 'error' ? Object.entries(state.fields ?? {}) : [];
  if (fields.length > 0) {
    if (single) return null;
    const order = Object.keys(labels);
    fields.sort(([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    return (
      <div
        id={summaryId(form)}
        data-form-message=""
        role="alert"
        tabIndex={-1}
        autoFocus
        aria-labelledby={`${summaryId(form)}-title`}
        className="grid gap-2 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-3 text-sm outline-offset-4"
      >
        <p id={`${summaryId(form)}-title`} className="flex items-start gap-2 font-semibold">
          <AlertIcon size={18} className="mt-px text-danger" />
          {fields.length === 1 ? '1 answer needs a look' : `${fields.length} answers need a look`}
        </p>
        <ul className="grid gap-0.5 pl-7">
          {fields.map(([name, error]) => (
            <li key={name}>
              <a
                href={`#${fieldId(form, name)}`}
                onClick={(event) => {
                  const input = document.getElementById(fieldId(form, name));
                  if (!input) return;
                  event.preventDefault();
                  input.focus();
                  // The label sits above the input: bring it into view too.
                  input.closest('[data-field]')?.scrollIntoView({ block: 'center' });
                }}
                className="link inline-flex min-h-11 items-center py-1 sm:min-h-0"
              >
                {labels[name] ? `${labels[name]}: ${error}` : error}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!state.message) return null;
  const error = state.status === 'error';
  return (
    <div
      id={messageId(form)}
      data-form-message=""
      tabIndex={-1}
      role={error ? 'alert' : 'status'}
      autoFocus
      className={cx('rounded-sm border-l-4 bg-surface-2 px-4 py-3 text-sm text-fg outline-offset-4', error ? 'border-danger' : 'border-fg')}
    >
      <p className="flex items-start gap-2">
        {error ? <AlertIcon size={18} className="mt-px text-danger" /> : <CheckIcon size={18} className="mt-px" />}
        <span>{state.message}</span>
      </p>
    </div>
  );
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <AlertIcon size={16} className="mt-0.5" />
      <span>{error}</span>
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

function FieldLabel({ id, label, optional }: { id: string; label: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={id} className="text-sm font-semibold">
      {label}
      {optional ? <span className="font-normal text-fg-muted"> (optional)</span> : null}
    </label>
  );
}

function Hint({ id, hint }: { id: string | undefined; hint: ReactNode }) {
  if (!hint) return null;
  return (
    <p id={id} className="text-sm text-fg-muted">
      {hint}
    </p>
  );
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
  enterKeyHint,
  maxLength,
  minLength,
  min,
  max,
  lang,
  defaultValue,
  spellCheck,
  autoCapitalize,
  translate,
  placeholder,
  onValue,
  className,
  inputClassName,
}: BaseFieldProps & {
  /** 'date' (M08): the native date picker, value "YYYY-MM-DD". */
  type?: 'text' | 'email' | 'password' | 'date';
  autoComplete: string;
  inputMode?: 'text' | 'email' | 'numeric';
  enterKeyHint?: EnterKeyHint;
  maxLength?: number;
  minLength?: number;
  /** For type 'date': the first and last day the picker offers, "YYYY-MM-DD" (M08). */
  min?: string;
  max?: string;
  lang?: string;
  defaultValue?: string;
  spellCheck?: boolean;
  autoCapitalize?: string;
  translate?: 'no';
  placeholder?: string;
  /** Called with the value as it is typed (a live preview). */
  onValue?: (value: string) => void;
  className?: string;
  inputClassName?: string;
}) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const { pending } = useFormStatus();
  const hydrated = useHydrated();
  const [shown, setShown] = useState(false);
  const password = type === 'password';
  // Passwords are never sent back to the page.
  const value = password ? undefined : (state.values?.[name] ?? defaultValue);
  return (
    <div data-field="" className={cx('grid grid-cols-[minmax(0,1fr)] content-start gap-1.5', className)}>
      <FieldLabel id={id} label={label} optional={optional} />
      <div className="relative">
        <input
          id={id}
          name={name}
          type={password && shown ? 'text' : type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          maxLength={maxLength}
          minLength={minLength}
          min={min}
          max={max}
          lang={lang}
          translate={translate}
          spellCheck={password ? false : spellCheck}
          autoCapitalize={password ? 'none' : autoCapitalize}
          placeholder={placeholder}
          required={!optional}
          defaultValue={value}
          autoFocus={autoFocus}
          readOnly={pending}
          onChange={onValue ? (event) => onValue(event.currentTarget.value) : undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          aria-describedby={describedBy(hintId, error && errorId)}
          className={cx(fieldClassName, password && hydrated && 'pr-20', inputClassName)}
        />
        {/* Show / Hide needs JavaScript; without it the field stays a plain password field. */}
        {password && hydrated ? (
          // The label says what a press does ("Show password", "Hide password"), so no aria-pressed:
          // a changing label and a pressed state would say it twice (fix round 3, screens-12).
          <button
            type="button"
            aria-controls={id}
            onClick={() => setShown(!shown)}
            className="absolute top-0 right-0 inline-flex min-h-12 min-w-16 items-center justify-center rounded-r-sm px-3 text-sm font-semibold text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          >
            {shown ? 'Hide' : 'Show'}
            <span className="sr-only"> password</span>
          </button>
        ) : null}
      </div>
      <Hint id={hintId} hint={hint} />
      <FieldError id={errorId} error={error} />
    </div>
  );
}

/**
 * The code of an authenticator app (6 digits) or a backup code: large, tabular figures, a field as
 * wide as the code. TOTP codes bring up the number pad; spaces and dashes in a pasted code are
 * removed on the server.
 */
export function CodeField({
  form,
  state,
  kind,
  label,
  hint,
  autoFocus,
  enterKeyHint = 'go',
}: {
  form: string;
  state: FormState;
  kind: 'totp' | 'backup';
  label?: string;
  hint?: ReactNode;
  autoFocus?: boolean;
  enterKeyHint?: EnterKeyHint;
}) {
  const id = fieldId(form, 'code');
  const error = state.status === 'error' ? state.fields?.code : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const { pending } = useFormStatus();
  const totp = kind === 'totp';
  const shared = {
    id,
    name: 'code',
    type: 'text',
    enterKeyHint,
    autoCorrect: 'off',
    spellCheck: false,
    translate: 'no',
    required: true,
    autoFocus,
    readOnly: pending,
    'aria-invalid': error ? true : undefined,
    'aria-errormessage': error ? errorId : undefined,
    'aria-describedby': describedBy(hintId, error && errorId),
    className: cx(fieldClassName, 'min-h-14 font-mono text-2xl tabular-nums'),
  } satisfies InputHTMLAttributes<HTMLInputElement>;
  return (
    <div data-field="" className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5">
      <FieldLabel id={id} label={label ?? (totp ? '6-digit code' : 'Backup code')} />
      {totp ? (
        // The phone may offer the code it has just received; the number pad comes up.
        <input
          {...shared}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={9}
          autoCapitalize="none"
          className={cx(shared.className, 'max-w-[12rem] tracking-[0.3em]')}
        />
      ) : (
        // A backup code is typed from paper or a saved file: no offer of a code from a message.
        <input
          {...shared}
          autoComplete="off"
          inputMode="text"
          maxLength={16}
          autoCapitalize="characters"
          className={cx(shared.className, 'max-w-[14rem] tracking-[0.12em] uppercase')}
        />
      )}
      <Hint id={hintId} hint={hint} />
      <FieldError id={errorId} error={error} />
    </div>
  );
}

/**
 * A native select. `value` with `onValue` makes it controlled: React resets an uncontrolled form
 * after its action, and a select (unlike an input) then falls back to the option it first rendered
 * with, so a choice made before a failed submit would be lost (finding H2).
 */
export function SelectField({
  form,
  name,
  label,
  state,
  hint,
  optional,
  autoFocus,
  autoComplete,
  value,
  onValue,
  className,
  children,
}: BaseFieldProps & {
  autoComplete: string;
  value: string;
  onValue: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const ref = useRef<HTMLSelectElement>(null);
  const hydrated = useRef(false);
  useEffect(() => {
    const select = ref.current;
    if (!select) return;
    if (!hydrated.current) {
      hydrated.current = true;
      // A choice made before the page became interactive: hydration keeps it in the DOM, so the
      // state takes it over (overwriting it would undo what the person picked).
      if (select.value !== value) onValue(select.value);
      return;
    }
    // The reset React does after an action (form.reset()) also moves a controlled select back to
    // its first option, after React has rendered the new state: put the chosen value back.
    if (select.value !== value) select.value = value;
  }, [state, value, onValue]);
  return (
    <div data-field="" className={cx('grid grid-cols-[minmax(0,1fr)] content-start gap-1.5', className)}>
      <FieldLabel id={id} label={label} optional={optional} />
      <div className="relative">
        <select
          ref={ref}
          id={id}
          name={name}
          autoComplete={autoComplete}
          required={!optional}
          value={value}
          onChange={(event) => onValue(event.currentTarget.value)}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          aria-describedby={describedBy(hintId, error && errorId)}
          className={cx(fieldClassName, 'appearance-none pr-11')}
        >
          {children}
        </select>
        <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
      </div>
      <Hint id={hintId} hint={hint} />
      <FieldError id={errorId} error={error} />
    </div>
  );
}

/**
 * A checkbox that is never ticked in advance; the whole row is the 44 px target. Its error sits
 * above the row, inside the same bordered block, so it is plainly the message of that box.
 */
export function CheckboxField({
  form,
  name,
  label,
  state,
  hint,
  autoFocus,
  required,
}: Omit<BaseFieldProps, 'optional'> & { required?: boolean }) {
  const id = fieldId(form, name);
  const error = state.status === 'error' ? state.fields?.[name] : undefined;
  const errorId = `${id}-error`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div data-field="" className={cx('grid grid-cols-[minmax(0,1fr)] content-start', error && 'my-1 border-l-4 border-danger pt-2 pl-3')}>
      <FieldError id={errorId} error={error} />
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
            aria-describedby={describedBy(error && errorId, hintId)}
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
      {/* Outside the label, so it describes the box without becoming part of its name; below the
          label's 44 px, never over it (fix round 3, screens-9). */}
      {hint ? (
        <p id={hintId} className="pb-1 pl-9 text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The submit button of a form: the red primary action, or `secondary` for a second form on a page
 * that already has its primary action (red only for the one primary action, docs/design/direction.md).
 */
export function SubmitButton({
  pending,
  children,
  pendingLabel,
  variant = 'primary',
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cx(buttonVariants({ variant, size: 'lg' }), 'w-full sm:w-auto sm:min-w-48')}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * The text under the heading of an outcome that replaced the form (FrameHeader with
 * `id={doneId(form)}`): what happened and the next steps, announced politely.
 */
export function DoneText({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="grid max-w-[52ch] gap-3 text-base text-fg-muted">
      {children}
    </div>
  );
}
