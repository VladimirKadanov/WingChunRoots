// The confirmations an account still owes for the current versions of the documents (milestone
// M02, In scope 4): on the onboarding form and on the consent-only form of /onboarding for an
// account that already has its profile. Never ticked in advance; the privacy notice tick stays
// optional. Rendered inside the client forms that import it.

import Link from 'next/link';

import { CONSENT_LABELS, CONSENT_ORDER, type ConsentName } from '@/components/account/consents';
import { CheckboxField } from '@/components/account/fields';
import type { FormState } from '@/lib/form-state';

/** The ticks to show: the missing required ones, and the privacy notice beside them. */
export function consentsToAsk(missingConsents: readonly string[]): ConsentName[] {
  return CONSENT_ORDER.filter((name) => missingConsents.includes(name) || (missingConsents.length > 0 && name === 'privacy_ack'));
}

export function MissingConsents({
  form,
  state,
  missingConsents,
  first,
  legend,
}: {
  form: string;
  state: FormState;
  missingConsents: readonly string[];
  first: string | null;
  legend: string;
}) {
  const ask = consentsToAsk(missingConsents);
  if (ask.length === 0) return null;
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 font-display text-2xl">{legend}</legend>
      <p className="mb-2 text-sm text-fg-muted">
        The <Link href="/legal/terms" className="link">terms of use</Link> or the{' '}
        <Link href="/legal/privacy" className="link">privacy notice</Link> changed since you joined, or your account was created without
        them.
      </p>
      {ask.map((name) => {
        const required = missingConsents.includes(name);
        return (
          <div key={name}>
            {required ? <input type="hidden" name="requiredConsent" value={name} /> : null}
            <CheckboxField
              form={form}
              name={name}
              label={
                <>
                  {CONSENT_LABELS[name]}
                  {required ? null : <span className="text-fg-muted"> (optional)</span>}
                </>
              }
              required={required}
              state={state}
              autoFocus={first === name}
            />
          </div>
        );
      })}
    </fieldset>
  );
}
