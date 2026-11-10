'use client';

// The answer of one trial lesson request (M21, docs/adr/0024-trial-lessons.md): a reply or reason
// (optional), then "Answer" (the reply reaches the sender as a notice), "Decline" (the text is the
// reason) or "Close". An answered request offers only "Close". One form per request with a fixed id,
// so a post without JavaScript comes back to it. A thin Server Action (../../actions.ts).

import { useActionState } from 'react';

import { FormMessage, useFocusOnError } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { type FormState, IDLE } from '@/lib/form-state';
import { decideTrialAction } from '../../actions';
import { trialForm } from '../../form-ids';

function Decision({ value, children, variant, pending }: { value: 'answer' | 'decline' | 'close'; children: React.ReactNode; variant: 'primary' | 'secondary' | 'danger'; pending: boolean }) {
  return (
    <button
      type="submit"
      name="decision"
      value={value}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cx(buttonVariants({ variant }), 'w-full sm:w-auto')}
      data-testid={`trial-${value}`}
    >
      {children}
    </button>
  );
}

export function InquiryActions({
  schoolId,
  inquiryId,
  status,
  sender,
  replyMax,
  initial,
}: {
  schoolId: string;
  inquiryId: string;
  status: 'open' | 'answered';
  sender: string;
  replyMax: number;
  initial: FormState | null;
}) {
  const form = trialForm(inquiryId);
  const [state, action, pending] = useActionState(decideTrialAction, initial ?? IDLE);
  useFocusOnError(form, state);
  return (
    <form id={form} action={action} className="grid gap-3" aria-label={`Answer ${sender}`} data-testid="trial-actions">
      <FormMessage form={form} state={state} single />
      <input type="hidden" name="schoolId" value={schoolId} />
      <input type="hidden" name="inquiryId" value={inquiryId} />
      {status === 'open' ? (
        <TextAreaField
          form={form}
          name="reply"
          label="Reply or reason"
          state={state}
          optional
          maxLength={replyMax}
          rows={3}
          hint="Sent to them with Answer or Decline: a time to come, what to bring, or why not."
        />
      ) : null}
      <div className="flex flex-wrap gap-3">
        {status === 'open' ? (
          <>
            <Decision value="answer" variant="secondary" pending={pending}>
              Answer
            </Decision>
            <Decision value="decline" variant="danger" pending={pending}>
              Decline
            </Decision>
          </>
        ) : null}
        <Decision value="close" variant="secondary" pending={pending}>
          Close
        </Decision>
      </div>
    </form>
  );
}
