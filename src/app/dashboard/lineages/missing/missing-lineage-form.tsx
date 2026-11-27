'use client';

// The form of "My lineage is not listed" (journey review 2026-11-26, P2-2): the name as the member
// writes it. `initial` is the outcome of a submit without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { reportMissingLineageAction } from './actions';
import { MISSING_LINEAGE_FORM } from './form-ids';

const LABELS = { name: 'Name of your lineage' };

export function MissingLineageForm({ next, initial }: { next: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(reportMissingLineageAction, initial ?? IDLE);
  const FORM = useFormId(MISSING_LINEAGE_FORM);
  useFocusOnError(FORM, state);
  return (
    <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="missing-lineage-form">
      <input type="hidden" name="next" value={next} />
      <FormMessage form={FORM} state={state} labels={LABELS} />
      <TextField
        form={FORM}
        name="name"
        label={LABELS.name}
        autoComplete="off"
        maxLength={120}
        hint="As your school calls it: any script is fine."
        state={state}
        defaultValue={state.status === 'done' ? '' : (state.values?.name ?? '')}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Tell the archivists
        </SubmitButton>
      </div>
    </form>
  );
}
