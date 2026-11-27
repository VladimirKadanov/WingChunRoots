// The five destinations of the app shell (Ink Lineage prototype): Home is the home page (called
// "Explore" until 2026-11-17, renamed because the Lineage tab is the explorer; docs/adr/0039);
// Lineage is the explorer (M05); Schools is the school finder (M11); Organizations is the list of
// approved federations, associations and groups of schools (M15); Events is the event calendar
// (M17).
//
// Owner decision 2026-11-19 (docs/adr/0051-organizations-in-the-menu.md): Organizations replaces
// the former "Me" tab. The account menu in the top bar (phones) and in the rail (from 768 px)
// already leads to the dashboard, the profile and the settings, and shows "Sign in" without a
// session, so a Me tab only repeated it.
//
// Journey review P2-8 (docs/adr/0084-me-tab.md): signed in, the phone tabs are Home, Lineage,
// Schools, Events and Me (the dashboard, with the unread count); Organizations moves into the
// account menu. Signed out, and in the side rail, the five destinations stay as they are.
//
// DEFAULT M17 (question 4): Events is a fifth tab of its own, after Schools and Organizations,
// rather than a section inside another tab.

export interface NavItem {
  href: string;
  label: string;
  /** The label of the phone tab, where the full one does not fit (the rail shows `label`). */
  tabLabel?: string;
  icon: 'home' | 'lineage' | 'schools' | 'organizations' | 'events' | 'me';
  /** Paths that mark this tab as current. */
  match: (pathname: string) => boolean;
  /** False until the destination exists: no prefetch of a page that is not built yet. */
  built: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home', match: (p) => p === '/', built: true },
  { href: '/explore', label: 'Lineage', icon: 'lineage', match: (p) => p.startsWith('/explore') || p.startsWith('/people'), built: true },
  { href: '/schools', label: 'Schools', icon: 'schools', match: (p) => p.startsWith('/schools'), built: true },
  {
    href: '/organizations',
    label: 'Organizations',
    tabLabel: 'Orgs',
    icon: 'organizations',
    match: (p) => p === '/organizations' || p.startsWith('/organizations/'),
    built: true,
  },
  { href: '/events', label: 'Events', icon: 'events', match: (p) => p === '/events' || p.startsWith('/events/'), built: true },
];

/** P2-8: the signed-in fifth tab on phones. */
export const ME_ITEM: NavItem = {
  href: '/dashboard',
  label: 'Me',
  icon: 'me',
  match: (p) => p === '/dashboard' || p.startsWith('/dashboard/') || p === '/account' || p.startsWith('/account/'),
  built: true,
};
