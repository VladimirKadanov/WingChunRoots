'use client';

// The forms of an organization's dashboard (milestone M15): the application, its details, the
// admins, the members and the school links. Each posts to a thin Server Action (./actions.ts) and
// works without JavaScript (src/server/forms/flash.ts). The services decide who may do what; these
// forms only show what the page's view says the account can do.

import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { EvidenceUploader, type UploadedEvidenceItem } from '@/components/evidence/uploader';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { discardEvidenceAction } from '../teachers/historical/actions';
import {
  addOrganizationAdminAction,
  addOrganizationMemberAction,
  applyOrganizationAction,
  endOrganizationMemberAction,
  endOrganizationSchoolAction,
  removeOrganizationAdminAction,
  requestOrganizationSchoolAction,
  updateOrganizationAction,
} from './actions';
import { ADD_ADMIN_FORM, ADD_MEMBER_FORM, APPLY_FORM, DETAILS_FORM, REQUEST_SCHOOL_FORM } from './form-ids';

type Option = { value: string; label: string };
type Country = { code: string; name: string };

const LABELS = {
  name: 'Official name',
  kind: 'Kind of organization',
  leaderName: 'Leader’s name',
  leaderTitle: 'Leader’s title',
  websiteUrl: 'Website',
  countryCode: 'Country of the headquarters',
  schoolsEstimate: 'Approximate number of schools',
  evidenceIds: 'Supporting document',
  note: 'Note for the reviewers',
};

export interface OrganizationValues {
  name: string;
  kind: string;
  leaderName: string;
  leaderTitle: string;
  websiteUrl: string;
  countryCode: string;
  schoolsEstimate: string;
}

/** The application's fields. `locked`: an approved organization keeps its name, kind and country (a new review would change them). */
function OrganizationFields({
  formId,
  state,
  defaults,
  countries,
  kinds,
  locked,
}: {
  formId: string;
  state: FormState;
  defaults: OrganizationValues | null;
  countries: readonly Country[];
  kinds: readonly Option[];
  locked: boolean;
}) {
  const value = (name: keyof OrganizationValues) => state.values?.[name] ?? defaults?.[name] ?? '';
  return (
    <>
      {locked && defaults ? (
        <div className="grid gap-1 text-ui" data-testid="organization-locked">
          <input type="hidden" name="name" value={defaults.name} />
          <input type="hidden" name="kind" value={defaults.kind} />
          <input type="hidden" name="countryCode" value={defaults.countryCode} />
          <p>
            <span className="text-fg-muted">Official name: </span>
            <span className="font-semibold">{defaults.name}</span>
          </p>
          <p className="max-w-[60ch] text-sm text-fg-muted">
            The reviewers approved the name, kind and country. To change them, write to the administrators: a change is reviewed again.
          </p>
        </div>
      ) : (
        <>
          <TextField form={formId} name="name" label={LABELS.name} state={state} autoComplete="organization" maxLength={160} defaultValue={value('name')} hint="In Latin letters, as the organization is registered." className="max-w-[40rem]" />
          <SelectField form={formId} name="kind" label={LABELS.kind} state={state} autoComplete="off" defaultValue={value('kind')} className="max-w-[24rem]">
            <option value="">Choose…</option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </SelectField>
          <SelectField form={formId} name="countryCode" label={LABELS.countryCode} state={state} autoComplete="country" defaultValue={value('countryCode')} className="max-w-[24rem]">
            <option value="">Choose…</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </>
      )}
      <TextField form={formId} name="leaderName" label={LABELS.leaderName} state={state} autoComplete="off" maxLength={120} defaultValue={value('leaderName')} translate="no" hint="In Latin letters. For the reviewers and your admins; the public page shows a leader only as a listed member with a public profile." className="max-w-[40rem]" />
      <TextField form={formId} name="leaderTitle" label={LABELS.leaderTitle} state={state} optional autoComplete="off" maxLength={80} defaultValue={value('leaderTitle')} hint="For example President or Chief instructor." className="max-w-[24rem]" />
      <TextField form={formId} name="websiteUrl" label={LABELS.websiteUrl} state={state} optional autoComplete="url" maxLength={300} defaultValue={value('websiteUrl')} placeholder="https://" translate="no" className="max-w-[40rem]" />
      <TextField form={formId} name="schoolsEstimate" label={LABELS.schoolsEstimate} state={state} autoComplete="off" inputMode="numeric" maxLength={6} defaultValue={value('schoolsEstimate')} hint="A whole number; 0 when the organization has none yet." className="max-w-[12rem]" />
    </>
  );
}

function filesFrom(values: Record<string, string> | undefined): UploadedEvidenceItem[] {
  try {
    const list = JSON.parse(values?.evidence ?? '[]') as UploadedEvidenceItem[];
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

/** The application of /dashboard/organization/apply. */
export function ApplyForm({ idempotencyKey, initial, countries, kinds }: { idempotencyKey: string; initial?: FormState | null; countries: readonly Country[]; kinds: readonly Option[] }) {
  const [state, action, pending] = useActionState(applyOrganizationAction, initial ?? IDLE);
  const generatedId = useFormId(APPLY_FORM);
  const formId = initial ? APPLY_FORM : generatedId;
  useFocusOnError(formId, state);
  const files = filesFrom(state.status === 'error' ? state.values : initial?.values);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6" data-testid="organization-apply-form">
      <FormMessage form={formId} state={state} labels={LABELS} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <OrganizationFields formId={formId} state={state} defaults={null} countries={countries} kinds={kinds} locked={false} />
      <div className="grid gap-2">
        <p className="text-sm font-semibold">
          {LABELS.evidenceIds} <span className="font-normal text-fg-muted">(optional)</span>
        </p>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          A registration, a charter or another document that shows the organization exists. Only you, the reviewers and the administrators can open it; it is never public.
        </p>
        <EvidenceUploader
          label="Add files"
          hint="JPEG, PNG, WebP or PDF, up to 20 MB each, at most 20 files."
          initial={files}
          discard={discardEvidenceAction}
          inputId={fieldId(formId, 'evidenceIds')}
          error={state.status === 'error' ? state.fields?.evidenceIds : undefined}
        />
      </div>
      <TextAreaField form={formId} name="note" label={LABELS.note} optional maxLength={2000} hint="Anything that helps the reviewers. Never public." state={state} className="max-w-[40rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the application
        </SubmitButton>
      </div>
    </form>
  );
}

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
      <TextField form={formId} name="email" type="email" label="E-mail of the account" state={state} autoComplete="off" inputMode="email" maxLength={320} hint="The account must exist already. An admin manages the details, members and schools; only an owner adds or removes admins." className="max-w-[28rem]" />
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
      <TextField form={formId} name="personSlug" label="Public profile" state={state} autoComplete="off" maxLength={300} translate="no" placeholder="/people/…" hint="The address of the person’s public profile. Only public people are listed." className="max-w-[32rem]" />
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
      <TextField form={formId} name="schoolSlug" label="School’s public page" state={state} autoComplete="off" maxLength={300} translate="no" placeholder="/schools/…" hint="The school’s account accepts or refuses. The school and its pin do not change either way." className="max-w-[32rem]" />
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
