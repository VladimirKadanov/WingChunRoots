// "Back to <name>": the trail chip of the Constellation prototype. After focusing a second
// person it returns to the previous one; the explorer (M05) keeps the same chip.

import type { ComponentProps } from 'react';
import { ArrowLeftIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

export function TrailChip({ name, className, ...props }: { name: string } & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-strong bg-surface-1 px-3.5 text-[0.8125rem] font-semibold text-fg hover:bg-surface-3',
        className,
      )}
      {...props}
    >
      <ArrowLeftIcon size={16} />
      <span>
        Back to{' '}
        <span lang="en" translate="no">
          {name}
        </span>
      </span>
    </button>
  );
}
