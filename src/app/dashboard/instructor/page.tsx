// /dashboard/instructor (milestone M10b, In scope 3; plan §6.5, DEFAULT D04/D13): a Sifu's
// instructor verification. A Sifu account chose its type itself (M08) and shows as "Instructor
// (unverified)" until an archivist or an administrator approves an instructor_verification case
// with evidence (the M10a upload and queue). The page shows the status in words, the newest case
// (its status, the reviewers' notes, the files, and while it waits, a field to add more files to
// it) and, when the Sifu may send one, the request form (instructor.request). The data comes from
// instructor.mine. Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { EvidenceUploader } from '@/components/evidence/uploader';
import { OutcomeNote } from '@/components/relationships/parts';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { INSTRUCTOR_FORM } from './form-ids';
import { InstructorRequestForm } from './request-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Instructor verification',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/instructor';

export default async function InstructorPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const view = await pageRead(serverClient(await headers(), guard.principal).instructor.mine());
  if (!view) return <LoadError {...REVIEW_LOAD_ERRORS.instructor} retryHref={PAGE} />;
  const initial = await readFormResult(INSTRUCTOR_FORM, query.outcome);
  const c = view.case;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Instructor verification</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          A Sifu account shows as “Instructor (unverified)” until the reviewers check evidence that you teach. You can approve students before that;
          the links you approve then say “Approved by an unverified instructor”.
        </p>
        <p className="mt-5 text-ui" data-testid="instructor-status" data-status={view.status}>
          <span className="text-fg-muted">Your status: </span>
          <span className="font-semibold">{view.label}</span>
        </p>

        <div className="mt-8 grid gap-8">
          {query.sent === '1' && c ? (
            <OutcomeNote testId="instructor-sent">Your evidence was sent. The reviewers check it; you get a notification and an e-mail when they decide.</OutcomeNote>
          ) : null}

          {c ? (
            <section aria-labelledby="instructor-case" className="grid gap-3 border-t border-border-subtle pt-6" data-testid="instructor-case" data-case-status={c.status}>
              <h2 id="instructor-case" className="font-display text-2xl">
                Your request
              </h2>
              <p className="text-sm font-semibold">{c.statusLabel}</p>
              {c.resolution === 'rejected' && c.reason ? (
                <p className="max-w-[60ch] text-sm whitespace-pre-line" data-testid="instructor-reason">
                  <span className="font-semibold">Reviewers: </span>
                  {c.reason}
                </p>
              ) : null}
              {c.messages.length > 0 ? (
                <ul className="grid gap-2 text-sm" data-testid="instructor-messages">
                  {c.messages.map((message, i) => (
                    <li key={i} className="grid gap-0.5">
                      <span className="font-semibold">{message.fromYou ? 'Your note' : 'The reviewers ask'}</span>
                      <span className="whitespace-pre-line">{message.body}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="grid gap-1 text-sm" data-testid="instructor-files">
                {c.files.map((file) => (
                  <li key={file.id}>
                    {file.href ? (
                      <a href={file.href} className="link inline-flex min-h-11 items-center" translate="no">
                        {file.name ?? `${file.kindLabel} file`}
                      </a>
                    ) : (
                      <span translate="no">{file.name ?? `${file.kindLabel} file`}</span>
                    )}{' '}
                    <span className="text-fg-muted">
                      · {file.kindLabel} · {formatSize(file.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
              {c.open ? (
                <EvidenceUploader
                  caseId={c.id}
                  knownIds={c.files.map((file) => file.id)}
                  label="Add evidence to this request"
                  hint="JPEG, PNG, WebP or PDF, up to 20 MB each. A file added to a request stays with it."
                />
              ) : null}
              {c.open ? (
                <p className="text-sm">
                  <Link href={`/dashboard/cases/${c.id}`} className="link inline-flex min-h-11 items-center">
                    Answer the reviewers
                  </Link>
                </p>
              ) : null}
            </section>
          ) : null}

          {view.canRequest ? (
            <section aria-labelledby="instructor-new" className="grid gap-4 border-t border-border-subtle pt-6">
              <h2 id="instructor-new" className="font-display text-2xl">
                {c ? 'Send new evidence' : 'Send evidence'}
              </h2>
              <InstructorRequestForm idempotencyKey={randomUUID()} initial={initial} />
            </section>
          ) : view.refusal && !c?.open ? (
            <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="instructor-refusal">
              {view.refusal}{' '}
              {view.accountType !== 'sifu' ? (
                <Link href="/dashboard/settings" className="link">
                  Account type and plan
                </Link>
              ) : !view.hasProfile ? (
                <Link href={`/onboarding?next=${encodeURIComponent(PAGE)}`} className="link">
                  Set up your profile
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
