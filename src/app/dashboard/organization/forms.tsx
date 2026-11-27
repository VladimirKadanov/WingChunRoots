'use client';

// The forms of an organization's dashboard (milestone M15): its details, the admins, the members
// and the school links (the application is in ./apply/apply-form.tsx, the shared fields in
// ./organization-fields.tsx, so each page loads only its own forms' script). Each posts to a thin Server Action (./actions.ts) and
// works without JavaScript (src/server/forms/flash.ts). The services decide who may do what; these
// forms only show what the page's view says the account can do.

import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { SearchPick } from '@/components/ui/search-pick';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import {
  addOrganizationAdminAction,
  addOrganizationMemberAction,
  endOrganizationMemberAction,
  endOrganizationSchoolAction,
  removeOrganizationAdminAction,
  requestOrganizationSchoolAction,
  updateOrganizationAction,
  withdrawOrganizationRequestAction,
} from './actions';
import { ADD_ADMIN_FORM, ADD_MEMBER_FORM, DETAILS_FORM, REQUEST_SCHOOL_FORM } from './form-ids';
import { type Country, LABELS, type Option, OrganizationFields, type OrganizationValues } from './organization-fields';

/** The details of /dashboard/organization/<id>: the whole application while it waits, the website, leader and number of schools once approved. */
export function DetailsForm({
  organizationId,
  defaults,
  initial,
  countries,
  kinds,
  locked,
}: {
  organizationId: string;
  defaults: OrganizationValues;
  initial?: FormState | null;
  countries: readonly Country[];
  kinds: readonly Option[];
  locked: boolean;
}) {
  const [state, action, pending] = useActionState(updateOrganizationAction, initial ?? IDLE);
  const generatedId = useFormId(DETAILS_FORM);
  const formId = initial ? DETAILS_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="organization-details-form">
      <FormMessage form={formId} state={state} labels={LABELS} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <OrganizationFields formId={formId} state={state} defaults={defaults} countries={countries} kinds={kinds} locked={locked} />
      {/* ADR 0052: the organization's own words, on its public page once it is approved. */}
      <TextAreaField
        form={formId}
        name="about"
        label={LABELS.about}
        optional
        rows={6}
        maxLength={2000}
        hint="Shown on the organization’s public page: its history, what it teaches, how to join. Plain text."
        state={state}
        defaultValue={state.values?.about ?? defaults.about ?? ''}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…" variant="secondary">
          {locked ? 'Save details' : 'Save the application'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddAdminForm({ organizationId, initial }: { organizationId: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(addOrganizationAdminAction, initial ?? IDLE);
  const generatedId = useFormId(ADD_ADMIN_FORM);
  const formId = initial ? ADD_ADMIN_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="organization-add-admin">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="organizationId" value={organizationId} />
      <TextField form={formId} name="email" type="email" label="E-mail of the account" state={state} autoComplete="off" inputMode="email" maxLength={320} hint="The account at this address gets an invitation and becomes an admin once it accepts, within 14 days. An admin manages the details, members and schools; only an owner adds or removes admins." className="max-w-[28rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Adding…" variant="secondary">
          Add admin
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddMemberForm({ organizationId, roles, initial }: { organizationId: string; roles: readonly Option[]; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(addOrganizationMemberAction, initial ?? IDLE);
  const generatedId = useFormId(ADD_MEMBER_FORM);
  const formId = initial ? ADD_MEMBER_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="organization-add-member">
      <FormMessage form={formId} state={state} labels={{ personSlug: 'Public profile', role: 'Role', startsOn: 'Member since' }} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <TextField form={formId} name="personSlug" label="Public profile" state={state} autoComplete="off" maxLength={300} translate="no" placeholder="/people/…" hint="Find them by name, or paste the address of their public profile. Only public people are listed, once they accept (a record without an account, once the archive team agrees)." className="max-w-[32rem]" />
      {/* Role replay 2026-11-25 (P2-4): choose the person by name instead of typing an address. */}
      <SearchPick
        inputId={fieldId(formId, 'personSlug')}
        words={{ find: 'Find by name', dialog: 'Choose a member', hint: 'Type the person’s name in any spelling. Only public profiles are found.', chosen: 'Chosen: {name}' }}
      />
      <SelectField form={formId} name="role" label="Role" state={state} autoComplete="off" defaultValue={state.values?.role ?? 'member'} className="max-w-[16rem]">
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </SelectField>
      <TextField form={formId} name="startsOn" type="date" label="Member since" state={state} optional hint="Today or earlier. Leave it empty when not known." autoComplete="off" className="max-w-[14rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Adding…" variant="secondary">
          Add member
        </SubmitButton>
      </div>
    </form>
  );
}

export function RequestSchoolForm({ organizationId, initial }: { organizationId: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(requestOrganizationSchoolAction, initial ?? IDLE);
  const generatedId = useFormId(REQUEST_SCHOOL_FORM);
  const formId = initial ? REQUEST_SCHOOL_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="organization-request-school">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="organizationId" value={organizationId} />
      <TextField form={formId} name="schoolSlug" label="School’s public page" state={state} autoComplete="off" maxLength={300} translate="no" placeholder="/schools/…" hint="Find it by name or city, or paste the address of its page. The school’s account accepts or refuses. The school and its pin do not change either way." className="max-w-[32rem]" />
      <SearchPick
        inputId={fieldId(formId, 'schoolSlug')}
        kind="school"
        words={{ find: 'Find the school', dialog: 'Choose a school', hint: 'Type the school’s name or its city. Only listed schools are found.', chosen: 'Chosen: {name}' }}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Asking…" variant="secondary">
          Ask the school
        </SubmitButton>
      </div>
    </form>
  );
}

const ROW_ACTIONS = {
  admin: removeOrganizationAdminAction,
  member: endOrganizationMemberAction,
  school: endOrganizationSchoolAction,
  request: withdrawOrganizationRequestAction,
} as const;

/** A row's one-button form: remove an admin (or leave), end a membership, withdraw or end a school link. */
export function RowAction({
  kind,
  formId,
  hidden,
  label,
  pendingLabel,
  initial,
  testId,
  context,
}: {
  kind: keyof typeof ROW_ACTIONS;
  formId: string;
  hidden: Record<string, string>;
  label: string;
  pendingLabel: string;
  initial?: FormState | null;
  testId: string;
  /** Who or what the button acts on, for a screen reader (the row's name). */
  context: string;
}) {
  const [state, action, pending] = useActionState(ROW_ACTIONS[kind], initial ?? IDLE);
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} className="grid justify-items-start gap-2" data-testid={testId}>
      <FormMessage form={formId} state={state} single />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        className="link inline-flex min-h-11 items-center text-sm font-semibold"
      >
        {pending ? pendingLabel : label}
        <span className="sr-only">: {context}</span>
      </button>
    </form>
  );
}
