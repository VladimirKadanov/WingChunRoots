// Button (shadcn/ui on Base UI, styled for "Ink Register"). Red fills only the primary action;
// every size is at least 44 px tall on phones (plan §5.8 (b)). To render a link that looks
// like a button, apply `buttonVariants()` to the link, or pass it through `render` with
// `nativeButton={false}`; never `asChild` (CLAUDE.md, §10).

import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-sans font-semibold',
    'select-none transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-out',
    'active:not-data-disabled:translate-y-px data-disabled:opacity-60 disabled:opacity-60',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** The one primary action of a view: red seal fill, white label. */
        primary:
          'border-brand bg-brand text-on-brand hover:not-data-disabled:border-brand-hover hover:not-data-disabled:bg-brand-hover active:not-data-disabled:border-brand-pressed active:not-data-disabled:bg-brand-pressed',
        /** Default: an ink outline. */
        secondary: 'border-border-strong bg-transparent text-fg hover:not-data-disabled:bg-surface-3 active:not-data-disabled:bg-surface-pressed',
        /** Quiet: no frame until hovered or pressed. */
        ghost: 'border-transparent bg-transparent text-fg hover:not-data-disabled:bg-surface-3 active:not-data-disabled:bg-surface-pressed',
        /** Ink fill, for a strong secondary action on a busy surface. */
        ink: 'border-fg bg-fg text-fg-inverse hover:not-data-disabled:border-ink-hover hover:not-data-disabled:bg-ink-hover',
        /** A destructive action (withdraw, delete): rouge outline and label, never the brand red. */
        danger: 'border-danger bg-transparent text-danger hover:not-data-disabled:bg-surface-3 active:not-data-disabled:bg-surface-pressed',
      },
      size: {
        md: 'min-h-11 px-4.5 text-ui leading-tight tracking-[0.01em] [&_svg]:size-4.5',
        /** Compact on desktop; still 44 px on phones. */
        sm: 'min-h-11 px-3 text-sm leading-tight md:min-h-9 [&_svg]:size-4',
        lg: 'min-h-12 px-6 text-base leading-tight [&_svg]:size-5',
        icon: 'size-11 p-0 [&_svg]:size-[22px]',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = Omit<ComponentProps<typeof BaseButton>, 'className'> &
  VariantProps<typeof buttonVariants> & { className?: string };

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <BaseButton
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
