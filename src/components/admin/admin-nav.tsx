// The control panel's navigation (owner request 2026-11-17, docs/adr/0035-control-panel.md): the
// same grouped list on every /admin page. From 1024 px a sidebar beside the page; narrower, a row
// of links that scrolls sideways above it, so every section stays one tap away on a phone. The
// current page is marked with aria-current, weight, an ink bar and the surface, never colour
// alone. Rendered on the server with no script of its own, so the admin pages keep their script
// budget (plan §5.8 (c)): the @nav slot (src/app/admin/@nav) knows the address and passes it, and
// only the sections the session may open.

import Link from 'next/link';
import { cx } from '@/lib/cx';

export interface AdminNavLink {
  href: string;
  label: string;
  /** A count shown beside the label (open cases, problems), or null. */
  count: number | null;
  /** What the count means, for the accessible name ("37 open"). */
  countLabel?: string;
  /** The count asks for attention (a dashed outline as well as the number). */
  alert?: boolean;
}

export interface AdminNavGroup {
  label: string;
  links: AdminNavLink[];
}

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The link of the page at `pathname`: the longest address it is at or below (/admin itself only exactly). */
export function currentHref(groups: readonly AdminNavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of groups.flatMap((g) => g.links)) {
    const matches = href === '/admin' ? pathname === '/admin' : under(pathname, href);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

function Count({ link }: { link: AdminNavLink }) {
  if (!link.count) return null;
  return (
    <span
      className={cx(
        'ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full border px-1.5 text-xs font-semibold',
        link.alert ? 'border-dashed border-danger text-danger' : 'border-border-strong text-fg',
      )}
    >
      <span aria-hidden="true">{link.count}</span>
      <span className="sr-only">
        , {link.count} {link.countLabel ?? ''}
      </span>
    </span>
  );
}

export function AdminNav({ groups, pathname }: { groups: AdminNavGroup[]; pathname: string }) {
  const links = groups.flatMap((g) => g.links);
  const current = currentHref(groups, pathname);
  return (
    <nav aria-label="Control panel" data-testid="admin-nav" className="lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:overscroll-contain">
      <ul className="flex gap-1.5 overflow-x-auto px-page py-2 [scrollbar-width:thin] lg:hidden">
        {links.map((link) => (
          <li key={link.href} className="shrink-0">
            <Link
              href={link.href}
              aria-current={current === link.href ? 'page' : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle px-3.5 text-sm whitespace-nowrap text-fg-muted hover:text-fg aria-[current=page]:border-fg aria-[current=page]:bg-fg aria-[current=page]:font-semibold aria-[current=page]:text-fg-inverse"
            >
              {link.label}
              {link.count ? (
                <>
                  <span aria-hidden="true" className="text-xs font-semibold">
                    {link.count}
                  </span>
                  <span className="sr-only">
                    , {link.count} {link.countLabel ?? ''}
                  </span>
                </>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden px-3 pt-6 pb-10 lg:block">
        <p className="eyebrow px-3">Control panel</p>
        {groups.map((group) => (
          <div key={group.label} className="mt-5">
            <p className="px-3 pb-1.5 text-xs tracking-[0.08em] text-fg-subtle uppercase">{group.label}</p>
            <ul className="grid gap-0.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current === link.href ? 'page' : undefined}
                    className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-ui text-fg-muted hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-surface-3 aria-[current=page]:font-semibold aria-[current=page]:text-fg aria-[current=page]:shadow-[inset_2px_0_0_var(--fg)]"
                  >
                    {link.label}
                    <Count link={link} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
