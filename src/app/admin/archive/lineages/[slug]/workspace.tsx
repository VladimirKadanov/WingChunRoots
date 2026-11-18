// The header of a lineage's workspace in the archive editor (control panel 2026-11): the breadcrumb,
// the name, its facts in words, and the tabs (Tree, Links, Details), each a plain link.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import type { AdminT } from '@/components/admin/i18n/translate';
import { buttonVariants } from '@/components/ui/button-variants';
import type { ArchiveLineageHead } from '@/server/services/archive-grids';

export type WorkspaceTab = 'tree' | 'links';

export function WorkspaceHeader({ t, lineage, tab, action }: { t: AdminT; lineage: ArchiveLineageHead; tab: WorkspaceTab; action?: ReactNode }) {
  const base = `/admin/archive/lineages/${lineage.slug}`;
  const tabs: { key: WorkspaceTab | 'details'; href: string; label: string }[] = [
    { key: 'tree', href: base, label: t('Tree') },
    { key: 'links', href: `${base}/links`, label: t('Links · {n}', { n: t.num(lineage.links) }) },
    { key: 'details', href: `${base}#details`, label: t('Lineage details') },
  ];
  return (
    <header className="grid gap-4">
      <p className="eyebrow">
        <Link href="/admin/archive" className="link inline-flex min-h-11 items-center">
          {t('Lineages')}
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
                  {t('Root:')} <NameText name={lineage.root.name} />
                </>
              ) : (
                t('Root not known')
              )}
            </span>
            <span>{t.n(lineage.links, '{n} link', '{n} links')}</span>
            <span>{t.n(lineage.people, '{n} person', '{n} people')}</span>
            {lineage.needsWork > 0 ? <span>{t('{n} without a source or years', { n: t.num(lineage.needsWork) })}</span> : null}
            <span>{lineage.listed ? t('In the explorer') : t('Not in the explorer yet')}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {lineage.listed && lineage.root ? (
            <Link href={`/explore?focus=${lineage.root.id}&lineage=${lineage.id}`} className={buttonVariants({ variant: 'secondary' })}>
              {t('Open in explorer')}
            </Link>
          ) : null}
          {action}
        </div>
      </div>
      <nav aria-label={t('Lineage views')} className="flex flex-wrap gap-1 border-b border-border-subtle">
        {tabs.map((v) => (
          <Link
            key={v.key}
            href={v.href}
            aria-current={v.key === tab ? 'page' : undefined}
            className="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-ui text-fg-muted hover:text-fg aria-[current=page]:border-fg aria-[current=page]:font-semibold aria-[current=page]:text-fg"
          >
            {v.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
