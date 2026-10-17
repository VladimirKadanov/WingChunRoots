// Input (shadcn/ui on Base UI). 16 px text so iOS does not zoom on focus; 48 px tall; the frame
// uses --border-strong (>= 3:1, WCAG 1.4.11).

import { Input as BaseInput } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const inputClassName = cn(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg',
  'placeholder:text-fg-subtle transition-[border-color,background-color] duration-(--duration-fast) ease-out',
  'hover:border-fg-muted focus-visible:border-fg data-disabled:opacity-60',
  'aria-invalid:border-danger',
);

export function Input({ className, ...props }: Omit<ComponentProps<typeof BaseInput>, 'className'> & { className?: string }) {
  return (
    <BaseInput
      data-slot="input"
      className={cn(inputClassName, className)}
      {...props}
    />
  );
}
