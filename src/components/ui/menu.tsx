'use client';

// Menu (shadcn/ui on Base UI): a raised paper card. Items are 44 px tall; the highlighted item
// gets the hover surface and keeps its text colour. Single-letter typeahead works only while
// focus is inside the menu (WCAG 2.1.4). The open menu is rendered into <main>, so its items
// stay inside a landmark (a menu is not a dialog; WCAG 1.3.1, axe "region").

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useSyncExternalStore, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { CheckIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

type WithStringClass<T> = Omit<T, 'className'> & { className?: string };

const subscribeNever = () => () => {};
const mainElement = () => document.getElementById('main');
const noElement = () => null;

export const MenuRoot = BaseMenu.Root;

export function MenuTrigger({ render, ...props }: { render: ReactElement } & Omit<ComponentProps<typeof BaseMenu.Trigger>, 'render'>) {
  return <BaseMenu.Trigger render={render} {...props} />;
}

export function MenuContent({
  children,
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
}) {
  const main = useSyncExternalStore(subscribeNever, mainElement, noElement);
  return (
    <BaseMenu.Portal container={main}>
      <BaseMenu.Positioner className="z-50 outline-none" align={align} side={side} sideOffset={sideOffset} collisionPadding={12}>
        <BaseMenu.Popup
          className={cn(
            'min-w-48 origin-(--transform-origin) rounded-md border border-border-subtle bg-surface-2 p-1 text-fg shadow-pop outline-none',
            'transition-[opacity,scale] duration-(--duration-fast) ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0',
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

const itemClass =
  'flex min-h-11 cursor-default items-center gap-3 rounded-sm px-3 text-sm text-fg outline-none select-none data-highlighted:bg-surface-3 data-disabled:opacity-60';

export function MenuItem({ className, ...props }: WithStringClass<ComponentProps<typeof BaseMenu.Item>>) {
  return <BaseMenu.Item className={cn(itemClass, className)} {...props} />;
}

export function MenuGroupLabel({ className, ...props }: WithStringClass<ComponentProps<typeof BaseMenu.GroupLabel>>) {
  return <BaseMenu.GroupLabel className={cn('eyebrow px-3 pt-2 pb-1', className)} {...props} />;
}

export const MenuGroup = BaseMenu.Group;
export const MenuRadioGroup = BaseMenu.RadioGroup;

export function MenuSeparator({ className }: { className?: string }) {
  return <BaseMenu.Separator className={cn('mx-2 my-1 h-px bg-border-subtle', className)} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: WithStringClass<ComponentProps<typeof BaseMenu.RadioItem>>) {
  return (
    <BaseMenu.RadioItem className={cn(itemClass, 'pr-4', className)} {...props}>
      <span className="inline-grid size-4 place-items-center">
        <BaseMenu.RadioItemIndicator>
          <CheckIcon size={16} />
        </BaseMenu.RadioItemIndicator>
      </span>
      {children}
    </BaseMenu.RadioItem>
  );
}
