'use client';

// The fields an organization's application and its details share (milestone M15), apart from the
// forms so that /dashboard/organization/apply and /dashboard/organization/<id> each load only
// their own forms' script.

import type { FormState } from '@/lib/form-state';
import { SelectField, TextField } from '@/components/account/fields';

export type Option = { value: string; label: string };
export type Country = { code: string; name: string };

export const LABELS = {
  name: 'Official name',
  kind: 'Kind of organization',
  leaderName: 'Leader’s name',
  leaderTitle: 'Leader’s title',
  websiteUrl: 'Website',
  countryCode: 'Country of the headquarters',
  schoolsEstimate: 'Approximate number of schools',
  about: 'About the organization',
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
  /** ADR 0052: the details form only (the application has its note for the reviewers). */
  about?: string;
}

/** The application's fields. `locked`: an approved organization keeps its name, kind and country (a new review would change them). */
export function OrganizationFields({
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

