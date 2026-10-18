// The confirmations an account still owes for the current versions of the documents (milestone
// M02, In scope 4): on the onboarding form and on the consent-only form of /onboarding for an
// account that already has its profile. Names each document with its date and what changed in
// it. Never ticked in advance; the privacy notice tick stays optional. Rendered inside the client
// forms that import it.

import Link from 'next/link';

import { CONSENT_LABELS, CONSENT_ORDER, type ConsentName } from '@/components/account/consents';
import { CheckboxField } from '@/components/account/fields';
import type { FormState } from '@/lib/form-state';

/** What a form says about a document (src/server/legal/documents.ts, documentsFor). */
export interface DocumentNote {
  id: string;
  title: string;
  path: string;
  date: string;
  changes: string;
}

/** The ticks to show: the missing required ones, and the privacy notice beside them. */
export function consentsToAsk(missingConsents: readonly string[]): ConsentName[] {
  return CONSENT_ORDER.filter((name) => missingConsents.includes(name) || (missingConsents.length > 0 && name === 'privacy_ack'));
}

/** The hint under the optional privacy tick, with a link to the notice it records. */
function PrivacyTickHint() {
  return (
    <>
      You can continue without this tick. The{' '}
      <Link href="/legal/privacy" className="link">
        privacy notice
      </Link>{' '}
      applies either way; the tick records that you read this version.
    </>
  );
}

export function MissingConsents({
  form,
  state,
  missingConsents,
  documents,
  first,
  legend,
}: {
  form: string;
  state: FormState;
  missingConsents: readonly string[];
  documents: readonly DocumentNote[];
  first: string | null;
  legend: string;
}) {
  const ask = consentsToAsk(missingConsents);
  if (ask.length === 0) return null;
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 font-display text-2xl">{legend}</legend>
      <p className="text-sm text-fg-muted">Confirm the current version of {documents.length === 1 ? 'this document' : 'these documents'}:</p>
      <ul className="mb-3 grid gap-2 text-sm">
        {documents.map((document) => (
          <li key={document.id} className="border-l-2 border-border-strong pl-3">
            <Link href={document.path} className="link font-semibold">
              {document.title}
            </Link>
            <span className="text-fg-muted">, draft of {document.date}.</span>
            <span className="block text-fg-muted">What changed: {document.changes}</span>
          </li>
        ))}
      </ul>
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
              hint={required ? undefined : <PrivacyTickHint />}
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
