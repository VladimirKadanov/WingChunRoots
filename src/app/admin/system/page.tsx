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
//
// Control panel (docs/adr/0038-control-panel-pages.md): problems first. A box at the top lists what
// needs attention, in words, each linked to its section; the sections that need attention come
// before the ones that are fine, and within the queue the queues with failures or long waits first.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { SystemStatus } from '@/server/services/system';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('System status'), robots: { index: false } };
}

const PATH = '/admin/system';

/** "02:03 UTC". */
function formatClock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** "1 November 2026, 02:03 UTC". */
function formatTime(t: AdminT, iso: string): string {
  return `${t.day(iso)}, ${formatClock(iso)}`;
}

/** "under a minute", "12 min", "3 h 5 min". */
function formatWait(t: AdminT, seconds: number): string {
  if (seconds < 60) return t('under a minute');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('{minutes} min', { minutes });
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? t('{hours} h', { hours }) : t('{hours} h {minutes} min', { hours, minutes: minutes % 60 });
}

/** A ready job older than this, or any failure, needs a look (text and shape, never colour alone). */
const STALE_SECONDS = 15 * 60;

function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[80rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">{children}</div>;
}

/** "Needs attention" or "OK", as text with a shape (plan §5.8: status never by colour alone). */
function Verdict({ attention, testId, t }: { attention: boolean; testId: string; t: AdminT }) {
  return attention ? (
    <span data-testid={testId} data-state="attention" className="inline-flex items-center gap-1.5 text-sm font-semibold">
      <AlertIcon size={16} className="shrink-0 text-danger" />
      {t('Needs attention')}
    </span>
  ) : (
    <span data-testid={testId} data-state="ok" className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
      <CheckIcon size={16} className="shrink-0" />
      {t('OK')}
    </span>
  );
}

function Summary({ status, t }: { status: SystemStatus; t: AdminT }) {
  const backup = status.backup.latest;
  const cells: { label: string; value: ReactNode; testId: string; note: string }[] = [
    { label: t('Waiting jobs'), value: status.queue.waiting, testId: 'queue-depth', note: t('{count} ready to run now', { count: status.queue.ready }) },
    { label: t('Failed jobs'), value: status.queue.failed, testId: 'failed-jobs', note: t('after their last retry') },
    { label: t('Failed e-mail deliveries'), value: status.email.failed, testId: 'failed-email-deliveries', note: t('{count} still to send', { count: status.email.waiting }) },
    {
      label: t('Last backup'),
      value: backup ? t.day(backup.createdAt) : t('None yet'),
      testId: 'last-backup',
      note: backup ? formatClock(backup.createdAt) : 'scripts/backup-local.sh',
    },
  ];
  return (
    <dl className="mt-8 grid grid-cols-1 gap-x-6 gap-y-5 border-t border-border-subtle pt-6 sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.testId} className="grid content-start gap-1">
          <dt className="text-sm text-fg-muted">{cell.label}</dt>
          <dd
            data-testid={cell.testId}
            data-volatile
            className={cell.testId === 'last-backup' ? 'font-display text-2xl leading-tight' : 'font-display text-feature leading-none tabular-nums'}
          >
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
    <section id={id} aria-labelledby={`${id}-heading`} className="grid scroll-mt-4 gap-4 border-t border-border-subtle pt-6" data-testid={`${id}-section`}>
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

const queueAttention = (status: SystemStatus) => !status.worker.alive || status.queue.queues.some((q) => q.failed > 0 || (q.oldestReadySeconds ?? 0) > STALE_SECONDS);
const queueRank = (q: SystemStatus['queue']['queues'][number]) => (q.failed > 0 ? 0 : (q.oldestReadySeconds ?? 0) > STALE_SECONDS ? 1 : 2);

function QueueSection({ status, t }: { status: SystemStatus; t: AdminT }) {
  const attention = queueAttention(status);
  return (
    <Section id="queues" title={t('Job queue')} verdict={<Verdict attention={attention} testId="queue-verdict" t={t} />}>
      <p className="max-w-[60ch] text-ui text-fg-muted">
        {t('The worker takes jobs as they become ready: e-mail, the daily erasure of old addresses, search keys and lineage counters. A job that waits long means the worker is stopped or cannot keep up.')}
      </p>
      <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-ui" data-testid="worker-heartbeat" data-state={status.worker.alive ? 'ok' : 'attention'}>
        {status.worker.alive ? <CheckIcon size={16} className="shrink-0" /> : <AlertIcon size={16} className="shrink-0 text-danger" />}
        <span data-volatile>
          {status.worker.lastBeat === null
            ? t('The worker has not reported yet: it is not running.')
            : status.worker.alive
              ? t('The worker is running: last seen {time}.', { time: formatTime(t, status.worker.lastBeat) })
              : t('The worker has stopped: last seen {time}.', { time: formatTime(t, status.worker.lastBeat) })}
        </span>
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="queue-list">
        {[...status.queue.queues].sort((a, b) => queueRank(a) - queueRank(b)).map((q) => {
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
                    {q.failed > 0 ? t('Has failed jobs') : t('Waiting long')}
                  </span>
                ) : null}
              </p>
              <dl className="grid grid-cols-4 gap-2 text-sm">
                {(
                  [
                    ['Waiting', t('Waiting'), q.waiting],
                    ['Ready', t('Ready'), q.ready],
                    ['Running', t('Running'), q.active],
                    ['Failed', t('Failed'), q.failed],
                  ] as const
                ).map(([label, text, value]) => (
                  <div key={label} className="grid gap-0.5">
                    <dt className="text-fg-muted">{text}</dt>
                    <dd data-volatile data-count={label.toLowerCase()} className="font-semibold tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {q.oldestReadySeconds !== null ? (
                <p data-volatile className="text-sm text-fg-muted">
                  {t('Oldest ready job: waiting {wait}', { wait: formatWait(t, q.oldestReadySeconds) })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2">
        <h3 className="text-ui font-semibold">{t('Recent failed jobs')}</h3>
        {status.queue.recentFailures.length === 0 ? (
          <p className="text-ui text-fg-muted" data-testid="no-failed-jobs">
            {t("None. A failed job is kept for its queue's retention period, then deleted.")}
          </p>
        ) : (
          <ul className="grid border-b border-border-subtle" data-testid="failed-job-list">
            {status.queue.recentFailures.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-subtle py-2 text-sm">
                <span translate="no" className="font-mono font-semibold">
                  {job.queue}
                </span>
                <span data-volatile className="text-fg-muted">
                  {job.failedAt ? t('failed {time}', { time: formatTime(t, job.failedAt) }) : t('failed')} · {t.n(job.attempts, '{n} attempt', '{n} attempts')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function EmailSection({ status, t }: { status: SystemStatus; t: AdminT }) {
  const { failed, waiting, lastFailedAt } = status.email;
  return (
    <Section id="email" title={t('E-mail')} verdict={<Verdict attention={failed > 0} testId="email-verdict" t={t} />}>
      <p data-volatile className="max-w-[60ch] text-ui">
        {failed === 0
          ? t('No delivery has failed for good.')
          : lastFailedAt
            ? t.n(failed, '{n} e-mail could not be delivered after every retry; the last attempt was on {time}.', '{n} e-mails could not be delivered after every retry; the last attempt was on {time}.', { time: formatTime(t, lastFailedAt) })
            : t.n(failed, '{n} e-mail could not be delivered after every retry.', '{n} e-mails could not be delivered after every retry.')}{' '}
        {waiting === 0 ? t('Nothing waits to be sent.') : t.n(waiting, '{n} e-mail waits to be sent.', '{n} e-mails wait to be sent.')}
      </p>
      <p className="max-w-[60ch] text-sm text-fg-muted">{t('Locally every message goes to Mailpit or to files; none leaves the machine.')}</p>
    </Section>
  );
}

/** An archive older than this needs a look: the backup routine may have stopped. */
const BACKUP_STALE_MS = 8 * 24 * 60 * 60 * 1000;

const backupStale = (status: SystemStatus) => status.backup.latest !== null && Date.parse(status.checkedAt) - Date.parse(status.backup.latest.createdAt) > BACKUP_STALE_MS;

/** What needs a look, in words, each with the section it is in; empty when all is well. */
function problemsOf(t: AdminT, status: SystemStatus): { section: 'queues' | 'email' | 'backup'; text: string }[] {
  const problems: { section: 'queues' | 'email' | 'backup'; text: string }[] = [];
  if (!status.worker.alive) problems.push({ section: 'queues', text: t('The worker is not running: no e-mail is sent and the queue does not move.') });
  const failedQueues = status.queue.queues.filter((q) => q.failed > 0);
  if (failedQueues.length > 0) {
    const queues = t.n(failedQueues.length, '{n} queue', '{n} queues');
    problems.push({ section: 'queues', text: t.n(status.queue.failed, '{n} job failed after the last retry, in {queues}.', '{n} jobs failed after the last retry, in {queues}.', { queues }) });
  }
  const slow = status.queue.queues.filter((q) => (q.oldestReadySeconds ?? 0) > STALE_SECONDS);
  if (slow.length > 0) problems.push({ section: 'queues', text: t.n(slow.length, '{n} queue has a ready job waiting over 15 minutes: the worker may be stopped.', '{n} queues have a ready job waiting over 15 minutes: the worker may be stopped.') });
  if (status.email.failed > 0) problems.push({ section: 'email', text: t.n(status.email.failed, '{n} e-mail could not be delivered.', '{n} e-mails could not be delivered.') });
  const latest = status.backup.latest;
  if (!latest) problems.push({ section: 'backup', text: t('There is no backup of this database yet.') });
  else if (!latest.hasChecksum) problems.push({ section: 'backup', text: t('The last backup has no checksum file.') });
  else if (backupStale(status)) problems.push({ section: 'backup', text: t('The last backup is older than a week.') });
  return problems;
}

function Problems({ status, t }: { status: SystemStatus; t: AdminT }) {
  const problems = problemsOf(t, status);
  return problems.length > 0 ? (
    <section aria-labelledby="problems-heading" className="mt-6 grid gap-3 rounded-md border-2 border-dashed border-danger bg-surface-1 p-5" data-testid="system-problems" data-state="attention">
      <h2 id="problems-heading" className="inline-flex items-center gap-2 font-display text-2xl">
        <AlertIcon size={22} className="shrink-0 text-danger" />
        {t.n(problems.length, '{n} thing needs attention', '{n} things need attention')}
      </h2>
      <ul className="grid gap-1 text-ui">
        {problems.map((p) => (
          <li key={p.text} data-volatile className="flex flex-wrap items-baseline gap-x-3">
            <span>{p.text}</span>
            <a href={`#${p.section}`} className="link inline-flex min-h-11 items-center text-sm">
              {t('Show it')}
            </a>
          </li>
        ))}
      </ul>
    </section>
  ) : (
    <p className="mt-6 inline-flex items-center gap-2 rounded-md border border-border-subtle bg-surface-1 px-4 py-3 text-ui" data-testid="system-problems" data-state="ok">
      <CheckIcon size={18} className="shrink-0" />
      {t('Nothing needs attention: the worker, the queue, e-mail and the backup are fine.')}
    </p>
  );
}

function BackupSection({ status, t }: { status: SystemStatus; t: AdminT }) {
  const { latest, count } = status.backup;
  const stale = backupStale(status);
  return (
    <Section id="backup" title={t('Local backup')} verdict={<Verdict attention={!latest || !latest.hasChecksum || stale} testId="backup-verdict" t={t} />}>
      {latest ? (
        <dl className="grid gap-x-6 gap-y-3 text-ui sm:grid-cols-[max-content_1fr]">
          <dt className="text-fg-muted">{t('Made')}</dt>
          <dd data-volatile data-testid="last-backup-time">
            <time dateTime={latest.createdAt}>{formatTime(t, latest.createdAt)}</time>
          </dd>
          <dt className="text-fg-muted">{t('File')}</dt>
          <dd data-volatile translate="no" className="font-mono text-sm [overflow-wrap:anywhere]">
            {latest.file} ({formatSize(latest.sizeBytes)})
          </dd>
          <dt className="text-fg-muted">{t('Checksum')}</dt>
          <dd data-volatile>{latest.hasChecksum ? t('SHA-256 file present') : t('SHA-256 file missing: make a new backup')}</dd>
          <dt className="text-fg-muted">{t('Kept')}</dt>
          <dd data-volatile>
            {t.n(count, '{n} archive of this database (backup-local.sh keeps the newest 14 unless BACKUP_KEEP says otherwise)', '{n} archives of this database (backup-local.sh keeps the newest 14 unless BACKUP_KEEP says otherwise)')}
          </dd>
          {stale ? (
            <>
              <dt className="text-fg-muted">{t('Age')}</dt>
              <dd data-volatile data-testid="backup-stale">{t('Older than a week: check that backups still run')}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="max-w-[60ch] text-ui" data-testid="no-backup">
          {t('There is no backup of this database yet. Make one with')} <code className="font-mono text-sm">scripts/backup-local.sh</code>
          {t('; the administration guide explains it and the weekly restore drill.')}
        </p>
      )}
      <p className="max-w-[60ch] text-sm text-fg-muted">
        {t('Until hosting is decided, everything since the last backup can be lost (the recovery point); a restore takes at most 4 hours.')}
      </p>
    </Section>
  );
}

export default async function SystemPage() {
  const t = await getAdminT();
  const guard = await guardRoute(PATH);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Column>
        <div className="max-w-[46rem]" data-testid="system-denied">
          <p className="eyebrow">{t('Administration')}</p>
          <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">
            {t("You don't have access to the system status. It is available to moderators, archivists and administrators.")}
          </p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              {t('Back to your account')}
            </Link>
          </p>
        </div>
      </Column>
    );
  }
  const status = await pageRead(serverClient(await headers(), guard.principal).system.status());
  if (!status) {
    return (
      <LoadError words={loadErrorWords(t)}
        eyebrow={t('Administration')}
        title={t('System status')}
        message={t("We couldn't read the system status. Nothing was changed.")}
        back={{ href: '/admin', label: t('Back to administration') }}
        retryHref={PATH}
      />
    );
  }
  return (
    <Column>
      <header className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            {t('Administration')}
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">{t('System status')}</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          {t('The job queue, e-mail delivery and the local backup of this installation. Counts and times only: nothing here names a person.')}
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          {t('Read on')} <span data-volatile data-testid="checked-at">{formatTime(t, status.checkedAt)}</span>.
        </p>
      </header>
      <Problems status={status} t={t} />
      <Summary status={status} t={t} />
      <div className="mt-10 grid gap-10">
        {(
          [
            { key: 'queues', attention: queueAttention(status), node: <QueueSection status={status} t={t} /> },
            { key: 'email', attention: status.email.failed > 0, node: <EmailSection status={status} t={t} /> },
            { key: 'backup', attention: problemsOf(t, status).some((p) => p.section === 'backup'), node: <BackupSection status={status} t={t} /> },
          ] as const
        )
          .toSorted((a, b) => Number(b.attention) - Number(a.attention))
          .map((section) => (
            <div key={section.key} className="contents">
              {section.node}
            </div>
          ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border-subtle pt-5 text-ui">
        <a href={PATH} className={buttonVariants({ variant: 'secondary' })} data-testid="system-refresh">
          {t('Refresh')}
        </a>
        <Link href="/admin" className="link inline-flex min-h-11 items-center">
          {t('Back to administration')}
        </Link>
      </div>
    </Column>
  );
}
