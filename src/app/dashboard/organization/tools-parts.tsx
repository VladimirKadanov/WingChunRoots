// Shared parts of the organization tool pages (milestone M24): the header with the way back to the
// organization, the "not found" of an organization (or import) the account does not administer, and
// the note when the Federation plan is needed. Server Components.

import Link from 'next/link';
import type { ReactNode } from 'react';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ToolPage({ organizationId, title, intro, children, testId }: { organizationId: string; title: string; intro: ReactNode; children: ReactNode; testId: string }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid={testId}>
      <p className="eyebrow">
        <Link href={`/dashboard/organization/${organizationId}`} className="link inline-flex min-h-11 items-center">
          Back to the organization
        </Link>
      </p>
      <h1 className="mt-2 font-display text-feature">{title}</h1>
      <div className="mt-3 max-w-[62ch] text-ui text-fg-muted">{intro}</div>
      <div className="mt-8 grid gap-10">{children}</div>
    </div>
  );
}

export function ToolNotFound({ what = 'organization' }: { what?: 'organization' | 'import' }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-not-found">
      <p className="eyebrow">
        <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
          Your organizations
        </Link>
      </p>
      <h1 className="mt-2 font-display text-feature">{what === 'import' ? 'Import not found' : 'Organization not found'}</h1>
      <p className="mt-3 max-w-[56ch] text-fg-muted">
        {what === 'import' ? 'There is no import at this address in an organization your account administers.' : 'There is no organization at this address that your account administers.'}
      </p>
    </div>
  );
}

/** The plan or the approval is missing (ENTITLEMENT_REQUIRED or CONFLICT): what the page needs, without urgency. */
export function ToolClosed({ organizationId, title, message }: { organizationId: string; title: string; message: string }) {
  return (
    <ToolPage organizationId={organizationId} title={title} intro={null} testId="organization-tool-closed">
      <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-tool-closed-note">
        {message}
      </p>
    </ToolPage>
  );
}

export function Section({ id, title, children, testId }: { id: string; title: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t border-border-subtle pt-6" data-testid={testId}>
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}
