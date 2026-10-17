'use client';

// Tabs (shadcn/ui on Base UI): ink labels with an ink rule under the active tab. The active tab
// is marked by weight, colour and the rule, so it never depends on colour alone. Arrow keys
// move between tabs only while focus is in the tab list (WCAG 2.1.4).

import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type WithStringClass<T> = Omit<T, 'className'> & { className?: string };

export function Tabs({ className, ...props }: WithStringClass<ComponentProps<typeof BaseTabs.Root>>) {
  return <BaseTabs.Root data-slot="tabs" className={cn('w-full', className)} {...props} />;
}

export function TabsList({ className, children, ...props }: WithStringClass<ComponentProps<typeof BaseTabs.List>>) {
  return (
    <BaseTabs.List
      data-slot="tabs-list"
      className={cn('relative flex gap-1 overflow-x-auto border-b border-border-subtle scrollbar-none', className)}
      {...props}
    >
      {children}
      <BaseTabs.Indicator className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) bg-fg transition-[translate,width] duration-(--duration-base) ease-out" />
    </BaseTabs.List>
  );
}

export function Tab({ className, ...props }: WithStringClass<ComponentProps<typeof BaseTabs.Tab>>) {
  return (
    <BaseTabs.Tab
      data-slot="tab"
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2 px-3 text-ui font-medium whitespace-nowrap text-fg-muted select-none',
        // Inset, so the scrolling tab list does not clip the focus ring.
        'focus-visible:-outline-offset-2 hover:bg-surface-3 active:bg-surface-pressed',
        'hover:text-fg data-active:font-semibold data-active:text-fg data-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: WithStringClass<ComponentProps<typeof BaseTabs.Panel>>) {
  return <BaseTabs.Panel data-slot="tabs-panel" className={cn('pt-5', className)} {...props} />;
}
