// The small legal line (phone review 2026-11, docs/adr/0053-phone-layout.md): Terms, Privacy and
// Licenses, at the foot of the home page and of the account settings. /legal/licenses stays
// reachable here because the licences of the packages and fonts the site ships ask for their
// notices to go with them; it is in no menu and not in search.

import Link from 'next/link';

import { cx } from '@/lib/cx';

const LINKS = [
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/licenses', label: 'Licenses' },
] as const;

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cx('flex flex-wrap gap-x-1 text-sm text-fg-subtle', className)}>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} prefetch={false} className="link inline-flex min-h-11 items-center px-1.5">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
