// /dashboard/organization/<id>/heatmap (milestone M24; specification §3.1 "Organization heatmap
// and school network", §10.3; docs/adr/0027-organization-tools.md): where the organization's linked
// schools are, as squares of 1° counted at their cities' centres (DEFAULT M24 question 7). A square
// with fewer than three schools is never drawn; its schools are counted by country only. The
// table is the page; "Show on a map" adds the same squares on MapLibre, loaded on request. A
// Federation feature (DEFAULT D08). Any other organization is "not found".

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { mapStyles } from '@/server/geo/map-styles';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { Section, ToolClosed, ToolNotFound, ToolPage, UUID } from '../../tools-parts';
import { HeatmapView } from './heatmap-view';

export const instant = false;

export const metadata: Metadata = {
  title: 'School heatmap',
  robots: { index: false },
};

type Props = { params: Promise<{ id: string }> };

const lat = (v: number) => `${Math.abs(v)}° ${v < 0 ? 'S' : 'N'}`;
const lng = (v: number) => `${Math.abs(v)}° ${v < 0 ? 'W' : 'E'}`;

export default async function HeatmapPage({ params }: Props) {
  const { id } = await params;
  const page = UUID.test(id) ? `/dashboard/organization/${id}/heatmap` : '/dashboard/organization';
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <ToolNotFound />;
  const read = await pageRead(
    serverClient(await headers(), guard.principal)
      .organizationTools.heatmap({ organizationId: id })
      .catch((error: unknown) => {
        const code = rpcErrorCode(error);
        if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') return 'missing' as const;
        if (code === 'ENTITLEMENT_REQUIRED' || code === 'CONFLICT') return { closed: (error as Error).message };
        throw error;
      }),
  );
  if (read === 'missing') return <ToolNotFound />;
  if (!read) return <LoadError {...ORGANIZATION_LOAD_ERRORS.heatmap} retryHref={page} />;
  if ('closed' in read) return <ToolClosed organizationId={id} title="School heatmap" message={read.closed} />;
  const h = read;

  return (
    <ToolPage organizationId={id} title="School heatmap" testId="organization-heatmap" intro={<p>{h.note}</p>}>
      <p className="text-ui" data-testid="organization-heatmap-total">
        <span className="font-semibold">{h.total}</span> linked {h.total === 1 ? 'school' : 'schools'}
        {h.cells.length > 0 ? `, ${h.cells.length} ${h.cells.length === 1 ? 'square' : 'squares'} drawn` : ''}.
      </p>

      <Section id="heatmap-squares" title="Squares" testId="organization-heatmap-squares">
        {h.cells.length > 0 ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full max-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Squares with at least {h.minSchools} schools, by their south-west corner</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Square (south-west corner)
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Countries
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">
                      Schools
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {h.cells.map((c) => (
                    <tr key={`${c.south}:${c.west}`} className="border-b border-border-subtle" data-testid="organization-heatmap-square">
                      <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                        {lat(c.south)}, {lng(c.west)}
                      </th>
                      <td className="py-2 pr-4">{c.countries.join(', ')}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <HeatmapView cells={h.cells} styles={mapStyles()} />
          </>
        ) : (
          <p className="text-ui text-fg-muted" data-testid="organization-heatmap-empty">
            No square has {h.minSchools} or more schools yet.
          </p>
        )}
      </Section>

      <Section id="heatmap-sparse" title="In smaller areas" testId="organization-heatmap-sparse">
        {h.sparse.length > 0 ? (
          <ul className="grid gap-1 text-ui">
            {h.sparse.map((s) => (
              <li key={s.countryCode ?? 'none'}>
                {s.country}: <span className="font-semibold tabular-nums">{s.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-fg-muted">None.</p>
        )}
      </Section>
    </ToolPage>
  );
}
