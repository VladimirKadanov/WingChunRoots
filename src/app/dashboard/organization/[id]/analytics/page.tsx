// /dashboard/organization/<id>/analytics (milestone M24; specification §3.1 "Organization analytics
// by country and city"; docs/adr/0027-organization-tools.md): counts of the organization's own
// members, schools, public verification states and claims, by country, city and month. Tables
// only (numbers in text; nothing told by colour). A Federation feature (DEFAULT D08): without the
// plan or the approval the page says what it needs. Any other organization is "not found".

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { Section, ToolClosed, ToolNotFound, ToolPage, UUID } from '../../tools-parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Organization analytics',
  robots: { index: false },
};

type Props = { params: Promise<{ id: string }> };

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthLabel = (ym: string) => MONTH.format(new Date(`${ym}-01T00:00:00Z`));

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="font-display text-2xl">{value}</dd>
    </div>
  );
}

function Table({ caption, head, children, testId }: { caption: string; head: string[]; children: ReactNode; testId: string }) {
  return (
    <div className="max-w-full overflow-x-auto" data-testid={testId}>
      <table className="w-full max-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            {head.map((h, i) => (
              <th key={h} scope="col" className={i === 0 ? 'py-2 pr-4 font-semibold' : 'py-2 pr-4 text-right font-semibold'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage({ params }: Props) {
  const { id } = await params;
  const page = UUID.test(id) ? `/dashboard/organization/${id}/analytics` : '/dashboard/organization';
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <ToolNotFound />;
  const read = await pageRead(
    serverClient(await headers(), guard.principal)
      .organizationTools.analytics({ organizationId: id })
      .catch((error: unknown) => {
        const code = rpcErrorCode(error);
        if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') return 'missing' as const;
        if (code === 'ENTITLEMENT_REQUIRED' || code === 'CONFLICT') return { closed: (error as Error).message };
        throw error;
      }),
  );
  if (read === 'missing') return <ToolNotFound />;
  if (!read) return <LoadError {...ORGANIZATION_LOAD_ERRORS.analytics} retryHref={page} />;
  if ('closed' in read) return <ToolClosed organizationId={id} title="Analytics" message={read.closed} />;
  const a = read;
  const cell = 'py-2 pr-4 text-right tabular-nums';

  return (
    <ToolPage organizationId={id} title="Analytics" testId="organization-analytics" intro={<p>{a.note}</p>}>
      <p className="text-sm text-fg-muted" data-testid="organization-analytics-as-of">
        As of {formatDay(a.asOf)}
      </p>
      <Section id="analytics-members" title="Members" testId="organization-analytics-members">
        <dl className="grid max-w-[44rem] grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          <Stat label="Current" value={a.members.current} />
          <Stat label="Public profiles" value={a.members.publicProfiles} />
          <Stat label="With an account" value={a.members.withAccount} />
          <Stat label="Records only" value={a.members.recordsOnly} />
          <Stat label="Former" value={a.members.ended} />
        </dl>
        {a.membersByCountry.length > 0 ? (
          <Table caption="Current members by country" head={['Country', 'Members']} testId="organization-analytics-countries">
            {a.membersByCountry.map((r) => (
              <tr key={r.countryCode ?? 'none'} className="border-b border-border-subtle">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {r.country}
                </th>
                <td className={cell}>{r.count}</td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Section>

      <Section id="analytics-verification" title="Verification" testId="organization-analytics-verification">
        <dl className="grid max-w-[44rem] grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Stat label="Verified relationships" value={a.verification.verified} />
          <Stat label="Under arbitration" value={a.verification.inArbitration} />
          <Stat label="Members with a verified teacher" value={a.verification.membersWithVerifiedTeacher} />
          <Stat label="Claims, not verified" value={a.claims.open} />
        </dl>
      </Section>

      <Section id="analytics-schools" title="Schools" testId="organization-analytics-schools">
        <dl className="grid max-w-[44rem] grid-cols-2 gap-x-6 gap-y-3">
          <Stat label="Linked" value={a.schools.linked} />
          <Stat label="Waiting for the school" value={a.schools.waiting} />
        </dl>
        {a.schoolsByCity.length > 0 ? (
          <Table caption="Linked schools by city" head={['City', 'Country', 'Schools']} testId="organization-analytics-cities">
            {a.schoolsByCity.map((r) => (
              <tr key={`${r.countryCode}-${r.city}`} className="border-b border-border-subtle">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {r.city}
                </th>
                <td className="py-2 pr-4 text-right">{r.country}</td>
                <td className={cell}>{r.count}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-ui text-fg-muted">No school is linked yet.</p>
        )}
      </Section>

      <Section id="analytics-months" title="Month by month" testId="organization-analytics-months">
        <Table caption="The last twelve months" head={['Month', 'Joined', 'Left', 'Schools linked', 'Verified']} testId="organization-analytics-month-table">
          {a.months.map((m) => (
            <tr key={m.month} className="border-b border-border-subtle">
              <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                {monthLabel(m.month)}
              </th>
              <td className={cell}>{m.membersJoined}</td>
              <td className={cell}>{m.membersEnded}</td>
              <td className={cell}>{m.schoolsLinked}</td>
              <td className={cell}>{m.relationshipsVerified}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </ToolPage>
  );
}
