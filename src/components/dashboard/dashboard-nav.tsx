// The dashboard's menu (owner request 2026-11-17, docs/adr/0039-member-navigation.md): the same
// grouped list on every /dashboard page, showing only the groups the account uses. From 1024 px a
// sidebar beside the page; narrower, one button that names the current page and opens the same
// grouped list (phone review 2026-11, ADR 0053; it was a row of links that scrolled sideways, where
// the current page was often out of sight). The current page is marked with aria-current, weight, an
// ink bar and the surface, never colour alone. Rendered on the server with no script of its own,
// so the dashboard routes keep their script budget (plan §5.8 (c)): the @nav slot
// (src/app/dashboard/@nav) knows the address and passes it.

import Link from 'next/link';

import { ChevronDownIcon } from '@/components/icons';

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

/**
 * The menu's groups for an account: only what it uses (a student never sees Teaching). Role replay
 * 2026-11-25 (P2-7): a Sifu's menu leads with Teaching, then Schools and events, then their own
 * training; Cases appears once the account is a party of one, Digital successor for a Sifu or an
 * account in a nomination; an organization admin who is no Sifu gets Events with the organizations
 * (P2-6: they publish events too).
 */
export function dashboardNavGroups(nav: NavData): DashboardNavGroup[] {
  const groups: DashboardNavGroup[] = [{ label: 'Overview', links: [link('/dashboard', 'Overview')] }];
  const sifu = nav.accountType === 'sifu' && !nav.staffOnly;
  if (sifu) {
    const teaching = [
      link('/dashboard/students/requests', 'Student requests', nav.waitingStudentRequests || null, 'waiting'),
      link('/dashboard/students', 'Students’ passports'),
    ];
    if (nav.instructor !== 'verified') teaching.push(link('/dashboard/instructor', 'Instructor verification'));
    groups.push({ label: 'Teaching', links: teaching });
    groups.push({ label: 'Schools and events', links: [link('/dashboard/schools', 'My schools'), link('/dashboard/events', 'Events')] });
  }
  if (!nav.staffOnly) {
    const training = [link('/dashboard/teachers', 'My teachers'), link('/dashboard/passport', 'Training passport')];
    // ADR 0048: only on a plan that includes it (no menu entry offers what the plan does not have).
    if (nav.family) training.push(link('/dashboard/family', 'Kung fu family'));
    training.push(link('/dashboard/trial-lessons', 'Trial lessons'));
    groups.push({ label: 'My training', links: training });
  }
  if (nav.organizations.length > 0 || sifu) {
    groups.push({
      label: 'Organizations',
      links: [
        ...nav.organizations.map((o) => link(`/dashboard/organization/${o.id}`, o.name)),
        link('/dashboard/organization', nav.organizations.length > 0 ? 'All your organizations' : 'Organizations'),
        ...(!sifu && nav.organizations.length > 0 ? [link('/dashboard/events', 'Events')] : []),
      ],
    });
  }
  const account: DashboardNavLink[] = [];
  // Without a profile the dashboard home's "Next steps" offers "Set up your profile"; the menu does not repeat it.
  if (nav.hasProfile) account.push(link('/dashboard/profile', 'Profile'), link('/dashboard/photos', 'Photos'));
  account.push(link('/dashboard/notifications', 'Notifications', nav.unreadNotifications || null, 'unread'));
  if (!nav.staffOnly && nav.hasCases) account.push(link('/dashboard/cases', 'Cases'));
  if (!nav.staffOnly && (sifu || nav.inSuccession)) account.push(link('/dashboard/succession', 'Digital successor'));
  account.push(link('/account/plan', 'Plan and billing'), link('/account', 'Settings'));
  groups.push({ label: 'Account', links: account });
  return groups;
}

function Count({ item }: { item: DashboardNavLink }) {
  if (!item.count) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full border border-border-strong px-1.5 text-xs font-semibold text-fg">
      <span aria-hidden="true">{item.count}</span>
      <span className="sr-only">
        , {item.count} {item.countLabel ?? ''}
      </span>
    </span>
  );
}

/** The grouped list of links: the sidebar from 1024 px, the menu the phone's button opens below that. */
function Groups({ groups, current }: { groups: DashboardNavGroup[]; current: string | null }) {
  return groups.map((group) => (
    <div key={group.label} className="mt-5 first:mt-0 lg:first:mt-5">
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
  ));
}

export function DashboardNav({ groups, pathname }: { groups: DashboardNavGroup[]; pathname: string }) {
  const links = groups.flatMap((g) => g.links);
  const current = currentHref(groups, pathname);
  const here = links.find((l) => l.href === current)?.label ?? 'Overview';
  // What waits anywhere in the menu (requests, unread notices): on the phone's button too.
  const waiting = links.reduce((sum, l) => sum + (l.count ?? 0), 0);
  return (
    <nav aria-label="Dashboard" data-testid="dashboard-nav" className="lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:overscroll-contain">
      {/* Phone review 2026-11 (ADR 0053): below 1024 px one button names the page you are on and
          opens the grouped menu (a <details>: no script, the dashboard keeps its script budget). */}
      <details className="group/menu px-page py-2 lg:hidden" data-testid="dashboard-menu">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-sm border border-border-strong bg-surface-1 px-4 select-none hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            <span className="text-fg-muted">Dashboard · </span>
            <span className="font-semibold">{here}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {waiting > 0 ? (
              <span className="inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-fg px-1.5 text-xs font-semibold text-fg-inverse">
                <span aria-hidden="true">{waiting}</span>
                <span className="sr-only">, {waiting} waiting or unread</span>
              </span>
            ) : null}
            <ChevronDownIcon size={18} className="transition-transform group-open/menu:rotate-180 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className="mt-2 rounded-sm border border-border-subtle bg-surface-1 py-3">
          <Groups groups={groups} current={current} />
        </div>
      </details>
      <div className="hidden px-3 pt-6 pb-10 lg:block">
        <p className="eyebrow px-3">Dashboard</p>
        <Groups groups={groups} current={current} />
      </div>
    </nav>
  );
}
