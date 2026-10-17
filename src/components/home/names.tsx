// A person's names (plan §5.3): the Latin-script name first, the original script after it,
// each with its own lang and translate="no", so browsers neither translate nor mispronounce
// them. Chinese uses the system CJK fonts; Cyrillic display text uses Noto Serif Display.

import { cx } from '@/lib/cx';
import type { DemoName } from './demo-lineage';

/** A Latin-script name inside running text: its own lang, never translated (CLAUDE.md §2). */
export function Name({ children }: { children: string }) {
  return (
    <span lang="en" translate="no">
      {children}
    </span>
  );
}

export function PersonName({
  name,
  original,
  className,
  originalClassName,
  'data-name': dataName,
}: {
  name: string;
  original?: DemoName | undefined;
  className?: string;
  originalClassName?: string;
  /** Marks the Latin name, so the living line can measure where its first line sits. */
  'data-name'?: boolean;
}) {
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-[0.42em]', className)}>
      <span lang="en" translate="no" data-name={dataName ? '' : undefined}>
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
