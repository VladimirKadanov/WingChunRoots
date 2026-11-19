// The dashboard's menu (owner request 2026-11-17, docs/adr/0039-member-navigation.md): the same
// grouped list on every /dashboard page, showing only the groups the account uses. From 1024 px a
// sidebar beside the page; narrower, a row of links that scrolls sideways above it, so every
// section stays one tap away on a phone. The current page is marked with aria-current, weight, an
// ink bar and the surface, never colour alone. Rendered on the server with no script of its own,
// so the dashboard routes keep their script budget (plan §5.8 (c)): the @nav slot
// (src/app/dashboard/@nav) knows the address and passes it.

import Link from 'next/link';

import type { DashboardNav as NavData } from '@/server/services/dashboard-nav';

export interface DashboardNavLink {
  href: string;
  label: string;
  /** A count beside the label (unread, waiting), or null. */
  count: number | null;
  /** What the count means, for the accessible name ("3 unread"). */
  countLabel?: string;
  /** A test id for the links the E2E tests follow. */
  testId?: string;
}

export interface DashboardNavGroup {
  label: string;
  links: DashboardNavLink[];
}

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The link of the page at `pathname`: the longest address it is at or below (/dashboard itself only exactly). */
export function currentHref(groups: readonly DashboardNavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of groups.flatMap((g) => g.links)) {
    const path = href.split('?')[0]!;
    const matches = path === '/dashboard' ? pathname === '/dashboard' : under(pathname, path);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

const TEST_IDS: Record<string, string> = {
  '/dashboard/passport': 'dashboard-passport',
  '/dashboard/trial-lessons': 'dashboard-trial-lessons',
  '/dashboard/succession': 'dashboard-succession',
  '/dashboard/family': 'dashboard-family',
};

const link = (href: string, label: string, count: number | null = null, countLabel?: string): DashboardNavLink => ({ href, label, count, countLabel, testId: TEST_IDS[href] });

/** The menu's groups for an account: only what it uses (a student never sees Teaching). */
export function dashboardNavGroups(nav: NavData): DashboardNavGroup[] {
  const groups: DashboardNavGroup[] = [{ label: 'Overview', links: [link('/dashboard', 'Overview')] }];
  const sifu = nav.accountType === 'sifu';
  if (!nav.staffOnly) {
    const learning = [link('/dashboard/teachers', 'My teachers'), link('/dashboard/passport', 'Training passport')];
    // ADR 0048: only on a plan that includes it (no menu entry offers what the plan does not have).
    if (nav.family) learning.push(link('/dashboard/family', 'Kung fu family'));
    learning.push(link('/dashboard/trial-lessons', 'Trial lessons'));
    groups.push({ label: 'Learning', links: learning });
  }
  if (sifu && !nav.staffOnly) {
    const teaching = [
      link('/dashboard/students/requests', 'Student requests', nav.waitingStudentRequests || null, 'waiting'),
      link('/dashboard/students', 'Students’ passports'),
      link('/dashboard/schools', 'My schools'),
      link('/dashboard/events', 'Events'),
    ];
    if (nav.instructor !== 'verified') teaching.push(link('/dashboard/instructor', 'Instructor verification'));
    groups.push({ label: 'Teaching', links: teaching });
  }
  if (nav.organizations.length > 0 || (sifu && !nav.staffOnly)) {
    groups.push({
      label: 'Organizations',
      links: [
        ...nav.organizations.map((o) => link(`/dashboard/organization/${o.id}`, o.name)),
        link('/dashboard/organization', nav.organizations.length > 0 ? 'All your organizations' : 'Organizations'),
      ],
    });
  }
  const you: DashboardNavLink[] = [];
  // Without a profile the dashboard home's "Next steps" offers "Set up your profile"; the menu does not repeat it.
  if (nav.hasProfile) you.push(link('/dashboard/profile', 'Profile'), link('/dashboard/photos', 'Photos'));
  you.push(link('/dashboard/notifications', 'Notifications', nav.unreadNotifications || null, 'unread'));
  if (!nav.staffOnly) you.push(link('/dashboard/cases', 'Cases'), link('/dashboard/succession', 'Digital successor'));
  you.push(link('/account/plan', 'Plan and billing'), link('/account', 'Settings'));
  groups.push({ label: 'You', links: you });
  return groups;
}

function Count({ item, compact = false }: { item: DashboardNavLink; compact?: boolean }) {
  if (!item.count) return null;
  return (
    <span
      className={
        compact
          ? 'text-xs font-semibold'
          : 'ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full border border-border-strong px-1.5 text-xs font-semibold text-fg'
      }
    >
      <span aria-hidden="true">{item.count}</span>
      <span className="sr-only">
        , {item.count} {item.countLabel ?? ''}
      </span>
    </span>
  );
}

export function DashboardNav({ groups, pathname }: { groups: DashboardNavGroup[]; pathname: string }) {
  const links = groups.flatMap((g) => g.links);
  const current = currentHref(groups, pathname);
  return (
    <nav aria-label="Dashboard" data-testid="dashboard-nav" className="lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:overscroll-contain">
      <ul className="relative flex gap-1.5 overflow-x-auto px-page py-2 [scrollbar-width:thin] lg:hidden">
        {links.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={current === item.href ? 'page' : undefined}
              data-testid={item.testId}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle px-3.5 text-sm whitespace-nowrap text-fg-muted hover:text-fg aria-[current=page]:border-fg aria-[current=page]:bg-fg aria-[current=page]:font-semibold aria-[current=page]:text-fg-inverse"
            >
              {item.label}
              <Count item={item} compact />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden px-3 pt-6 pb-10 lg:block">
        <p className="eyebrow px-3">Dashboard</p>
        {groups.map((group) => (
          <div key={group.label} className="mt-5">
            <p className="px-3 pb-1.5 text-xs tracking-[0.08em] text-fg-subtle uppercase">{group.label}</p>
            <ul className="grid gap-0.5">
              {group.links.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current === item.href ? 'page' : undefined}
                    data-testid={item.testId}
                    className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-ui text-fg-muted [overflow-wrap:anywhere] hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-surface-3 aria-[current=page]:font-semibold aria-[current=page]:text-fg aria-[current=page]:shadow-[inset_2px_0_0_var(--fg)]"
                  >
                    {item.label}
                    <Count item={item} />
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
