// /dashboard/passport/print (owner decision 2026-11-18, docs/adr/0046-passport-extras.md): the owner's
// training passport on paper. "Print or save as PDF" opens the browser's print dialog, where "Save
// as PDF" makes the PDF (no PDF library, as the lineage card, ADR 0045); the print stylesheet keeps
// the sheet alone, on paper colours. Public entries by default; "Include private entries" adds the
// private ones, marked as such, to this copy only. A request that waits for an organizer is never
// printed. Part of the full passport (Premium Student, Professional Sifu); on a basic passport the
// page says so in one sentence, without a prompt.
// Data from passport.mine; reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowLeftIcon } from '@/components/icons';
import { PrintButton } from '@/components/lineage/print-button';
import { EntryLine } from '@/components/passport/passport-view';
import { cx } from '@/lib/cx';
import { guardRoute } from '@/server/auth/web';
import { rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { MyPassport } from '@/server/services/passport';

export const instant = false;

export const metadata: Metadata = {
  title: 'Print your training passport',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/passport/print';

const printedOn = (now: Date) => now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function PassportPrintPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const withPrivate = query.private === '1';
  let view: MyPassport | 'no-profile' | null;
  try {
    view = await serverClient(await headers(), guard.principal).passport.mine();
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND') view = 'no-profile';
    else if (rpcErrorCode(error) === null || rpcErrorCode(error) === 'INTERNAL_SERVER_ERROR') view = null;
    else throw error;
  }
  if (view === null) {
    return (
      <LoadError
        eyebrow="Dashboard"
        title="Print your training passport"
        message="We couldn't load your passport. Nothing was changed."
        retryHref={PAGE}
        back={{ href: '/dashboard/passport', label: 'Back to your passport' }}
      />
    );
  }
  const back = (
    <p className="print:hidden">
      <Link href="/dashboard/passport" className="link inline-flex min-h-11 items-center gap-2">
        <ArrowLeftIcon />
        <span>Back to your passport</span>
      </Link>
    </p>
  );
  if (view === 'no-profile' || view.level !== 'full') {
    return (
      <div className="mx-auto grid max-w-content content-start gap-4 px-page pt-6 pb-10 md:pt-11">
        {back}
        <h1 className="font-display text-feature">Print your training passport</h1>
        <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="passport-print-unavailable">
          {view === 'no-profile'
            ? 'You have no profile yet. Finish setting up your profile first: your passport belongs to it.'
            : `Printing your passport, or saving it as a PDF, is part of Premium Student and Professional Sifu. Your passport page shows every entry on ${view.plan.name}.`}
        </p>
      </div>
    );
  }
  const entries = view.entries.filter((e) => !e.waitingForOrganizer && (withPrivate || e.visibility === 'public'));
  const privateCount = view.entries.filter((e) => !e.waitingForOrganizer && e.visibility === 'private').length;
  const current = entries.find((e) => e.id === view.currentRankId) ?? entries.find((e) => e.kind === 'rank') ?? null;
  const choices = [
    { href: PAGE, label: 'Public entries only', on: !withPrivate },
    { href: `${PAGE}?private=1`, label: `Include private entries (${privateCount})`, on: withPrivate },
  ];
  return (
    <div className="mx-auto grid max-w-content content-start gap-6 px-page pt-6 pb-16 md:pt-11 print:max-w-none print:p-0">
      <div className="grid gap-3 print:hidden">
        {back}
        <h1 className="font-display text-feature">Print your training passport</h1>
        <p className="max-w-[60ch] text-ui text-fg-muted">
          A copy of your passport for your own records or a school. Requests that wait for an organizer are left out.
        </p>
        <nav aria-label="What the copy includes" data-testid="passport-print-choice">
          <ul className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <li key={c.href}>
                <Link
                  href={c.href}
                  scroll={false}
                  aria-current={c.on ? 'page' : undefined}
                  className={cx(
                    'inline-flex min-h-11 items-center gap-2 rounded-sm border px-3 text-sm',
                    c.on ? 'border-fg bg-fg font-semibold text-fg-inverse' : 'border-border-strong hover:bg-surface-3',
                  )}
                >
                  {c.on ? <span aria-hidden="true">●</span> : null}
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <PrintButton />
        </div>
        <p className="text-sm text-fg-muted">To make a PDF, choose “Save as PDF” in the print dialog. Your browser’s own Print does the same.</p>
      </div>

      <article aria-labelledby="passport-print-heading" className="grid gap-6 rounded-sm border border-border-strong bg-surface-2 p-6 print:border-0 print:p-0" data-testid="passport-print-sheet" data-private={withPrivate}>
        <header className="grid gap-1 border-b border-border-subtle pb-4">
          <p className="eyebrow">Training passport · WingChunRoots</p>
          <h2 id="passport-print-heading" className="font-display text-section [overflow-wrap:anywhere]">
            <span lang={view.person.name.lang} translate="no">
              {view.person.name.value}
            </span>
          </h2>
          <p className="text-sm text-fg-muted tabular">
            The record as of {printedOn(new Date())}
            {withPrivate ? ' · includes private entries' : ' · public entries'}
          </p>
        </header>
        <dl className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <div className="grid gap-1">
            <dt className="eyebrow">Current rank</dt>
            <dd className="font-display text-xl [overflow-wrap:anywhere]">{current ? current.title : 'No rank recorded yet'}</dd>
            {current ? <dd className="text-sm text-fg-muted tabular">{current.dateText}</dd> : null}
          </div>
          <div className="grid gap-1">
            <dt className="eyebrow">Training</dt>
            <dd className="font-display text-xl tabular">{view.experience ? view.experience.text : 'Start not recorded'}</dd>
          </div>
          {view.teachers.length > 0 ? (
            <div className="grid gap-1 sm:col-span-2 print:col-span-2">
              <dt className="eyebrow">Teachers</dt>
              {view.teachers.map((t) => (
                <dd key={`${t.person.slug}:${t.lineage}`} className="text-ui">
                  <span lang={t.person.name.lang} translate="no">
                    {t.person.name.value}
                  </span>{' '}
                  <span className="text-sm text-fg-muted tabular">
                    · {t.lineage} · {t.periods.map((p) => p.text).join('; ') || 'Dates not recorded'}
                  </span>
                </dd>
              ))}
            </div>
          ) : null}
        </dl>
        <section aria-labelledby="passport-print-entries" className="grid gap-3">
          <h3 id="passport-print-entries" className="font-display text-xl">
            Entries ({entries.length})
          </h3>
          {entries.length === 0 ? (
            <p className="text-fg-muted">Nothing to print yet.</p>
          ) : (
            <ol className="grid gap-4" aria-label="Entries, the latest first">
              {entries.map((entry) => (
                <li key={`${entry.kind}:${entry.id}`} className="break-inside-avoid border-t border-border-subtle pt-3" data-testid="passport-print-entry" data-visibility={entry.visibility}>
                  <EntryLine entry={entry}>
                    {entry.visibility === 'private' ? <p className="text-sm font-semibold">Private entry: not shown on the profile</p> : null}
                  </EntryLine>
                </li>
              ))}
            </ol>
          )}
        </section>
        <footer className="border-t border-border-subtle pt-3 text-sm text-fg-muted">
          Ranks, examinations and skills are recorded by the teacher or the organization named on them; events are confirmed by their organizers. Certificates are scans the
          student added.
          {view.person.public ? ` The public passport is at /people/${view.person.slug}.` : null}
        </footer>
      </article>
    </div>
  );
}
