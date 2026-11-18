// The header of a lineage's workspace in the archive editor (control panel 2026-11): the breadcrumb,
// the name, its facts in words, and the tabs (Tree, Links, Details), each a plain link.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { buttonVariants } from '@/components/ui/button-variants';
import type { ArchiveLineageHead } from '@/server/services/archive-grids';
import { number } from '../../grid-parts';

export type WorkspaceTab = 'tree' | 'links';

export function WorkspaceHeader({ lineage, tab, action }: { lineage: ArchiveLineageHead; tab: WorkspaceTab; action?: ReactNode }) {
  const base = `/admin/archive/lineages/${lineage.slug}`;
  const tabs: { key: WorkspaceTab | 'details'; href: string; label: string }[] = [
    { key: 'tree', href: base, label: 'Tree' },
    { key: 'links', href: `${base}/links`, label: `Links · ${number.format(lineage.links)}` },
    { key: 'details', href: `${base}#details`, label: 'Lineage details' },
  ];
  return (
    <header className="grid gap-4">
      <p className="eyebrow">
        <Link href="/admin/archive" className="link inline-flex min-h-11 items-center">
          Lineages
        </Link>
        <span aria-hidden="true"> / </span>
        {lineage.name}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-feature">{lineage.name}</h1>
          <p className="mt-2 flex flex-wrap gap-x-3 text-ui text-fg-muted" data-testid="lineage-facts">
            <span>
              {lineage.root ? (
                <>
                  Root: <NameText name={lineage.root.name} />
                </>
              ) : (
                'Root not known'
              )}
            </span>
            <span>{lineage.links === 1 ? '1 link' : `${number.format(lineage.links)} links`}</span>
            <span>{lineage.people === 1 ? '1 person' : `${number.format(lineage.people)} people`}</span>
            {lineage.needsWork > 0 ? <span>{number.format(lineage.needsWork)} without a source or years</span> : null}
            <span>{lineage.listed ? 'In the explorer' : 'Not in the explorer yet'}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {lineage.listed && lineage.root ? (
            <Link href={`/explore?focus=${lineage.root.id}&lineage=${lineage.id}`} className={buttonVariants({ variant: 'secondary' })}>
              Open in explorer
            </Link>
          ) : null}
          {action}
        </div>
      </div>
      <nav aria-label="Lineage views" className="flex flex-wrap gap-1 border-b border-border-subtle">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === tab ? 'page' : undefined}
            className="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-ui text-fg-muted hover:text-fg aria-[current=page]:border-fg aria-[current=page]:font-semibold aria-[current=page]:text-fg"
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
