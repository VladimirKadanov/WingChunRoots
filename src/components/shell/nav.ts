// The four destinations of the app shell (Ink Lineage prototype): Explore is the home page;
// the others open in later milestones (M05 /explore, M11 /schools, M08 /dashboard) and show
// the "not drawn yet" page until then.

export interface NavItem {
  href: string;
  label: string;
  icon: 'search' | 'lineage' | 'schools' | 'me';
  /** Paths that mark this tab as current. */
  match: (pathname: string) => boolean;
  /** False until the destination exists: no prefetch of a page that is not built yet. */
  built: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Explore', icon: 'search', match: (p) => p === '/', built: true },
  { href: '/explore', label: 'Lineage', icon: 'lineage', match: (p) => p.startsWith('/explore') || p.startsWith('/people'), built: false },
  { href: '/schools', label: 'Schools', icon: 'schools', match: (p) => p.startsWith('/schools'), built: false },
  { href: '/dashboard', label: 'Me', icon: 'me', match: (p) => p.startsWith('/dashboard') || p.startsWith('/account'), built: false },
];
