'use client';

// The e-mail settings of the notices on /account/notifications (milestone M18, In scope 3; on
// /dashboard/settings until the usability review of 2026-11): one checkbox per category that can
// be switched off; security and account are listed as always sent, with no control. Works without
// JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { setNotificationEmailsAction } from './actions';
import { NOTIFICATIONS_FORM } from './form-ids';

export interface EmailCategory {
  category: string;
  label: string;
  description: string;
  email: boolean;
  locked: boolean;
}

/** "E-mail me about": one checkbox per category; a plain form without JavaScript too. */
export function NotificationEmailsForm({ categories, initial }: { categories: readonly EmailCategory[]; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(setNotificationEmailsAction, initial ?? IDLE);
  const form = NOTIFICATIONS_FORM;
  useFocusOnError(form, state);
  const open = categories.filter((c) => !c.locked);
  const locked = categories.filter((c) => c.locked);
  return (
    <form id={form} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="notification-emails-form">
      <FormMessage form={form} state={state} single />
      <fieldset className="grid gap-1">
        <legend className="text-ui font-semibold">E-mail me about</legend>
        <ul className="grid">
          {open.map((c) => {
            const name = `email:${c.category}`;
            // The account's stored choice (or the category's default, DEFAULT M18 question 1), shown as it is.
            const emailOn = state.values?.[name] ? state.values[name] === 'on' : c.email;
            const id = `${form}-${c.category}`;
            return (
              <li key={c.category} className="border-b border-border-subtle py-2 last:border-b-0">
                {/* The whole row is the label: a touch target of at least 44 px (CLAUDE.md §10). */}
                <label htmlFor={id} className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-1.5">
                  <input
                    id={id}
                    type="checkbox"
                    name={name}
                    defaultChecked={emailOn}
                    // Remounted with the saved value, so a refused save shows what is stored.
                    key={`${c.category}-${String(emailOn)}`}
                    className="mt-0.5 size-5 shrink-0 cursor-pointer accent-fg"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-ui font-semibold">{c.label}</span>
                    <span className="text-sm text-fg-muted">{c.description}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="grid gap-1.5">
        <p className="text-ui font-semibold">Always e-mailed</p>
        <ul className="grid gap-1.5" data-testid="locked-categories">
          {locked.map((c) => (
            <li key={c.category} className="text-sm">
              <span className="font-semibold">{c.label}:</span> <span className="text-fg-muted">{c.description}</span>
            </li>
          ))}
        </ul>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          These tell you about changes to your account and cannot be switched off. Every notice also appears in your dashboard, whatever you
          choose here.
        </p>
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save e-mail settings
        </SubmitButton>
      </div>
    </form>
  );
}
