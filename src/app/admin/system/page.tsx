// /admin/system (milestone M12; plan §3.1 "Наблюдение", §3.3): the state of the local run for staff
// whose session passed the second factor: the depth of the job queue, failed jobs, failed e-mail
// deliveries and the time of the last local backup (scripts/backup-local.sh). It reads
// system.status, the same procedure /api/v1/admin/system serves (plan §6.8). Counts, queue names
// and times only: nothing here names a person (plan §6.4).
//
// A signed-in account without a staff role sees the explicit denied state; a staff session without
// the second factor is sent to verify it (guardRoute; the policy of /admin, staff2fa, covers it). A plain page: no JavaScript of its own, and
// "Refresh" is a link to itself. The numbers change from one visit to the next, so they carry
// data-volatile (masked in the visual regression).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { SystemStatus } from '@/server/services/system';

export const instant = false;

export const metadata: Metadata = {
  title: 'System status',
  robots: { index: false },
};

const PATH = '/admin/system';

/** "02:03 UTC". */
function formatClock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** "1 November 2026, 02:03 UTC". */
function formatTime(iso: string): string {
  return `${formatDay(iso)}, ${formatClock(iso)}`;
}

/** "under a minute", "12 min", "3 h 5 min". */
function formatWait(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A ready job older than this, or any failure, needs a look (text and shape, never colour alone). */
const STALE_SECONDS = 15 * 60;

function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">{children}</div>;
}

/** "Needs attention" or "OK", as text with a shape (plan §5.8: status never by colour alone). */
function Verdict({ attention, testId }: { attention: boolean; testId: string }) {
  return attention ? (
    <span data-testid={testId} data-state="attention" className="inline-flex items-center gap-1.5 text-sm font-semibold">
      <AlertIcon size={16} className="shrink-0 text-danger" />
      Needs attention
    </span>
  ) : (
    <span data-testid={testId} data-state="ok" className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
      <CheckIcon size={16} className="shrink-0" />
      OK
    </span>
  );
}

function Summary({ status }: { status: SystemStatus }) {
  const backup = status.backup.latest;
  const cells: { label: string; value: ReactNode; testId: string; note: string }[] = [
    { label: 'Waiting jobs', value: status.queue.waiting, testId: 'queue-depth', note: `${status.queue.ready} ready to run now` },
    { label: 'Failed jobs', value: status.queue.failed, testId: 'failed-jobs', note: 'after their last retry' },
    { label: 'Failed e-mail deliveries', value: status.email.failed, testId: 'failed-email-deliveries', note: `${status.email.waiting} still to send` },
    {
      label: 'Last backup',
      value: backup ? formatDay(backup.createdAt) : 'None yet',
      testId: 'last-backup',
      note: backup ? formatClock(backup.createdAt) : 'scripts/backup-local.sh',
    },
  ];
  return (
    <dl className="mt-8 grid grid-cols-1 gap-x-6 gap-y-5 border-t border-border-subtle pt-6 sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.testId} className="grid content-start gap-1">
          <dt className="text-sm text-fg-muted">{cell.label}</dt>
          <dd data-testid={cell.testId} data-volatile className="font-display text-feature leading-none tabular-nums">
            {cell.value}
          </dd>
          <dd data-volatile className="text-sm text-fg-muted [overflow-wrap:anywhere]">
            {cell.note}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ id, title, verdict, children }: { id: string; title: string; verdict?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4 border-t border-border-subtle pt-6" data-testid={`${id}-section`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-heading`} className="font-display text-2xl">
          {title}
        </h2>
        {verdict}
      </div>
      {children}
    </section>
  );
}

function QueueSection({ status }: { status: SystemStatus }) {
  const attention = status.queue.queues.some((q) => q.failed > 0 || (q.oldestReadySeconds ?? 0) > STALE_SECONDS);
  return (
    <Section id="queues" title="Job queue" verdict={<Verdict attention={attention} testId="queue-verdict" />}>
      <p className="max-w-[60ch] text-ui text-fg-muted">
        The worker takes jobs as they become ready: e-mail, the daily erasure of old addresses, search keys and lineage counters. A job
        that waits long means the worker is stopped or cannot keep up.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="queue-list">
        {status.queue.queues.map((q) => {
          const stale = (q.oldestReadySeconds ?? 0) > STALE_SECONDS;
          return (
            <li key={q.queue} data-queue={q.queue} className="grid gap-3 rounded-sm border border-border-subtle p-4">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span translate="no" className="font-mono text-sm font-semibold [overflow-wrap:anywhere]">
                  {q.queue}
                </span>
                {q.failed > 0 || stale ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold">
                    <AlertIcon size={14} className="shrink-0 text-danger" />
                    {q.failed > 0 ? 'Has failed jobs' : 'Waiting long'}
                  </span>
                ) : null}
              </p>
              <dl className="grid grid-cols-4 gap-2 text-sm">
                {(
                  [
                    ['Waiting', q.waiting],
                    ['Ready', q.ready],
                    ['Running', q.active],
                    ['Failed', q.failed],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="grid gap-0.5">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd data-volatile data-count={label.toLowerCase()} className="font-semibold tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {q.oldestReadySeconds !== null ? (
                <p data-volatile className="text-sm text-fg-muted">
                  Oldest ready job: waiting {formatWait(q.oldestReadySeconds)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2">
        <h3 className="text-ui font-semibold">Recent failed jobs</h3>
        {status.queue.recentFailures.length === 0 ? (
          <p className="text-ui text-fg-muted" data-testid="no-failed-jobs">
            None. A failed job is kept for its queue&apos;s retention period, then deleted.
          </p>
        ) : (
          <ul className="grid border-b border-border-subtle" data-testid="failed-job-list">
            {status.queue.recentFailures.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-subtle py-2 text-sm">
                <span translate="no" className="font-mono font-semibold">
                  {job.queue}
                </span>
                <span data-volatile className="text-fg-muted">
                  {job.failedAt ? `failed ${formatTime(job.failedAt)}` : 'failed'} · {plural(job.attempts, 'attempt', 'attempts')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function EmailSection({ status }: { status: SystemStatus }) {
  const { failed, waiting, lastFailedAt } = status.email;
  return (
    <Section id="email" title="E-mail" verdict={<Verdict attention={failed > 0} testId="email-verdict" />}>
      <p data-volatile className="max-w-[60ch] text-ui">
        {failed === 0
          ? 'No delivery has failed for good.'
          : `${plural(failed, 'e-mail', 'e-mails')} could not be delivered after every retry${lastFailedAt ? `; the last attempt was on ${formatTime(lastFailedAt)}` : ''}.`}{' '}
        {waiting === 0 ? 'Nothing waits to be sent.' : `${plural(waiting, 'e-mail waits', 'e-mails wait')} to be sent.`}
      </p>
      <p className="max-w-[60ch] text-sm text-fg-muted">Locally every message goes to Mailpit or to files; none leaves the machine.</p>
    </Section>
  );
}

function BackupSection({ status }: { status: SystemStatus }) {
  const { latest, count } = status.backup;
  return (
    <Section id="backup" title="Local backup" verdict={<Verdict attention={!latest || !latest.hasChecksum} testId="backup-verdict" />}>
      {latest ? (
        <dl className="grid gap-x-6 gap-y-3 text-ui sm:grid-cols-[max-content_1fr]">
          <dt className="text-fg-muted">Made</dt>
          <dd data-volatile data-testid="last-backup-time">
            <time dateTime={latest.createdAt}>{formatTime(latest.createdAt)}</time>
          </dd>
          <dt className="text-fg-muted">File</dt>
          <dd data-volatile translate="no" className="font-mono text-sm [overflow-wrap:anywhere]">
            {latest.file} ({formatSize(latest.sizeBytes)})
          </dd>
          <dt className="text-fg-muted">Checksum</dt>
          <dd data-volatile>{latest.hasChecksum ? 'SHA-256 file present' : 'SHA-256 file missing: make a new backup'}</dd>
          <dt className="text-fg-muted">Kept</dt>
          <dd data-volatile>{plural(count, 'archive', 'archives')} of this database (the newest 14 are kept)</dd>
        </dl>
      ) : (
        <p className="max-w-[60ch] text-ui" data-testid="no-backup">
          There is no backup of this database yet. Make one with <code className="font-mono text-sm">scripts/backup-local.sh</code>; the
          administration guide explains it and the weekly restore drill.
        </p>
      )}
      <p className="max-w-[60ch] text-sm text-fg-muted">
        Until hosting is decided, everything since the last backup can be lost (the recovery point); a restore takes at most 4 hours.
      </p>
    </Section>
  );
}

export default async function SystemPage() {
  const guard = await guardRoute(PATH);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Column>
        <div className="max-w-[46rem]" data-testid="system-denied">
          <p className="eyebrow">Administration</p>
          <h1 className="mt-2 font-display text-feature">Not available</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">
            You don&apos;t have access to the system status. It is available to moderators, archivists and administrators.
          </p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              Back to your account
            </Link>
          </p>
        </div>
      </Column>
    );
  }
  const status = await pageRead(serverClient(await headers(), guard.principal).system.status());
  if (!status) {
    return (
      <LoadError
        eyebrow="Administration"
        title="System status"
        message="We couldn't read the system status. Nothing was changed."
        back={{ href: '/admin', label: 'Back to administration' }}
        retryHref={PATH}
      />
    );
  }
  return (
    <Column>
      <header className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Administration
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">System status</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          The job queue, e-mail delivery and the local backup of this installation. Counts and times only: nothing here names a person.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Read on <span data-volatile data-testid="checked-at">{formatTime(status.checkedAt)}</span>.
        </p>
      </header>
      <Summary status={status} />
      <div className="mt-10 grid gap-10">
        <QueueSection status={status} />
        <EmailSection status={status} />
        <BackupSection status={status} />
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border-subtle pt-5 text-ui">
        <a href={PATH} className={buttonVariants({ variant: 'secondary' })} data-testid="system-refresh">
          Refresh
        </a>
        <Link href="/admin" className="link inline-flex min-h-11 items-center">
          Back to administration
        </Link>
      </div>
    </Column>
  );
}
