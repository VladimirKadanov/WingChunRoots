// The section navigation of the Settings area (usability review 2026-11): one row of links that
// every settings page renders on the server, so the area reads as one place and adds no client
// JavaScript to routes that sit near their budget. On phones it is a horizontal row of pills that
// scrolls sideways; from 768 px a row of tabs over a rule. The current page is marked with
// aria-current, a heavier weight and a border (a pill's ink outline, a tab's underline), never
// colour alone. Profile is edited at /dashboard/profile, where it has always been; the row only
// leads there.

import Link from 'next/link';

import { cx } from '@/lib/cx';

export type SettingsSection = 'overview' | 'profile' | 'security' | 'plan' | 'notifications' | 'privacy';

/** The sections in order: the short label of the row, and the page. */
export const SETTINGS_SECTIONS: readonly { key: SettingsSection; label: string; href: string }[] = [
  { key: 'overview', label: 'Overview', href: '/account' },
  { key: 'profile', label: 'Profile', href: '/dashboard/profile' },
  { key: 'security', label: 'Sign-in & security', href: '/account/security' },
  { key: 'plan', label: 'Plan & billing', href: '/account/plan' },
  { key: 'notifications', label: 'Notifications', href: '/account/notifications' },
  { key: 'privacy', label: 'Privacy', href: '/account/privacy' },
];

export function SettingsNav({ current, className }: { current: SettingsSection; className?: string }) {
  return (
    <nav aria-label="Settings" data-testid="settings-nav" className={className}>
      {/* On phones the row scrolls sideways inside the page's gutters; the page itself never does.
          The 4 px of padding (and the margin that cancels it) keep a focus ring inside the scroller. */}
      <div className="-m-1 overflow-x-auto p-1 md:m-0 md:overflow-visible md:p-0">
        <ul className="flex w-max gap-2 md:w-auto md:flex-wrap md:gap-x-6 md:gap-y-0 md:border-b md:border-border-subtle">
          {SETTINGS_SECTIONS.map((section) => {
            const here = section.key === current;
            return (
              <li key={section.key} className="shrink-0">
                <Link
                  href={section.href}
                  aria-current={here ? 'page' : undefined}
                  className={cx(
                    'inline-flex min-h-11 items-center rounded-full border px-4 text-ui whitespace-nowrap',
                    'md:-mb-px md:rounded-none md:border-0 md:border-b-2 md:px-0.5',
                    here
                      ? 'border-fg font-semibold text-fg md:border-fg'
                      : 'border-border-subtle text-fg-muted hover:border-border-strong hover:text-fg md:border-transparent',
                  )}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
