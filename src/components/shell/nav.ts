// The four destinations of the app shell (Ink Lineage prototype): Explore is the home page; Me
// is the dashboard (M08 review round 1, design-7: /dashboard, with requests and notifications; it
// links to /account; a visitor without a session is sent to /sign-in); Lineage is the explorer
// (M05); Schools is the school finder (M11).

export interface NavItem {
  href: string;
  label: string;
  icon: 'search' | 'lineage' | 'schools' | 'me';
  /** Paths that mark this tab as current. */
  match: (pathname: string) => boolean;
  /** False until the destination exists: no prefetch of a page that is not built yet. */
  built: boolean;
}

/** The pages of the Me tab: the account, signing in and out, onboarding and the staff page. */
const ME_PATHS = ['/account', '/dashboard', '/sign-in', '/sign-up', '/verify-email', '/reset-password', '/onboarding', '/admin'];

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Explore', icon: 'search', match: (p) => p === '/', built: true },
  { href: '/explore', label: 'Lineage', icon: 'lineage', match: (p) => p.startsWith('/explore') || p.startsWith('/people'), built: true },
  { href: '/schools', label: 'Schools', icon: 'schools', match: (p) => p.startsWith('/schools'), built: true },
  {
    href: '/dashboard',
    label: 'Me',
    icon: 'me',
    match: (p) => ME_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)),
    built: true,
  },
];
