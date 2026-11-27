'use client';

// Navigation links of the shell: bottom tabs on phones, a side rail from 768 px. The current
// tab is marked with aria-current, ink colour, weight and a small ink chop, never colour alone.
// On the tabs the chop sits under the label: the top-right corner of an icon is where phones
// draw notification badges.
//
// usePathname() suspends while prerendering a route whose dynamic params are not known at build
// time (/people/[slug] from M04), so the shell renders NavLinks inside <Suspense> with
// <NavList pathname={null}> as the fallback (no tab current). Without the boundary such a
// route fails `next build` under Cache Components (Next.js docs, use-pathname.md).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import { CalendarIcon, LineageIcon, MeIcon, OrganizationsIcon, PinIcon, SchoolsIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { ME_ITEM, NAV_ITEMS, type NavItem } from './nav';

// The house drawing serves Home; the school finder is a map pin (docs/adr/0039); Organizations is
// a banner (docs/adr/0051); Me is a head and shoulders (docs/adr/0084).
const ICONS = { home: SchoolsIcon, lineage: LineageIcon, schools: PinIcon, organizations: OrganizationsIcon, events: CalendarIcon, me: MeIcon } as const;

const subscribeNever = () => () => {};

export type NavVariant = 'tabs' | 'rail';

/** The current path for the tabs the shell passes in from the server (TabTail). */
const PathnameContext = createContext<string | null>(null);

/** One destination. `badge`: a count drawn on the icon (the unread notices of the Me tab). */
function NavItemLink({ item, variant, pathname, badge = 0 }: { item: NavItem; variant: NavVariant; pathname: string | null; badge?: number }) {
  // A destination that is not built yet renders the shared not-found page, which is prerendered
  // without its address. Its tab becomes current only after hydration, so the server HTML and
  // the first client render agree (useSyncExternalStore uses the server snapshot to hydrate).
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const current = pathname !== null && item.match(pathname) && (item.built || hydrated);
  const Icon = ICONS[item.icon];
  const label = variant === 'tabs' ? (item.tabLabel ?? item.label) : item.label;
  return (
    <li className={cx(variant === 'tabs' && 'flex min-w-0 flex-1')}>
      <Link
        href={item.href}
        prefetch={item.built ? null : false}
        aria-current={current ? 'page' : undefined}
        data-nav={item.icon}
        className={cx(
          'group relative flex items-center text-fg-subtle transition-colors duration-(--duration-fast) hover:text-fg aria-[current=page]:text-fg',
          // An inset focus ring: the tab bar ends at the screen edge and would clip an outer one.
          'focus-visible:-outline-offset-2',
          variant === 'tabs'
            ? // Centred with the same room above the icon as below the chop, so the chop never
              // sits on the screen's bottom edge where there is no home-indicator inset.
              '@container/tab min-h-11 flex-1 flex-col justify-center gap-1 text-caption uppercase'
            : 'min-h-[46px] gap-3.5 rounded-sm px-3 text-ui font-medium hover:bg-surface-3 aria-[current=page]:bg-surface-3 aria-[current=page]:font-semibold',
        )}
      >
        <span className="relative inline-flex">
          <Icon size={variant === 'tabs' ? 23 : 21} />
          {badge > 0 ? (
            // P2-8: the unread count where phones draw it, with the number in words for a screen reader.
            <span
              data-testid="me-tab-unread"
              className="absolute -top-1.5 -right-2.5 min-w-[1.15rem] rounded-full bg-fg px-1 text-center text-[0.6875rem] leading-[1.15rem] font-semibold tabular-nums text-fg-inverse normal-case"
            >
              <span aria-hidden="true">{badge > 99 ? '99+' : badge}</span>
            </span>
          ) : null}
        </span>
        {/* Large text (Android font scale) or a narrow phone: the queries are in em of the
            label's own size, so they follow the text size. When the widest label ("SCHOOLS",
            5.7 em with the caption tracking) no longer fits, the tracking tightens (5 em);
            below that the label drops the capitals; and with five tabs (M17) on a 320 px phone
            at 150 % text (a tab of about 3.6 em) it is set an eighth smaller. Only still larger
            text breaks a word, and then inside its own tab instead of running into the next. */}
        <span
          className={cx(
            variant === 'tabs' &&
              'max-w-full text-center [overflow-wrap:anywhere] @max-[5.75em]/tab:tracking-[0.03em] @max-[5em]/tab:tracking-normal @max-[5em]/tab:normal-case @max-[3.8em]/tab:text-[0.875em]',
          )}
        >
          {label}
          {badge > 0 ? <span className="sr-only">, {badge === 1 ? '1 unread notice' : `${badge} unread notices`}</span> : null}
        </span>
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
}

/** P2-8: the last two phone tabs: Organizations and Events signed out, Events and Me signed in. */
const TAIL_ICONS = new Set<NavItem['icon']>(['organizations', 'events']);

/**
 * The last two phone tabs, which depend on the session (the shell renders the signed-in ones
 * behind <Suspense>, with the signed-out ones as the fallback: the same two places, so nothing moves).
 */
export function TabTail({ signedIn, unread = 0 }: { signedIn: boolean; unread?: number }) {
  const pathname = useContext(PathnameContext);
  const tail = NAV_ITEMS.filter((item) => TAIL_ICONS.has(item.icon) && (!signedIn || item.icon !== 'organizations'));
  return (
    <>
      {tail.map((item) => (
        <NavItemLink key={item.href} item={item} variant="tabs" pathname={pathname} />
      ))}
      {signedIn ? <NavItemLink item={ME_ITEM} variant="tabs" pathname={pathname} badge={unread} /> : null}
    </>
  );
}

/**
 * The links; `pathname` null means no tab is current (the Suspense fallback). `tail`: on the
 * tabs, the last two destinations as the shell renders them (TabTail); without it, all five.
 */
export function NavList({ variant, pathname, tail }: { variant: NavVariant; pathname: string | null; tail?: ReactNode }) {
  const items = variant === 'tabs' && tail ? NAV_ITEMS.filter((item) => !TAIL_ICONS.has(item.icon)) : NAV_ITEMS;
  return (
    <PathnameContext.Provider value={pathname}>
      <ul className={cx(variant === 'tabs' ? 'flex flex-1' : 'flex flex-col gap-0.5')}>
        {items.map((item) => (
          <NavItemLink key={item.href} item={item} variant={variant} pathname={pathname} />
        ))}
        {variant === 'tabs' ? tail : null}
      </ul>
    </PathnameContext.Provider>
  );
}

/** The links with the current page from the router. Render inside <Suspense> (see above). */
export function NavLinks({ variant, tail }: { variant: NavVariant; tail?: ReactNode }) {
  return <NavList variant={variant} pathname={usePathname()} tail={tail} />;
}
