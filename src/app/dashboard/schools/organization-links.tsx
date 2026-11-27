'use client';

// The organization links of a school's account on /dashboard/schools (milestone M15): an
// organization asked to link to a school, and the school's account accepts or refuses, or ends an
// accepted link. Thin Server Actions over organizations.answerSchoolLink and
// organizations.endSchoolLink; without JavaScript a failure comes back as a kept result
// (src/server/forms/flash.ts). The school and its pin never change (DEFAULT D12).

import { useActionState } from 'react';

import { FormMessage, useFocusOnError } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE } from '@/lib/form-state';
import { linkForm } from '../organization/form-ids';
import { answerInstructorAction, answerOrganizationLinkAction, endOrganizationLinkAction } from './actions';
import { instructorForm } from './form-ids';

export function LinkAnswer({ linkId, pending: waiting, context, initial }: { linkId: string; pending: boolean; context: string; initial: FormState | null }) {
  const [state, action, busy] = useActionState(waiting ? answerOrganizationLinkAction : endOrganizationLinkAction, initial ?? IDLE);
  const formId = linkForm(linkId);
  useFocusOnError(formId, state);
  const guard = (event: React.MouseEvent) => {
    if (busy) event.preventDefault();
  };
  return (
    <form id={formId} action={action} className="grid justify-items-start gap-2" data-testid="organization-link-answer">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="linkId" value={linkId} />
      <div className="flex flex-wrap gap-3">
        {waiting ? (
          <>
            <button type="submit" name="answer" value="accept" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="organization-link-accept">
              Accept<span className="sr-only">: {context}</span>
            </button>
            <button type="submit" name="answer" value="refuse" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="organization-link-refuse">
              Refuse<span className="sr-only">: {context}</span>
            </button>
          </>
        ) : (
          <button type="submit" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="organization-link-end">
            End link<span className="sr-only">: {context}</span>
          </button>
        )}
      </div>
    </form>
  );
}

/** Journey review P3-10 (ADR 0087): accept or decline a school's invitation to be listed as one of its instructors. */
export function InstructorAnswer({ schoolId, context, initial }: { schoolId: string; context: string; initial: FormState | null }) {
  const [state, action, busy] = useActionState(answerInstructorAction, initial ?? IDLE);
  const formId = instructorForm(schoolId);
  useFocusOnError(formId, state);
  const guard = (event: React.MouseEvent) => {
    if (busy) event.preventDefault();
  };
  return (
    <form id={formId} action={action} className="grid justify-items-start gap-2" data-testid="instructor-invitation-answer">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="schoolId" value={schoolId} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="answer" value="accept" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="instructor-invitation-accept">
          Accept<span className="sr-only">: {context}</span>
        </button>
        <button type="submit" name="answer" value="decline" aria-disabled={busy || undefined} onClick={guard} className={buttonVariants({ variant: 'secondary' })} data-testid="instructor-invitation-decline">
          Decline<span className="sr-only">: {context}</span>
        </button>
      </div>
    </form>
  );
}
