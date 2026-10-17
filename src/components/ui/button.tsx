// Button (shadcn/ui on Base UI, styled for "Ink Register"). Red fills only the primary action;
// every size is at least 44 px tall on phones (plan §5.8 (b)). To render a link that looks
// like a button, apply `buttonVariants()` to the link, or pass it through `render` with
// `nativeButton={false}`; never `asChild` (CLAUDE.md, §10).

import { Button as BaseButton } from '@base-ui/react/button';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button-variants';

export { buttonVariants };

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
