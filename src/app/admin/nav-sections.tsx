// The sections of the control panel's navigation (docs/adr/0035-control-panel.md), by group, and
// the ones a session may open: checkRoute, the same decision each page's guard makes.

import { headers } from 'next/headers';

import { AdminNav, type AdminNavGroup } from '@/components/admin/admin-nav';
import { getAdminT, mayChooseAdminLang } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { checkRoute, hasStaff2FA } from '@/server/auth/guards';
import type { Principal } from '@/server/auth/principal';
import { getRequestPrincipal } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';

interface Section {
  href: string;
  label: string;
  count?: 'openReview' | 'systemProblems';
}

/** Every section of the control panel, by group. A section shows only when its page would open. */
export const SECTIONS: readonly { label: string; sections: readonly Section[] }[] = [
  {
    label: 'Overview',
    sections: [
      { href: '/admin', label: 'Dashboard' },
      { href: '/admin/reports', label: 'Reports' },
    ],
  },
  { label: 'Queues', sections: [{ href: '/admin/review', label: 'Review requests', count: 'openReview' }] },
  {
    label: 'Directory',
    sections: [
      { href: '/admin/accounts', label: 'Accounts' },
      { href: '/admin/schools', label: 'Schools' },
      { href: '/admin/organizations', label: 'Organizations' },
    ],
  },
  {
    label: 'Archive',
    sections: [
      { href: '/admin/archive', label: 'Lineages' },
      { href: '/admin/archive/people', label: 'People & records' },
      { href: '/admin/review/records', label: 'Shared records' },
    ],
  },
  {
    label: 'Money',
    sections: [
      { href: '/admin/billing', label: 'Billing' },
      { href: '/admin/grants', label: 'Plan grants' },
    ],
  },
  { label: 'System', sections: [{ href: '/admin/system', label: 'System status', count: 'systemProblems' }] },
];

const COUNT_LABELS = { openReview: 'open', systemProblems: 'problems' } as const;

/** The labels as t() calls, so the Bulgarian check (src/components/admin/i18n/bg/index.test.ts) sees them. */
function label(t: AdminT, text: string): string {
  switch (text) {
    case 'Overview': return t('Overview');
    case 'Dashboard': return t('Dashboard');
    case 'Reports': return t('Reports');
    case 'Queues': return t('Queues');
    case 'Review requests': return t('Review requests');
    case 'Directory': return t('Directory');
    case 'Accounts': return t('Accounts');
    case 'Schools': return t('Schools');
    case 'Organizations': return t('Organizations');
    case 'Archive': return t('Archive');
    case 'Lineages': return t('Lineages');
    case 'People & records': return t('People & records');
    case 'Shared records': return t('Shared records');
    case 'Money': return t('Money');
    case 'Billing': return t('Billing');
    case 'Plan grants': return t('Plan grants');
    case 'System': return t('System');
    case 'System status': return t('System status');
    case 'open': return t('open');
    case 'problems': return t('problems');
    default: return t(text);
  }
}

export function adminNavGroups(
  principal: Principal,
  counts: Record<'openReview' | 'systemProblems', number> | null,
  t: AdminT,
): AdminNavGroup[] {
  return SECTIONS.map((group) => ({
    label: label(t, group.label),
    links: group.sections
      .filter((section) => checkRoute(section.href, principal).ok)
      .map((section) => ({
        href: section.href,
        label: label(t, section.label),
        count: section.count && counts ? counts[section.count] : null,
        countLabel: section.count ? label(t, COUNT_LABELS[section.count]) : undefined,
        alert: section.count === 'systemProblems',
      })),
  })).filter((group) => group.links.length > 0);
}


/** The control panel's navigation for the page at `pathname`: nothing unless the session is staff with a verified second factor. */
export async function AdminNavEntry({ pathname }: { pathname: string }) {
  const principal = await getRequestPrincipal();
  if (!principal || !hasStaff2FA(principal)) return null;
  // The counts are a convenience: if they cannot be read, the links still show.
  const counts = await serverClient(await headers(), principal)
    .admin.navCounts()
    .catch(() => null);
  const t = await getAdminT();
  return <AdminNav groups={adminNavGroups(principal, counts, t)} pathname={pathname} t={t} canSwitch={await mayChooseAdminLang()} />;
}

