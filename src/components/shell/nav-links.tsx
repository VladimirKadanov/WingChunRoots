'use client';
// No React Compiler memoisation here: a handful of links re-render cheaply, and its cache code
// would grow the script every page loads (journey review P2-8, the bundle budget).
'use no memo';

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
import { type ReactNode, useSyncExternalStore } from 'react';
import { CalendarIcon, LineageIcon, OrganizationsIcon, PinIcon, SchoolsIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { ME_ITEM, NAV_ITEMS, type NavItem } from './nav';

// The house drawing serves Home; the school finder is a map pin (docs/adr/0039); Organizations is
// a banner (docs/adr/0051). The Me tab's drawing and count come drawn from the server (TabSession).
const ICONS = { home: SchoolsIcon, lineage: LineageIcon, schools: PinIcon, organizations: OrganizationsIcon, events: CalendarIcon } as const;

const subscribeNever = () => () => {};

export type NavVariant = 'tabs' | 'rail';

/** One destination. `icon`: a drawing the server rendered (the Me tab, with its unread count). */
function NavItemLink({ item, variant, pathname, icon }: { item: NavItem; variant: NavVariant; pathname: string | null; icon?: ReactNode }) {
  // A destination that is not built yet renders the shared not-found page, which is prerendered
  // without its address. Its tab becomes current only after hydration, so the server HTML and
  // the first client render agree (useSyncExternalStore uses the server snapshot to hydrate).
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const current = pathname !== null && item.match(pathname) && (item.built || hydrated);
  const Icon = item.icon === 'me' ? null : ICONS[item.icon];
  const label = variant === 'tabs' ? (item.tabLabel ?? item.label) : item.label;
  return (
    <li className={cx(variant === 'tabs' && 'flex min-w-0 flex-1')}>
      <Link
        href={item.href}
        prefetch={item.built ? null : false}
        aria-current={current ? 'page' : undefined}
        data-nav={item.icon}
        // The classes live in globals.css (nav-tab, nav-rail): the shell's script stays small.
        className={variant === 'tabs' ? 'group nav-tab' : 'group nav-rail'}
      >
        {Icon ? <Icon size={variant === 'tabs' ? 23 : 21} /> : icon}
        {/* Large text (Android font scale) or a narrow phone: the queries are in em of the
            label's own size, so they follow the text size. When the widest label ("SCHOOLS",
            5.7 em with the caption tracking) no longer fits, the tracking tightens (5 em);
            below that the label drops the capitals; and with five tabs (M17) on a 320 px phone
            at 150 % text (a tab of about 3.6 em) it is set an eighth smaller. Only still larger
            text breaks a word, and then inside its own tab instead of running into the next. */}
        <span className={variant === 'tabs' ? 'nav-tab-label' : undefined}>{label}</span>
        <span aria-hidden="true" className="nav-chop" />
      </Link>
    </li>
  );
}

/** P2-8: signed in, the phone tabs swap Organizations for Me, whose drawing (with the unread count) the server renders. */
export interface TabSession {
  me: ReactNode;
}

/**
 * The links; `pathname` null means no tab is current (the Suspense fallback). On the tabs,
 * `session` signed in swaps Organizations for Me (the shell reads the session on the server).
 */
export function NavList({ variant, pathname, session }: { variant: NavVariant; pathname: string | null; session?: TabSession }) {
  const items = variant === 'tabs' && session ? [...NAV_ITEMS.filter((item) => item.icon !== 'organizations'), ME_ITEM] : NAV_ITEMS;
  return (
    <ul className={cx(variant === 'tabs' ? 'flex flex-1' : 'flex flex-col gap-0.5')}>
      {items.map((item) => (
        <NavItemLink key={item.href} item={item} variant={variant} pathname={pathname} icon={session?.me} />
      ))}
    </ul>
  );
}

/** The links with the current page from the router. Render inside <Suspense> (see above). */
export function NavLinks({ variant, session }: { variant: NavVariant; session?: TabSession }) {
  return <NavList variant={variant} pathname={usePathname()} session={session} />;
}
