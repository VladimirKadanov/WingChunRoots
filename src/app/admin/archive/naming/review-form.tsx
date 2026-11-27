'use client';

// Approve or decline one naming request on /admin/archive/naming (review 2026-11-13, ADR 0088).

import { useActionState } from 'react';

import { FormMessage, useFocusOnError } from '@/components/account/fields';
import { useAdminT } from '@/components/admin/i18n/client';
import { buttonVariants } from '@/components/ui/button-variants';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { reviewNamingAction } from './actions';
import { reviewNamingForm } from './form-ids';

const inputClass = 'min-h-11 w-full rounded-sm border border-border-strong bg-surface-1 px-3 py-2 text-ui';

export function ReviewNamingForm({ id, context, initial }: { id: string; context: string; initial: FormState | null }) {
  const t = useAdminT();
  const [state, action, busy] = useActionState(reviewNamingAction, initial ?? IDLE);
  const formId = reviewNamingForm(id);
  useFocusOnError(formId, state);
  const guard = (event: React.MouseEvent) => {
    if (busy) event.preventDefault();
  };
  return (
    <form id={formId} action={action} className="grid max-w-[40rem] gap-3" data-testid="naming-review">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-1.5">
        <label htmlFor={fieldId(formId, 'reason')} className="text-sm font-semibold">
          {t('Reason (optional, kept in the audit log)')}
        </label>
        <input id={fieldId(formId, 'reason')} name="reason" maxLength={500} defaultValue={state.values?.reason ?? ''} className={inputClass} />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="decision" value="approve" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="naming-approve">
          {t('Approve')}
          <span className="sr-only">: {context}</span>
        </button>
        <button type="submit" name="decision" value="decline" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="naming-decline">
          {t('Decline')}
          <span className="sr-only">: {context}</span>
        </button>
      </div>
    </form>
  );
}
