// Skeleton: the loading shape of the content it stands for (plan §5.6). It does not shimmer:
// nothing moves on its own (plan §5.8 (e)). The container that is loading sets aria-busy.

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('rounded-xs bg-surface-3', className)} {...props} />;
}
