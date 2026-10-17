// Status badge (M00b): seal icon + text, never colour alone (plan §4.6, §5.6). The text is the
// accessible name; the seal is decorative.

import { linkStyles } from '@/design/tokens';
import { Seal } from '@/components/ink/seal';
import type { LinkKind } from '@/components/ink/link-stroke';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps {
  state: LinkKind;
  /** Replaces the default label ("Verified", "Under review", …). */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ state, label, size = 'md', className }: StatusBadgeProps) {
  const style = linkStyles[state];
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap font-semibold',
        size === 'sm' ? 'text-label' : 'text-sm',
        className,
      )}
      style={{ color: `var(--${style.labelColor})` }}
    >
      <Seal kind={style.seal} size={size === 'sm' ? 14 : 16} />
      <span>{label ?? style.label}</span>
    </span>
  );
}
