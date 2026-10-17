'use client';

// Navigation links of the shell: bottom tabs on phones, a side rail from 768 px. The current
// tab is marked with aria-current, ink colour, weight and a small ink chop, never colour alone.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LineageIcon, MeIcon, SchoolsIcon, SearchIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav';

const ICONS = { search: SearchIcon, lineage: LineageIcon, schools: SchoolsIcon, me: MeIcon } as const;

export function NavLinks({ variant }: { variant: 'tabs' | 'rail' }) {
  const pathname = usePathname();
  return (
    <ul className={cn(variant === 'tabs' ? 'flex flex-1' : 'flex flex-col gap-0.5')}>
      {NAV_ITEMS.map((item) => {
        const current = item.match(pathname);
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href} className={cn(variant === 'tabs' && 'flex flex-1')}>
            <Link
              href={item.href}
              prefetch={item.built ? null : false}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'group relative flex items-center text-fg-subtle transition-colors duration-(--duration-fast) hover:text-fg aria-[current=page]:text-fg',
                variant === 'tabs'
                  ? 'min-h-11 flex-1 flex-col justify-center gap-[5px] text-[0.6875rem] leading-none font-semibold tracking-[0.12em] uppercase'
                  : 'min-h-[46px] gap-3.5 rounded-sm px-3 text-[0.875rem] font-medium hover:bg-surface-3 aria-[current=page]:bg-surface-3 aria-[current=page]:font-semibold',
              )}
            >
              <Icon size={variant === 'tabs' ? 23 : 21} />
              <span>{item.label}</span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute size-[7px] scale-0 rotate-[-20deg] rounded-[1px] bg-fg transition-transform duration-(--duration-slow) ease-stamp group-aria-[current=page]:scale-100 group-aria-[current=page]:rotate-[4deg]',
                  variant === 'tabs' ? 'top-[9px] left-[calc(50%+11px)]' : 'top-1/2 right-3 -mt-[3.5px]',
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
