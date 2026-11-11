'use client';

// The test checkout form (milestone M22): three test cards as radio cards, one button. No card
// number is typed or sent: the card is chosen by its behaviour. Works without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { IDLE, fieldId, type FormState } from '@/lib/form-state';
import { testPayAction } from './actions';
import { TEST_PAY_FORM } from './form-ids';

const BEHAVIOUR: Record<string, string> = {
  succeeds: 'The payment succeeds, and every renewal too.',
  declines: 'The card is declined. Nothing is created.',
  fails_at_renewal: 'The first payment succeeds; the renewal fails, which starts the 7-day grace period.',
};

export function TestPayForm({
  checkoutId,
  amount,
  cards,
  initial,
}: {
  checkoutId: string;
  amount: string;
  cards: { card: string; label: string; number: string }[];
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(testPayAction, initial ?? IDLE);
  useFocusOnError(TEST_PAY_FORM, state);
  const chosen = state.values?.card ?? 'succeeds';
  const error = state.status === 'error' ? state.fields?.card : undefined;
  return (
    <form id={TEST_PAY_FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5" data-testid="test-pay-form">
      <FormMessage form={TEST_PAY_FORM} state={state} single={false} labels={{ card: 'Test card' }} />
      <input type="hidden" name="checkoutId" value={checkoutId} />
      <fieldset className="grid gap-3" aria-describedby={error ? `${fieldId(TEST_PAY_FORM, 'card')}-error` : undefined}>
        <legend className="mb-1 text-ui font-semibold">Test card</legend>
        {error ? (
          <p id={`${fieldId(TEST_PAY_FORM, 'card')}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {cards.map((card, index) => (
          <label
            key={card.card}
            className={cx(
              'grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-sm border border-border-strong bg-surface-1 p-4',
              'has-[:checked]:border-fg has-[:checked]:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              'forced-colors:has-[:checked]:border-2 forced-colors:has-[:checked]:p-[15px]',
            )}
          >
            <input
              type="radio"
              name="card"
              value={card.card}
              id={index === 0 ? fieldId(TEST_PAY_FORM, 'card') : undefined}
              defaultChecked={chosen === card.card}
              className={cx(
                'mt-1 grid size-5 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border-[1.5px] border-fg bg-surface-1 focus-visible:outline-none',
                'before:size-2.5 before:scale-0 before:rounded-full before:bg-fg checked:before:scale-100',
                'forced-colors:appearance-auto forced-colors:before:hidden',
              )}
            />
            <span className="grid gap-1">
              <span className="font-semibold">{card.label}</span>
              <span className="text-sm tabular text-fg-muted" translate="no">
                {card.number}
              </span>
              <span className="text-sm text-fg-muted">{BEHAVIOUR[card.card]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <SubmitButton pending={pending} pendingLabel="Paying with the test card…">
          Pay {amount} in test mode
        </SubmitButton>
      </div>
    </form>
  );
}
