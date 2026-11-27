'use client';

// Accept or decline one request on /dashboard/naming (review 2026-11-13, ADR 0088).

import { useActionState } from 'react';

import { FormMessage, useFocusOnError } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE } from '@/lib/form-state';
import { answerNamingAction } from './actions';
import { namingForm } from './form-ids';

export function NamingAnswer({ id, context, initial }: { id: string; context: string; initial: FormState | null }) {
  const [state, action, busy] = useActionState(answerNamingAction, initial ?? IDLE);
  const formId = namingForm(id);
  useFocusOnError(formId, state);
  const guard = (event: React.MouseEvent) => {
    if (busy) event.preventDefault();
  };
  return (
    <form id={formId} action={action} className="grid justify-items-start gap-2" data-testid="naming-answer">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="answer" value="accept" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="naming-accept">
          Accept<span className="sr-only">: {context}</span>
        </button>
        <button type="submit" name="answer" value="decline" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="naming-decline">
          Decline<span className="sr-only">: {context}</span>
        </button>
      </div>
    </form>
  );
}
