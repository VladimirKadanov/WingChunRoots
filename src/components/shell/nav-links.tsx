'use client';

// Navigation links of the shell: bottom tabs on phones, a side rail from 768 px. The current
// tab is marked with aria-current, ink colour, weight and a small ink chop, never colour alone.
// On the tabs the chop sits under the label: the top-right corner of an icon is where phones
// draw notification badges, and a count badge on "Me" will need it (M08).
//
// usePathname() suspends while prerendering a route whose dynamic params are not known at build
// time (/people/[slug] from M04), so the shell renders NavLinks inside <Suspense> with
// <NavList pathname={null}> as the fallback (no tab current). Without the boundary such a
// route fails `next build` under Cache Components (Next.js docs, use-pathname.md).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { LineageIcon, MeIcon, SchoolsIcon, SearchIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { NAV_ITEMS } from './nav';

const ICONS = { search: SearchIcon, lineage: LineageIcon, schools: SchoolsIcon, me: MeIcon } as const;

const subscribeNever = () => () => {};

export type NavVariant = 'tabs' | 'rail';

/** The links; `pathname` null means no tab is current (the Suspense fallback). */
export function NavList({ variant, pathname }: { variant: NavVariant; pathname: string | null }) {
  // A destination that is not built yet renders the shared not-found page, which is prerendered
  // without its address. Its tab becomes current only after hydration, so the server HTML and
  // the first client render agree (useSyncExternalStore uses the server snapshot to hydrate).
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <ul className={cx(variant === 'tabs' ? 'flex flex-1' : 'flex flex-col gap-0.5')}>
      {NAV_ITEMS.map((item) => {
        const current = pathname !== null && item.match(pathname) && (item.built || hydrated);
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href} className={cx(variant === 'tabs' && 'flex min-w-0 flex-1')}>
            <Link
              href={item.href}
              prefetch={item.built ? null : false}
              aria-current={current ? 'page' : undefined}
              className={cx(
                'group relative flex items-center text-fg-subtle transition-colors duration-(--duration-fast) hover:text-fg aria-[current=page]:text-fg',
                // An inset focus ring: the tab bar ends at the screen edge and would clip an outer one.
                'focus-visible:-outline-offset-2',
                variant === 'tabs'
                  ? 'min-h-11 flex-1 flex-col justify-center gap-[5px] pt-1.5 text-caption uppercase'
                  : 'min-h-[46px] gap-3.5 rounded-sm px-3 text-ui font-medium hover:bg-surface-3 aria-[current=page]:bg-surface-3 aria-[current=page]:font-semibold',
              )}
            >
              <Icon size={variant === 'tabs' ? 23 : 21} />
              {/* Large text (Android font scale): a long label breaks instead of running into the next. */}
              <span className={cx(variant === 'tabs' && 'max-w-full text-center [overflow-wrap:anywhere]')}>{item.label}</span>
              <span
                aria-hidden="true"
                className={cx(
                  'size-1.5 scale-0 rotate-[-20deg] rounded-[1px] bg-fg transition-transform duration-(--duration-slow) ease-stamp group-aria-[current=page]:scale-100 group-aria-[current=page]:rotate-[4deg]',
                  variant === 'tabs' ? 'block' : 'absolute top-1/2 right-3 -mt-[3px]',
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The links with the current page from the router. Render inside <Suspense> (see above). */
export function NavLinks({ variant }: { variant: NavVariant }) {
  return <NavList variant={variant} pathname={usePathname()} />;
}
