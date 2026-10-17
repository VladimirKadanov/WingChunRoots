// A person's names (plan §5.3): the Latin-script name first, the original script after it,
// each with its own lang and translate="no", so browsers neither translate nor mispronounce
// them. Chinese uses the system CJK fonts; Cyrillic display text uses Noto Serif Display.

import { cx } from '@/lib/cx';
import type { DemoName } from './demo-lineage';

export function PersonName({
  name,
  original,
  className,
  originalClassName,
}: {
  name: string;
  original?: DemoName | undefined;
  className?: string;
  originalClassName?: string;
}) {
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span lang="en" translate="no">
        {name}
      </span>
      {original ? (
        <span
          lang={original.lang}
          translate="no"
          className={cx(original.lang.startsWith('zh') && 'cjk', 'text-[0.74em] text-fg-muted', originalClassName)}
        >
          {original.text}
        </span>
      ) : null}
    </span>
  );
}
